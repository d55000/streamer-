"use client";

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import Hls from "hls.js";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Languages,
  Subtitles,
  Upload,
  X,
  ChevronRight,
  ChevronLeft,
  Loader2,
  FastForward,
  Rewind,
  BookOpen,
  SkipForward,
  SkipBack,
} from "lucide-react";
import { parseSubtitleFile, SubtitleCue } from "@/lib/subtitleParser";
import { parseChapters, type Chapter } from "@/lib/chapterParser";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AudioTrack {
  id: number;
  label: string;
  language: string;
  enabled: boolean;
}

interface SubtitleStyle {
  fontSize: number;
  color: string;
  bgOpacity: number;
}

interface EmbeddedSubTrack {
  streamIndex: number;
  label: string;
  language: string;
  codec: string;
  cues?: SubtitleCue[];
}

interface HlsSubTrack {
  id: number;
  label: string;
  language: string;
}

type SettingsPanel = "main" | "audio" | "subtitles" | "subStyle" | "chapters";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function detectStreamType(
  url: string
): "hls" | "dash" | "native" | "unknown" {
  const lower = url.toLowerCase().split(/[?#]/)[0];
  if (lower.includes(".m3u8")) return "hls";
  if (lower.includes(".mpd")) return "dash";
  if (
    lower.includes(".mp4") ||
    lower.includes(".webm") ||
    lower.includes(".ogg") ||
    lower.includes(".mov") ||
    lower.includes(".mkv") ||
    lower.includes(".avi") ||
    lower.includes(".flv") ||
    lower.includes(".wmv") ||
    lower.includes(".m4v") ||
    lower.includes(".ogv") ||
    lower.includes(".rmvb") ||
    lower.includes(".ts")
  )
    return "native";
  if (/\.(m4a|mp3|aac|flac|wav|opus)$/.test(lower)) return "native";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function UniversalPlayer({
  src,
  objectUrl,
  localFile,
}: {
  src?: string;
  objectUrl?: string;
  localFile?: File | null;
}) {
  /* Refs */
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dashRef = useRef<any>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const chapterInputRef = useRef<HTMLInputElement>(null);

  /* Web Audio API refs (volume boost) */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  /* Double-tap refs */
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapCountRef = useRef(0);

  /* ---------------------------------------------------------------- */
  /*  State                                                            */
  /* ---------------------------------------------------------------- */

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [buffered, setBuffered] = useState(0);

  const [error, setError] = useState("");
  const [usingProxy, setUsingProxy] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>("main");

  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState(0);

  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>({
    fontSize: 20,
    color: "#FFFFFF",
    bgOpacity: 0.6,
  });

  const [embeddedSubTracks, setEmbeddedSubTracks] = useState<EmbeddedSubTrack[]>([]);
  const [activeEmbeddedSub, setActiveEmbeddedSub] = useState(-1);
  const [extractingSub, setExtractingSub] = useState(false);

  const [hlsSubTracks, setHlsSubTracks] = useState<HlsSubTrack[]>([]);
  const [activeHlsSub, setActiveHlsSub] = useState(-1);

  const [chapters, setChapters] = useState<Chapter[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processedUrl, setProcessedUrl] = useState("");

  const [seekIndicator, setSeekIndicator] = useState<"forward" | "backward" | null>(null);

  /* ---------------------------------------------------------------- */
  /*  Derived                                                          */
  /* ---------------------------------------------------------------- */

  const activeSub = useMemo(() => {
    if (!subtitlesEnabled || subtitleCues.length === 0) return "";
    const cue = subtitleCues.find(
      (c) => currentTime >= c.start && currentTime <= c.end
    );
    return cue?.text ?? "";
  }, [currentTime, subtitleCues, subtitlesEnabled]);

  const currentChapter = useMemo(() => {
    if (chapters.length === 0) return null;
    return chapters.find((c) => currentTime >= c.start && currentTime < c.end) ?? null;
  }, [currentTime, chapters]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  /* ---------------------------------------------------------------- */
  /*  Volume Boost — Web Audio API                                     */
  /* ---------------------------------------------------------------- */

  const initAudioBoost = useCallback(() => {
    const video = videoRef.current;
    if (!video || audioCtxRef.current) return;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(video);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainRef.current = gain;
    } catch (err) {
      console.warn("Audio boost init failed:", err);
    }
  }, []);

  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value = muted ? 0 : volume;
    }
    const video = videoRef.current;
    if (video) {
      if (audioCtxRef.current) {
        video.volume = 1;
      } else {
        video.volume = Math.min(1, volume);
      }
    }
  }, [volume, muted]);

  const ensureAudioCtx = useCallback(async () => {
    if (audioCtxRef.current?.state === "suspended") {
      await audioCtxRef.current.resume();
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Source resolution                                                 */
  /* ---------------------------------------------------------------- */

  const activeSrc = processedUrl || objectUrl || src || "";

  useEffect(() => {
    setError("");
    setUsingProxy(false);
    setAudioTracks([]);
    setEmbeddedSubTracks([]);
    setHlsSubTracks([]);
    setActiveEmbeddedSub(-1);
    setActiveHlsSub(-1);
    setProcessedUrl("");
    setSubtitleCues([]);
  }, [src, objectUrl]);

  const proxyUrl = useCallback(
    (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`,
    []
  );

  const resolvedSrc = useMemo(() => {
    if (processedUrl) return processedUrl;
    if (objectUrl) return objectUrl;
    if (usingProxy && src) return proxyUrl(src);
    return src || "";
  }, [processedUrl, objectUrl, usingProxy, src, proxyUrl]);

  /* ---------------------------------------------------------------- */
  /*  FFmpeg probe for local files                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!localFile) return;
    let cancelled = false;

    (async () => {
      try {
        setProcessingStatus("Analyzing media\u2026");
        setIsProcessing(true);

        const { probeFile } = await import("@/lib/ffmpegHelper");
        const result = await probeFile(localFile, setProcessingProgress);
        if (cancelled) return;

        const audioStreams = result.streams.filter((s) => s.type === "audio");
        if (audioStreams.length > 0) {
          setAudioTracks(
            audioStreams.map((s, i) => ({
              id: i,
              label: s.label,
              language: s.language,
              enabled: i === 0,
            }))
          );
        }

        const subStreams = result.streams.filter((s) => s.type === "subtitle");
        if (subStreams.length > 0) {
          setEmbeddedSubTracks(
            subStreams.map((s) => ({
              streamIndex: s.index,
              label: s.label,
              language: s.language,
              codec: s.codec,
            }))
          );
        }

        if (result.chapters.length > 0) {
          setChapters(result.chapters.map((c) => ({ start: c.start, end: c.end, title: c.title })));
        }

        if (result.needsVideoTranscode || result.needsAudioTranscode || result.needsRemux) {
          const { processForPlayback } = await import("@/lib/ffmpegHelper");
          const url = await processForPlayback(localFile, result, setProcessingProgress, setProcessingStatus);
          if (!cancelled) setProcessedUrl(url);
        }
      } catch (err) {
        if (!cancelled) console.warn("FFmpeg processing failed:", err);
      } finally {
        if (!cancelled) {
          setIsProcessing(false);
          setProcessingStatus("");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [localFile]);

  /* ---------------------------------------------------------------- */
  /*  Source attachment                                                 */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolvedSrc) return;

    setError("");

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (dashRef.current) { dashRef.current.reset(); dashRef.current = null; }

    if (objectUrl || processedUrl) {
      video.src = processedUrl || objectUrl || "";
      video.load();
      return;
    }

    const streamType = detectStreamType(resolvedSrc);

    if (streamType === "hls") {
      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(resolvedSrc);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const tracks = hls.audioTracks.map((t, i) => ({
            id: i,
            label: t.name || `Track ${i + 1}`,
            language: t.lang || "unknown",
            enabled: i === hls.audioTrack,
          }));
          setAudioTracks(tracks);
          setActiveAudioTrack(hls.audioTrack);

          if (hls.subtitleTracks.length > 0) {
            setHlsSubTracks(
              hls.subtitleTracks.map((t, i) => ({
                id: i,
                label: t.name || `Subtitle ${i + 1}`,
                language: t.lang || "unknown",
              }))
            );
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            if (!usingProxy && src) setUsingProxy(true);
            else setError("Failed to load HLS stream");
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = resolvedSrc;
        video.load();
      }
    } else if (streamType === "dash") {
      import("dashjs").then(({ MediaPlayer: DashMediaPlayer }) => {
        const player = DashMediaPlayer().create();
        dashRef.current = player;
        player.initialize(video, resolvedSrc, false);

        player.on("streamInitialized", () => {
          const tracks = player.getTracksFor("audio");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mapped = tracks.map((t: any, i: number) => ({
            id: i,
            label: t.lang || `Track ${i + 1}`,
            language: t.lang || "unknown",
            enabled: i === 0,
          }));
          setAudioTracks(mapped);

          const textTracks = player.getTracksFor("text");
          if (textTracks.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setHlsSubTracks(textTracks.map((t: any, i: number) => ({
              id: i,
              label: t.lang || `Subtitle ${i + 1}`,
              language: t.lang || "unknown",
            })));
          }
        });

        player.on("error", () => {
          if (!usingProxy && src) setUsingProxy(true);
          else setError("Failed to load DASH stream");
        });
      });
    } else {
      video.src = resolvedSrc;
      video.load();
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (dashRef.current) { dashRef.current.reset(); dashRef.current = null; }
    };
  }, [resolvedSrc, objectUrl, processedUrl, usingProxy, src]);

  /* Native audio tracks */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nativeTracks = (video as any).audioTracks;
      if (nativeTracks && nativeTracks.length > 1 && audioTracks.length === 0) {
        const tracks: AudioTrack[] = [];
        for (let i = 0; i < nativeTracks.length; i++) {
          const t = nativeTracks[i];
          tracks.push({
            id: i,
            label: t.label || `Track ${i + 1}`,
            language: t.language || "unknown",
            enabled: t.enabled,
          });
        }
        setAudioTracks(tracks);
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => video.removeEventListener("loadedmetadata", handleLoadedMetadata);
  }, [activeSrc, audioTracks.length]);

  /* ---------------------------------------------------------------- */
  /*  Playback events                                                  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => {
      setDuration(video.duration);
      setChapters((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.end === 0 || last.end > video.duration + 60) {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, end: video.duration };
          return updated;
        }
        return prev;
      });
    };
    const onPlay = () => { setPlaying(true); setError(""); };
    const onPause = () => setPlaying(false);
    const onProgress = () => {
      if (video.buffered.length > 0) setBuffered(video.buffered.end(video.buffered.length - 1));
    };
    const onError = () => {
      if (!usingProxy && src && !objectUrl && !processedUrl) {
        setUsingProxy(true);
      } else if (!isProcessing && !processedUrl) {
        setError("Unable to load this media. The format may be unsupported or the link may be inaccessible.");
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("progress", onProgress);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("error", onError);
    };
  }, [usingProxy, src, objectUrl, processedUrl, isProcessing]);

  /* ---------------------------------------------------------------- */
  /*  Controls auto-hide                                               */
  /* ---------------------------------------------------------------- */

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (playing) setControlsVisible(false); }, 3000);
  }, [playing]);

  useEffect(() => { if (!playing) setControlsVisible(true); }, [playing]);

  /* ---------------------------------------------------------------- */
  /*  Actions                                                          */
  /* ---------------------------------------------------------------- */

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    initAudioBoost();
    ensureAudioCtx();
    if (video.paused) {
      video.play().catch((err) => console.warn("Playback failed:", err.message));
    } else {
      video.pause();
    }
  }, [initAudioBoost, ensureAudioCtx]);

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const t = parseFloat(e.target.value);
    video.currentTime = t;
    setCurrentTime(t);
  };

  const seekRelative = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + delta));
  }, []);

  const changeVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (v > 1 && !audioCtxRef.current) initAudioBoost();
    if (v === 0) setMuted(true);
    else setMuted(false);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const next = !muted;
    video.muted = next;
    setMuted(next);
    if (gainRef.current) gainRef.current.gain.value = next ? 0 : volume;
  };

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      await el.requestFullscreen().catch((e) => console.warn("Fullscreen failed:", e.message));
      setFullscreen(true);
    } else {
      await document.exitFullscreen().catch((e) => console.warn("Exit fullscreen failed:", e.message));
      setFullscreen(false);
    }
  }, []);

  const switchAudioTrack = (id: number) => {
    if (hlsRef.current) hlsRef.current.audioTrack = id;
    if (dashRef.current) {
      const tracks = dashRef.current.getTracksFor("audio");
      if (tracks[id]) dashRef.current.setCurrentTrack(tracks[id]);
    }
    const video = videoRef.current;
    if (video) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nativeTracks = (video as any).audioTracks;
      if (nativeTracks) {
        for (let i = 0; i < nativeTracks.length; i++) nativeTracks[i].enabled = i === id;
      }
    }
    setActiveAudioTrack(id);
    setAudioTracks((prev) => prev.map((t) => ({ ...t, enabled: t.id === id })));
  };

  const handleSubtitleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const cues = parseSubtitleFile(text, file.name);
      setSubtitleCues(cues);
      setSubtitlesEnabled(true);
      setActiveEmbeddedSub(-1);
      setActiveHlsSub(-1);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const selectEmbeddedSub = useCallback(async (idx: number) => {
    if (idx === -1) { setActiveEmbeddedSub(-1); setSubtitleCues([]); return; }
    const track = embeddedSubTracks[idx];
    if (!track) return;
    if (track.cues) {
      setSubtitleCues(track.cues);
      setSubtitlesEnabled(true);
      setActiveEmbeddedSub(idx);
      setActiveHlsSub(-1);
      return;
    }
    if (!localFile) return;
    setExtractingSub(true);
    try {
      const { extractSubtitle } = await import("@/lib/ffmpegHelper");
      const cues = await extractSubtitle(localFile, track.streamIndex, track.codec);
      setEmbeddedSubTracks((prev) => prev.map((t, i) => (i === idx ? { ...t, cues } : t)));
      setSubtitleCues(cues);
      setSubtitlesEnabled(true);
      setActiveEmbeddedSub(idx);
      setActiveHlsSub(-1);
    } catch (err) {
      console.warn("Subtitle extraction failed:", err);
    } finally {
      setExtractingSub(false);
    }
  }, [embeddedSubTracks, localFile]);

  const selectHlsSub = useCallback((id: number) => {
    if (hlsRef.current) hlsRef.current.subtitleTrack = id;
    if (dashRef.current && id >= 0) {
      const textTracks = dashRef.current.getTracksFor("text");
      if (textTracks[id]) dashRef.current.setCurrentTrack(textTracks[id]);
    }
    setActiveHlsSub(id);
    setActiveEmbeddedSub(-1);
    if (id >= 0) {
      setSubtitleCues([]);
      const video = videoRef.current;
      if (video) {
        for (let i = 0; i < video.textTracks.length; i++)
          video.textTracks[i].mode = i === id ? "showing" : "disabled";
      }
    } else {
      const video = videoRef.current;
      if (video) {
        for (let i = 0; i < video.textTracks.length; i++)
          video.textTracks[i].mode = "disabled";
      }
    }
  }, []);

  const handleChapterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setChapters(parseChapters(text, duration || undefined));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const jumpToChapter = useCallback((ch: Chapter) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = ch.start;
    setCurrentTime(ch.start);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Double-tap                                                       */
  /* ---------------------------------------------------------------- */

  const showSeekFeedback = useCallback((dir: "forward" | "backward") => {
    setSeekIndicator(dir);
    setTimeout(() => setSeekIndicator(null), 700);
  }, []);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (settingsOpen) { setSettingsOpen(false); setSettingsPanel("main"); return; }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relativeX = (e.clientX - rect.left) / rect.width;

    tapCountRef.current++;
    if (tapCountRef.current === 1) {
      tapTimerRef.current = setTimeout(() => {
        if (tapCountRef.current === 1) togglePlay();
        tapCountRef.current = 0;
      }, 300);
    } else if (tapCountRef.current >= 2) {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapCountRef.current = 0;
      if (relativeX < 0.35) { seekRelative(-10); showSeekFeedback("backward"); }
      else if (relativeX > 0.65) { seekRelative(10); showSeekFeedback("forward"); }
      else toggleFullscreen();
    }
  }, [settingsOpen, togglePlay, seekRelative, showSeekFeedback, toggleFullscreen]);

  /* ---------------------------------------------------------------- */
  /*  Keyboard shortcuts                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const video = videoRef.current;
      if (!video) return;
      switch (e.key) {
        case " ": case "k": e.preventDefault(); togglePlay(); break;
        case "ArrowLeft": e.preventDefault(); seekRelative(-10); showSeekFeedback("backward"); break;
        case "ArrowRight": e.preventDefault(); seekRelative(10); showSeekFeedback("forward"); break;
        case "ArrowUp": e.preventDefault(); setVolume((v) => Math.min(3, +(v + 0.1).toFixed(2))); break;
        case "ArrowDown": e.preventDefault(); setVolume((v) => Math.max(0, +(v - 0.1).toFixed(2))); break;
        case "f": toggleFullscreen(); break;
        case "m": toggleMute(); break;
        case "c": setSubtitlesEnabled((p) => !p); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, playing, togglePlay, seekRelative, toggleFullscreen]);

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Render: no source placeholder                                    */
  /* ---------------------------------------------------------------- */

  if (!activeSrc && !isProcessing) {
    return (
      <div className="relative w-full aspect-video rounded-2xl bg-[#16161E] flex items-center justify-center border border-white/5">
        <div className="text-center space-y-3">
          <Play className="w-16 h-16 mx-auto text-[#8B5CF6] opacity-40" />
          <p className="text-white/40 text-lg font-medium">
            Paste a URL or drop a file to begin
          </p>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render: Settings panels                                          */
  /* ---------------------------------------------------------------- */

  const hasAnySubs = embeddedSubTracks.length > 0 || hlsSubTracks.length > 0 || subtitleCues.length > 0;

  const renderSettings = () => {
    if (!settingsOpen) return null;
    return (
      <div
        className="absolute bottom-16 right-4 z-50 min-w-[280px] max-h-[70%] overflow-y-auto rounded-xl border border-white/10 bg-[#16161E]/95 backdrop-blur-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {settingsPanel === "main" && (
          <div className="p-2">
            <button onClick={() => setSettingsPanel("audio")} className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm text-white/90 hover:bg-[#8B5CF6]/20 transition-colors">
              <span className="flex items-center gap-2.5"><Languages className="w-4 h-4 text-[#A855F7]" />Audio Tracks</span>
              <span className="flex items-center gap-1 text-white/50 text-xs">{audioTracks.length > 0 ? audioTracks.find((t) => t.enabled)?.label || "Default" : "Default"}<ChevronRight className="w-3.5 h-3.5" /></span>
            </button>
            <button onClick={() => setSettingsPanel("subtitles")} className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm text-white/90 hover:bg-[#8B5CF6]/20 transition-colors">
              <span className="flex items-center gap-2.5"><Subtitles className="w-4 h-4 text-[#A855F7]" />Subtitles</span>
              <span className="flex items-center gap-1 text-white/50 text-xs">{hasAnySubs ? (subtitlesEnabled || activeHlsSub >= 0 ? "On" : "Off") : "None"}<ChevronRight className="w-3.5 h-3.5" /></span>
            </button>
            <button onClick={() => setSettingsPanel("chapters")} className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm text-white/90 hover:bg-[#8B5CF6]/20 transition-colors">
              <span className="flex items-center gap-2.5"><BookOpen className="w-4 h-4 text-[#A855F7]" />Chapters</span>
              <span className="flex items-center gap-1 text-white/50 text-xs">{chapters.length > 0 ? `${chapters.length}` : "None"}<ChevronRight className="w-3.5 h-3.5" /></span>
            </button>
          </div>
        )}

        {settingsPanel === "audio" && (
          <div className="p-2">
            <button onClick={() => setSettingsPanel("main")} className="flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:text-white transition-colors"><ChevronLeft className="w-4 h-4" />Audio Tracks</button>
            <div className="mt-1 space-y-0.5">
              {audioTracks.length === 0 && <p className="px-3 py-2 text-xs text-white/40">No multiple audio tracks detected</p>}
              {audioTracks.map((track) => (
                <button key={track.id} onClick={() => switchAudioTrack(track.id)} className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors ${track.id === activeAudioTrack ? "bg-[#8B5CF6]/30 text-white" : "text-white/70 hover:bg-white/5"}`}>
                  <span>{track.label}{track.language !== "unknown" && track.language !== "und" && <span className="ml-2 text-xs text-white/40 uppercase">{track.language}</span>}</span>
                  {track.id === activeAudioTrack && <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {settingsPanel === "subtitles" && (
          <div className="p-2">
            <button onClick={() => setSettingsPanel("main")} className="flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:text-white transition-colors"><ChevronLeft className="w-4 h-4" />Subtitles</button>
            <div className="mt-1 space-y-0.5">
              <button onClick={() => { setSubtitlesEnabled(false); setActiveEmbeddedSub(-1); selectHlsSub(-1); }} className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors ${!subtitlesEnabled && activeHlsSub < 0 ? "bg-[#8B5CF6]/30 text-white" : "text-white/70 hover:bg-white/5"}`}>
                Off{!subtitlesEnabled && activeHlsSub < 0 && <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />}
              </button>

              {embeddedSubTracks.map((track, i) => (
                <button key={`emb-${i}`} onClick={() => selectEmbeddedSub(i)} disabled={extractingSub} className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors ${activeEmbeddedSub === i ? "bg-[#8B5CF6]/30 text-white" : "text-white/70 hover:bg-white/5"} disabled:opacity-50`}>
                  <span className="flex items-center gap-2">{extractingSub && activeEmbeddedSub === -1 && <Loader2 className="w-3 h-3 animate-spin" />}{track.label}<span className="text-[10px] text-white/30 uppercase">{track.codec}</span></span>
                  {activeEmbeddedSub === i && <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />}
                </button>
              ))}

              {hlsSubTracks.map((track) => (
                <button key={`hls-${track.id}`} onClick={() => selectHlsSub(track.id)} className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors ${activeHlsSub === track.id ? "bg-[#8B5CF6]/30 text-white" : "text-white/70 hover:bg-white/5"}`}>
                  <span>{track.label}{track.language !== "unknown" && <span className="ml-2 text-xs text-white/40 uppercase">{track.language}</span>}</span>
                  {activeHlsSub === track.id && <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />}
                </button>
              ))}

              {subtitleCues.length > 0 && activeEmbeddedSub === -1 && activeHlsSub === -1 && (
                <button onClick={() => setSubtitlesEnabled(true)} className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors ${subtitlesEnabled ? "bg-[#8B5CF6]/30 text-white" : "text-white/70 hover:bg-white/5"}`}>
                  Uploaded Subtitle{subtitlesEnabled && <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />}
                </button>
              )}

              <div className="h-px bg-white/10 my-1" />
              <button onClick={() => subtitleInputRef.current?.click()} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/5 transition-colors"><Upload className="w-3.5 h-3.5 text-[#A855F7]" />Upload Subtitle (.srt, .vtt, .ass)</button>

              {(subtitleCues.length > 0 || activeHlsSub >= 0) && (
                <>
                  <button onClick={() => setSettingsPanel("subStyle")} className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/5 transition-colors">Customize Style<ChevronRight className="w-3.5 h-3.5" /></button>
                  <button onClick={() => { setSubtitleCues([]); setSubtitlesEnabled(false); setActiveEmbeddedSub(-1); selectHlsSub(-1); }} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-400/10 transition-colors"><X className="w-3.5 h-3.5" />Remove All Subtitles</button>
                </>
              )}
            </div>
          </div>
        )}

        {settingsPanel === "subStyle" && (
          <div className="p-3">
            <button onClick={() => setSettingsPanel("subtitles")} className="flex items-center gap-2 px-1 py-1.5 text-sm text-white/60 hover:text-white transition-colors"><ChevronLeft className="w-4 h-4" />Style</button>
            <div className="mt-2 space-y-4">
              <div>
                <label className="text-xs text-white/50 block mb-1.5">Text Size: {subtitleStyle.fontSize}px</label>
                <input type="range" min={12} max={40} value={subtitleStyle.fontSize} onChange={(e) => setSubtitleStyle((s) => ({ ...s, fontSize: parseInt(e.target.value) }))} className="w-full" />
              </div>
              <div>
                <label className="text-xs text-white/50 block mb-1.5">Text Color</label>
                <div className="flex gap-2">
                  {["#FFFFFF", "#FFFF00", "#00FF00", "#00FFFF", "#FF6B6B"].map((c) => (
                    <button key={c} onClick={() => setSubtitleStyle((s) => ({ ...s, color: c }))} className={`w-7 h-7 rounded-full border-2 transition-all ${subtitleStyle.color === c ? "border-[#8B5CF6] scale-110" : "border-white/20"}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-white/50 block mb-1.5">Background Opacity: {Math.round(subtitleStyle.bgOpacity * 100)}%</label>
                <input type="range" min={0} max={1} step={0.1} value={subtitleStyle.bgOpacity} onChange={(e) => setSubtitleStyle((s) => ({ ...s, bgOpacity: parseFloat(e.target.value) }))} className="w-full" />
              </div>
            </div>
          </div>
        )}

        {settingsPanel === "chapters" && (
          <div className="p-2">
            <button onClick={() => setSettingsPanel("main")} className="flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:text-white transition-colors"><ChevronLeft className="w-4 h-4" />Chapters</button>
            <div className="mt-1 space-y-0.5 max-h-60 overflow-y-auto">
              {chapters.length === 0 && <p className="px-3 py-2 text-xs text-white/40">No chapters loaded</p>}
              {chapters.map((ch, i) => (
                <button key={i} onClick={() => jumpToChapter(ch)} className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors ${currentChapter === ch ? "bg-[#8B5CF6]/30 text-white" : "text-white/70 hover:bg-white/5"}`}>
                  <span className="truncate mr-2">{ch.title}</span>
                  <span className="text-xs text-white/40 font-mono shrink-0">{formatTime(ch.start)}</span>
                </button>
              ))}
            </div>
            <div className="h-px bg-white/10 my-1" />
            <button onClick={() => chapterInputRef.current?.click()} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/5 transition-colors"><Upload className="w-3.5 h-3.5 text-[#A855F7]" />Upload Chapters</button>
            {chapters.length > 0 && (
              <button onClick={() => setChapters([])} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-400/10 transition-colors"><X className="w-3.5 h-3.5" />Remove Chapters</button>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black group"
      onMouseMove={showControls}
      onMouseLeave={() => { if (playing) setControlsVisible(false); }}
      onClick={handleContainerClick}
    >
      <video ref={videoRef} className="w-full h-full object-contain bg-black" playsInline crossOrigin="anonymous" />

      {/* Processing overlay */}
      {isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/80">
          <div className="text-center space-y-4 px-6 max-w-md">
            <Loader2 className="w-12 h-12 mx-auto text-[#8B5CF6] animate-spin" />
            <p className="text-white/80 text-sm font-medium">{processingStatus || "Processing\u2026"}</p>
            {processingProgress > 0 && processingProgress < 1 && (
              <div className="w-48 mx-auto h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-[#8B5CF6] rounded-full transition-all" style={{ width: `${Math.round(processingProgress * 100)}%` }} />
              </div>
            )}
            <p className="text-white/40 text-xs">FFmpeg WASM is converting the file for browser playback</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-40 bg-black/80">
          <div className="text-center space-y-3 px-6 max-w-md">
            <div className="w-14 h-14 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto"><X className="w-7 h-7 text-red-400" /></div>
            <p className="text-white/80 text-sm font-medium">{error}</p>
            <p className="text-white/40 text-xs">Check that the URL is correct and the server is reachable</p>
          </div>
        </div>
      )}

      {/* Hidden file inputs */}
      <input ref={subtitleInputRef} type="file" accept=".srt,.vtt,.ass,.ssa" className="hidden" onChange={handleSubtitleUpload} />
      <input ref={chapterInputRef} type="file" accept=".txt,.ogm,.chapters" className="hidden" onChange={handleChapterUpload} />

      {/* Double-tap seek indicator */}
      {seekIndicator && (
        <div className={`absolute top-1/2 -translate-y-1/2 z-40 pointer-events-none ${seekIndicator === "backward" ? "left-[12%]" : "right-[12%]"}`}>
          <div className="bg-white/15 backdrop-blur-sm rounded-full p-5 flex flex-col items-center gap-1">
            {seekIndicator === "backward" ? <Rewind className="w-8 h-8 text-white" /> : <FastForward className="w-8 h-8 text-white" />}
            <span className="text-xs text-white font-semibold">10s</span>
          </div>
        </div>
      )}

      {/* Subtitle overlay */}
      {activeSub && (
        <div className="subtitle-overlay absolute bottom-20 left-0 right-0 flex justify-center px-4 z-30">
          <span className="inline-block px-4 py-2 rounded-lg max-w-[80%] text-center leading-relaxed whitespace-pre-line" style={{ fontSize: `${subtitleStyle.fontSize}px`, color: subtitleStyle.color, backgroundColor: `rgba(0, 0, 0, ${subtitleStyle.bgOpacity})` }}>
            {activeSub}
          </span>
        </div>
      )}

      {/* Big play button */}
      {!playing && !isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="w-20 h-20 rounded-full bg-[#8B5CF6]/80 backdrop-blur-sm flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.4)]">
            <Play className="w-9 h-9 text-white ml-1" fill="white" />
          </div>
        </div>
      )}

      {/* Gradient overlay */}
      <div className={`absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-20 transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0"}`} />

      {/* Controls bar */}
      <div className={`absolute bottom-0 left-0 right-0 z-30 px-4 pb-3 pt-2 transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`} onClick={(e) => e.stopPropagation()}>
        {/* Current chapter label */}
        {currentChapter && <div className="text-[10px] text-white/50 mb-0.5 truncate font-medium">{currentChapter.title}</div>}

        {/* Progress bar */}
        <div className="relative w-full h-5 flex items-center group/progress mb-1 cursor-pointer">
          <div className="absolute left-0 right-0 h-1 rounded-full bg-white/20 group-hover/progress:h-1.5 transition-all">
            <div className="absolute top-0 left-0 h-full bg-white/20 rounded-full" style={{ width: `${bufferedPct}%` }} />
            <div className="absolute top-0 left-0 h-full bg-[#8B5CF6] rounded-full" style={{ width: `${progress}%` }} />
            {chapters.map((ch, i) => duration > 0 ? <div key={i} className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/60 rounded-full" style={{ left: `${(ch.start / duration) * 100}%` }} title={ch.title} /> : null)}
          </div>
          <input type="range" min={0} max={duration || 0} step={0.1} value={currentTime} onChange={seek} className="absolute inset-0 w-full opacity-0 cursor-pointer" />
          <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#8B5CF6] border-2 border-white opacity-0 group-hover/progress:opacity-100 transition-opacity pointer-events-none" style={{ left: `calc(${progress}% - 7px)` }} />
        </div>

        {/* Bottom controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {chapters.length > 0 && (
              <button onClick={() => { const prev = [...chapters].reverse().find((c) => c.start < currentTime - 2); if (prev) jumpToChapter(prev); else if (chapters[0]) jumpToChapter(chapters[0]); }} className="p-1 rounded-lg text-white hover:bg-white/10 transition-colors" aria-label="Previous chapter"><SkipBack className="w-4 h-4" /></button>
            )}
            <button onClick={togglePlay} className="p-1.5 rounded-lg text-white hover:bg-white/10 transition-colors" aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="w-5 h-5" fill="white" /> : <Play className="w-5 h-5 ml-0.5" fill="white" />}
            </button>
            {chapters.length > 0 && (
              <button onClick={() => { const next = chapters.find((c) => c.start > currentTime + 1); if (next) jumpToChapter(next); }} className="p-1 rounded-lg text-white hover:bg-white/10 transition-colors" aria-label="Next chapter"><SkipForward className="w-4 h-4" /></button>
            )}

            {/* Volume with boost */}
            <div className="flex items-center gap-1.5 group/vol">
              <button onClick={toggleMute} className="p-1.5 rounded-lg text-white hover:bg-white/10 transition-colors" aria-label={muted ? "Unmute" : "Mute"}>
                {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <div className="w-0 overflow-hidden group-hover/vol:w-32 transition-all duration-200 flex items-center gap-1.5">
                <input type="range" min={0} max={3} step={0.05} value={muted ? 0 : volume} onChange={changeVolume} className="w-20" />
                <span className={`text-[10px] font-mono tabular-nums whitespace-nowrap ${volume > 1 ? "text-amber-400" : "text-white/50"}`}>{Math.round(volume * 100)}%</span>
              </div>
            </div>

            <span className="text-xs text-white/70 font-mono tabular-nums select-none">
              {formatTime(currentTime)} <span className="text-white/40">/</span> {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button onClick={(e) => { e.stopPropagation(); setSettingsOpen(!settingsOpen); setSettingsPanel("main"); }} className={`p-1.5 rounded-lg text-white hover:bg-white/10 transition-all ${settingsOpen ? "bg-white/10 rotate-45" : ""}`} aria-label="Settings">
              <Settings className="w-5 h-5 transition-transform" />
            </button>
            <button onClick={toggleFullscreen} className="p-1.5 rounded-lg text-white hover:bg-white/10 transition-colors" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {renderSettings()}
    </div>
  );
}
