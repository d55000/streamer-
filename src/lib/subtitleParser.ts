/**
 * Parse an SRT subtitle string into an array of cues.
 */
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

function timeToSeconds(time: string): number {
  // Accepts HH:MM:SS,mmm or HH:MM:SS.mmm
  const parts = time.replace(",", ".").split(":");
  const h = parseFloat(parts[0]) || 0;
  const m = parseFloat(parts[1]) || 0;
  const s = parseFloat(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

export function parseSRT(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = content.trim().replace(/\r\n/g, "\n").split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split("\n");
    // Find the timing line (contains ' --> ')
    const timingIdx = lines.findIndex((l) => l.includes(" --> "));
    if (timingIdx === -1) continue;

    const [startStr, endStr] = lines[timingIdx].split(" --> ");
    const start = timeToSeconds(startStr.trim());
    const end = timeToSeconds(endStr.trim());
    let text = lines.slice(timingIdx + 1).join("\n");
    // Iteratively strip HTML tags to handle nested/obfuscated tags like <scr<script>ipt>
    let prev = "";
    while (prev !== text) {
      prev = text;
      text = text.replace(/<[^>]*>/g, "");
    }
    text = text.trim();

    if (!isNaN(start) && !isNaN(end) && text) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

export function parseVTT(content: string): SubtitleCue[] {
  // VTT is similar to SRT but with "WEBVTT" header and "." separator
  const stripped = content.replace(/^WEBVTT[^\n]*\n/, "").trim();
  return parseSRT(stripped);
}

export function parseASS(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith("Dialogue:")) continue;
    // Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    const afterPrefix = line.substring("Dialogue:".length).trim();
    const parts = afterPrefix.split(",");
    if (parts.length < 10) continue;

    const startStr = parts[1].trim();
    const endStr = parts[2].trim();
    const text = parts
      .slice(9)
      .join(",")
      .replace(/\{[^}]*\}/g, "") // Strip ASS override tags
      .replace(/\\N/g, "\n")
      .replace(/\\n/g, "\n")
      .trim();

    const start = timeToSeconds(startStr);
    const end = timeToSeconds(endStr);

    if (!isNaN(start) && !isNaN(end) && text) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

export function parseSubtitleFile(
  content: string,
  filename: string
): SubtitleCue[] {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "srt":
      return parseSRT(content);
    case "vtt":
      return parseVTT(content);
    case "ass":
    case "ssa":
      return parseASS(content);
    default:
      // Try SRT as fallback
      return parseSRT(content);
  }
}
