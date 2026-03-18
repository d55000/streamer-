/**
 * FFmpeg WASM helper — probes files, extracts subtitles, remuxes containers,
 * and transcodes unsupported codecs (HEVC, 10-bit, DTS, AC3, AV1, …) for
 * browser playback.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { parseSRT, parseASS, type SubtitleCue } from "./subtitleParser";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface StreamInfo {
  index: number;
  type: "video" | "audio" | "subtitle" | "other";
  codec: string;
  codecLong: string;
  language: string;
  label: string;
  isDefault: boolean;
  pixFmt?: string;
  resolution?: string;
  sampleRate?: string;
  channels?: string;
}

export interface ProbeResult {
  streams: StreamInfo[];
  format: string;
  is10bit: boolean;
  needsRemux: boolean;
  needsVideoTranscode: boolean;
  needsAudioTranscode: boolean;
  unsupportedCodecs: string[];
  chapters: { start: number; end: number; title: string }[];
}

/* ------------------------------------------------------------------ */
/*  Codec allow / deny lists                                           */
/* ------------------------------------------------------------------ */

/** Video codecs most browsers can decode natively (in an MP4 container). */
const NATIVE_VIDEO = new Set([
  "h264",
  "avc1",
  "vp8",
  "vp9",
]);

/** Audio codecs most browsers can decode natively. */
const NATIVE_AUDIO = new Set([
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "pcm_s16le",
  "pcm_f32le",
]);

function isVideoNative(codec: string): boolean {
  const c = codec.toLowerCase();
  return [...NATIVE_VIDEO].some((n) => c.includes(n));
}

function isAudioNative(codec: string): boolean {
  const c = codec.toLowerCase();
  return [...NATIVE_AUDIO].some((n) => c.includes(n));
}

/* ------------------------------------------------------------------ */
/*  FFmpeg singleton                                                   */
/* ------------------------------------------------------------------ */

let ffInstance: FFmpeg | null = null;
let ffLoaded = false;

export async function getFFmpeg(
  onProgress?: (ratio: number) => void
): Promise<FFmpeg> {
  if (ffInstance && ffLoaded) return ffInstance;

  ffInstance = new FFmpeg();
  if (onProgress) {
    ffInstance.on("progress", ({ progress }) =>
      onProgress(Math.max(0, Math.min(1, progress)))
    );
  }

  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
  await ffInstance.load({
    coreURL: await toBlobURL(
      `${baseURL}/ffmpeg-core.js`,
      "text/javascript"
    ),
    wasmURL: await toBlobURL(
      `${baseURL}/ffmpeg-core.wasm`,
      "application/wasm"
    ),
  });

  ffLoaded = true;
  return ffInstance;
}

export function isFFmpegLoaded(): boolean {
  return ffLoaded;
}

/* ------------------------------------------------------------------ */
/*  Probe                                                              */
/* ------------------------------------------------------------------ */

function parseStreamLine(line: string): StreamInfo | null {
  const m = line.match(
    /Stream #(\d+):(\d+)(?:\(([^)]*)\))?\s*:\s*(Video|Audio|Subtitle|Data|Attachment)\s*:\s*(.*)/i
  );
  if (!m) return null;

  const idx = parseInt(m[2]);
  const lang = m[3] || "und";
  const kind = m[4].toLowerCase();
  const rest = m[5];

  const type: StreamInfo["type"] =
    kind === "video"
      ? "video"
      : kind === "audio"
        ? "audio"
        : kind === "subtitle"
          ? "subtitle"
          : "other";

  const codecMatch = rest.match(/^([^,(]+)/);
  const codec = codecMatch ? codecMatch[1].trim() : "unknown";
  const isDefault = /\(default\)/i.test(rest);

  const typeLabel =
    type === "audio"
      ? "Audio"
      : type === "subtitle"
        ? "Subtitle"
        : type === "video"
          ? "Video"
          : "Track";

  const info: StreamInfo = {
    index: idx,
    type,
    codec,
    codecLong: rest.trim(),
    language: lang,
    label: `${typeLabel} ${idx}${lang !== "und" ? ` (${lang.toUpperCase()})` : ""}`,
    isDefault,
  };

  if (type === "video") {
    const pix = rest.match(/\b(yuv\w+|rgb\w+|gbr\w+)\b/);
    info.pixFmt = pix?.[1];
    const res = rest.match(/(\d{2,5})x(\d{2,5})/);
    info.resolution = res ? `${res[1]}x${res[2]}` : undefined;
  }

  if (type === "audio") {
    const sr = rest.match(/(\d+)\s*Hz/);
    info.sampleRate = sr?.[1];
    if (rest.includes("7.1")) info.channels = "7.1";
    else if (rest.includes("5.1")) info.channels = "5.1";
    else if (rest.includes("stereo")) info.channels = "stereo";
    else if (rest.includes("mono")) info.channels = "mono";
  }

  return info;
}

export async function probeFile(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<ProbeResult> {
  const ffmpeg = await getFFmpeg(onProgress);

  const ext = getExt(file.name);
  const inputName = `probe_input${ext}`;
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  let log = "";
  const handler = ({ message }: { message: string }) => {
    log += message + "\n";
  };
  ffmpeg.on("log", handler);

  try {
    await ffmpeg.exec(["-i", inputName, "-hide_banner"]);
  } catch {
    // Expected — no output file specified
  }

  ffmpeg.off("log", handler);
  try {
    await ffmpeg.deleteFile(inputName);
  } catch {
    /* ok */
  }

  const lines = log.split("\n");
  const streams: StreamInfo[] = [];
  for (const line of lines) {
    const s = parseStreamLine(line.trim());
    if (s) streams.push(s);
  }

  // ---- Chapters ----
  const chapters: ProbeResult["chapters"] = [];
  for (let i = 0; i < lines.length; i++) {
    const cm = lines[i].match(
      /Chapter #\d+:\d+:\s*start\s+([\d.]+),\s*end\s+([\d.]+)/
    );
    if (cm) {
      const start = parseFloat(cm[1]);
      const end = parseFloat(cm[2]);
      let title = `Chapter ${chapters.length + 1}`;
      if (i + 1 < lines.length) {
        const tm = lines[i + 1].match(/title\s*:\s*(.+)/i);
        if (tm) {
          title = tm[1].trim();
          i++;
        }
      }
      chapters.push({ start, end, title });
    }
  }

  // ---- Format ----
  const fmtMatch = log.match(/Input #0,\s*([^,]+)/);
  const format = fmtMatch ? fmtMatch[1].trim() : "unknown";

  // ---- Codec analysis ----
  const videoStreams = streams.filter((s) => s.type === "video");
  const audioStreams = streams.filter((s) => s.type === "audio");

  const is10bit = videoStreams.some(
    (s) =>
      s.pixFmt != null &&
      /p10|p12|p16|10le|10be|12le|12be|16le|16be/.test(s.pixFmt)
  );

  const needsRemux =
    /matroska|avi|flv|asf|ogg|rm|rmvb|ts|m2ts/.test(format) ||
    /\.(mkv|avi|flv|wmv|ts|m2ts|ogv|rmvb)$/i.test(ext);

  const needsVideoTranscode =
    is10bit ||
    videoStreams.some((s) => !isVideoNative(s.codec));

  const needsAudioTranscode = audioStreams.some(
    (s) => !isAudioNative(s.codec)
  );

  const unsupportedCodecs = [
    ...videoStreams.filter((s) => !isVideoNative(s.codec)).map((s) => s.codec),
    ...audioStreams.filter((s) => !isAudioNative(s.codec)).map((s) => s.codec),
  ];

  return {
    streams,
    format,
    is10bit,
    needsRemux,
    needsVideoTranscode,
    needsAudioTranscode,
    unsupportedCodecs,
    chapters,
  };
}

/* ------------------------------------------------------------------ */
/*  Extract subtitles                                                  */
/* ------------------------------------------------------------------ */

export async function extractSubtitle(
  file: File,
  streamIndex: number,
  codec: string,
  onProgress?: (ratio: number) => void
): Promise<SubtitleCue[]> {
  const ffmpeg = await getFFmpeg(onProgress);
  const ext = getExt(file.name);
  const inputName = `sub_in${ext}`;
  const isAss = /ass|ssa/i.test(codec);
  const outName = isAss ? "out_sub.ass" : "out_sub.srt";

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  try {
    await ffmpeg.exec([
      "-i",
      inputName,
      "-map",
      `0:${streamIndex}`,
      "-f",
      isAss ? "ass" : "srt",
      outName,
    ]);
  } catch {
    // May fail for bitmap subtitles
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      /* ok */
    }
    return [];
  }

  const data = await ffmpeg.readFile(outName);
  const text =
    typeof data === "string" ? data : new TextDecoder().decode(data);

  try {
    await ffmpeg.deleteFile(inputName);
  } catch {
    /* ok */
  }
  try {
    await ffmpeg.deleteFile(outName);
  } catch {
    /* ok */
  }

  return isAss ? parseASS(text) : parseSRT(text);
}

/* ------------------------------------------------------------------ */
/*  Remux (fast — copies streams)                                      */
/* ------------------------------------------------------------------ */

export async function remuxToMp4(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<string> {
  const ffmpeg = await getFFmpeg(onProgress);
  const ext = getExt(file.name);
  const inputName = `remux_in${ext}`;
  const outputName = "remux_out.mp4";

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  await ffmpeg.exec([
    "-i",
    inputName,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputName,
  ]);

  const data = await ffmpeg.readFile(outputName);
  try {
    await ffmpeg.deleteFile(inputName);
  } catch {
    /* ok */
  }
  try {
    await ffmpeg.deleteFile(outputName);
  } catch {
    /* ok */
  }

  return URL.createObjectURL(toVideoBlob(data));
}

/* ------------------------------------------------------------------ */
/*  Transcode — full re-encode to H.264 + AAC MP4                     */
/* ------------------------------------------------------------------ */

export async function transcodeToMp4(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<string> {
  const ffmpeg = await getFFmpeg(onProgress);
  const ext = getExt(file.name);
  const inputName = `tc_in${ext}`;
  const outputName = "tc_out.mp4";

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  await ffmpeg.exec([
    "-i",
    inputName,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputName,
  ]);

  const data = await ffmpeg.readFile(outputName);
  try {
    await ffmpeg.deleteFile(inputName);
  } catch {
    /* ok */
  }
  try {
    await ffmpeg.deleteFile(outputName);
  } catch {
    /* ok */
  }

  return URL.createObjectURL(toVideoBlob(data));
}

/* ------------------------------------------------------------------ */
/*  Transcode audio only (keep video stream intact)                    */
/* ------------------------------------------------------------------ */

export async function transcodeAudioOnly(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<string> {
  const ffmpeg = await getFFmpeg(onProgress);
  const ext = getExt(file.name);
  const inputName = `tca_in${ext}`;
  const outputName = "tca_out.mp4";

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  await ffmpeg.exec([
    "-i",
    inputName,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputName,
  ]);

  const data = await ffmpeg.readFile(outputName);
  try {
    await ffmpeg.deleteFile(inputName);
  } catch {
    /* ok */
  }
  try {
    await ffmpeg.deleteFile(outputName);
  } catch {
    /* ok */
  }

  return URL.createObjectURL(toVideoBlob(data));
}

/* ------------------------------------------------------------------ */
/*  High-level: decide best processing strategy                        */
/* ------------------------------------------------------------------ */

export async function processForPlayback(
  file: File,
  probe: ProbeResult,
  onProgress?: (ratio: number) => void,
  onStatus?: (msg: string) => void
): Promise<string> {
  if (probe.needsVideoTranscode) {
    const codecs = probe.unsupportedCodecs.join(", ") || "unsupported codec";
    onStatus?.(
      `Transcoding video (${codecs}${probe.is10bit ? ", 10-bit" : ""}) — this may take a while…`
    );
    return transcodeToMp4(file, onProgress);
  }

  if (probe.needsAudioTranscode) {
    const audioCodecs = probe.streams
      .filter((s) => s.type === "audio" && !isAudioNative(s.codec))
      .map((s) => s.codec)
      .join(", ");
    onStatus?.(`Transcoding audio (${audioCodecs})…`);
    return transcodeAudioOnly(file, onProgress);
  }

  if (probe.needsRemux) {
    onStatus?.(`Remuxing ${probe.format} → MP4…`);
    return remuxToMp4(file, onProgress);
  }

  throw new Error("File does not need processing");
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getExt(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.substring(dot) : "";
}

/** Convert FileData from ffmpeg.readFile to a Blob, working around
 *  SharedArrayBuffer / ArrayBuffer TS mismatch. */
function toVideoBlob(data: string | Uint8Array): Blob {
  if (typeof data === "string") {
    return new Blob([data], { type: "video/mp4" });
  }
  // Copy into a plain ArrayBuffer so Blob accepts it
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  return new Blob([buf], { type: "video/mp4" });
}
