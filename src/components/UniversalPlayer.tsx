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
} from "lucide-react";
import { parseSubtitleFile, SubtitleCue } from "@/lib/subtitleParser";

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
  fontSize: number; // px
  color: string;
  bgOpacity: number; // 0-1
}

type SettingsPanel = "main" | "audio" | "subtitles" | "subStyle";

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
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return "hls";
  if (lower.includes(".mpd")) return "dash";
  if (
    lower.includes(".mp4") ||
    lower.includes(".webm") ||
    lower.includes(".ogg")
  )
    return "native";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function UniversalPlayer({
  src,
  objectUrl,
}: {
  src?: string;
  objectUrl?: string;
}) {
  /* Refs */
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dashRef = useRef<any>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);

  /* Playback state */
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [buffered, setBuffered] = useState(0);

  /* Settings panel */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>("main");

  /* Audio tracks */
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState(0);

  /* Subtitles */
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>({
    fontSize: 20,
    color: "#FFFFFF",
    bgOpacity: 0.6,
  });

  /* Active subtitle text */
  const activeSub = useMemo(() => {
    if (!subtitlesEnabled || subtitleCues.length === 0) return "";
    const cue = subtitleCues.find(
      (c) => currentTime >= c.start && currentTime <= c.end
    );
    return cue?.text ?? "";
  }, [currentTime, subtitleCues, subtitlesEnabled]);

  /* ---------------------------------------------------------------- */
  /*  Source attachment                                                 */
  /* ---------------------------------------------------------------- */

  const activeSrc = objectUrl || src || "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSrc) return;

    // Cleanup previous instances
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (dashRef.current) {
      dashRef.current.reset();
      dashRef.current = null;
    }

    // If it's an objectURL (local file), play natively
    if (objectUrl) {
      video.src = objectUrl;
      video.load();
      return;
    }

    const streamType = detectStreamType(activeSrc);

    if (streamType === "hls") {
      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(activeSrc);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          // Read HLS audio tracks
          const tracks = hls.audioTracks.map((t, i) => ({
            id: i,
            label: t.name || `Track ${i + 1}`,
            language: t.lang || "unknown",
            enabled: i === hls.audioTrack,
          }));
          setAudioTracks(tracks);
          setActiveAudioTrack(hls.audioTrack);
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari native HLS
        video.src = activeSrc;
        video.load();
      }
    } else if (streamType === "dash") {
      import("dashjs").then(({ MediaPlayer: DashMediaPlayer }) => {
        const player = DashMediaPlayer().create();
        dashRef.current = player;
        player.initialize(video, activeSrc, false);

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
        });
      });
    } else {
      // native mp4/webm or unknown
      video.src = activeSrc;
      video.load();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (dashRef.current) {
        dashRef.current.reset();
        dashRef.current = null;
      }
    };
  }, [activeSrc, objectUrl]);

  /* Read native audio tracks (for local files) */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      // Check for native AudioTrackList (some browsers)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nativeTracks = (video as any).audioTracks;
      if (nativeTracks && nativeTracks.length > 1) {
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
    return () =>
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
  }, [activeSrc]);

  /* ---------------------------------------------------------------- */
  /*  Playback events                                                  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("progress", onProgress);

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("progress", onProgress);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Controls auto-hide                                               */
  /* ---------------------------------------------------------------- */

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playing) setControlsVisible(false);
    }, 3000);
  }, [playing]);

  useEffect(() => {
    if (!playing) setControlsVisible(true);
  }, [playing]);

  /* ---------------------------------------------------------------- */
  /*  Actions                                                          */
  /* ---------------------------------------------------------------- */

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const t = parseFloat(e.target.value);
    video.currentTime = t;
    setCurrentTime(t);
  };

  const changeVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const v = parseFloat(e.target.value);
    video.volume = v;
    setVolume(v);
    if (v === 0) setMuted(true);
    else setMuted(false);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(!muted);
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      await el.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      await document.exitFullscreen().catch(() => {});
      setFullscreen(false);
    }
  };

  /* Audio track switching */
  const switchAudioTrack = (id: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = id;
    }
    if (dashRef.current) {
      const tracks = dashRef.current.getTracksFor("audio");
      if (tracks[id]) dashRef.current.setCurrentTrack(tracks[id]);
    }
    // For native audioTracks
    const video = videoRef.current;
    if (video) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nativeTracks = (video as any).audioTracks;
      if (nativeTracks) {
        for (let i = 0; i < nativeTracks.length; i++) {
          nativeTracks[i].enabled = i === id;
        }
      }
    }
    setActiveAudioTrack(id);
    setAudioTracks((prev) =>
      prev.map((t) => ({ ...t, enabled: t.id === id }))
    );
  };

  /* Subtitle upload */
  const handleSubtitleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const cues = parseSubtitleFile(text, file.name);
      setSubtitleCues(cues);
      setSubtitlesEnabled(true);
    };
    reader.readAsText(file);
    // Reset the input value so the same file can be re-uploaded
    e.target.value = "";
  };

  /* Keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const video = videoRef.current;
      if (!video) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          video.currentTime = Math.max(video.currentTime - 10, 0);
          break;
        case "ArrowRight":
          video.currentTime = Math.min(
            video.currentTime + 10,
            video.duration || Infinity
          );
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          toggleMute();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, playing]);

  /* Fullscreen change listener */
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Progress bar percentage                                          */
  /* ---------------------------------------------------------------- */
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  /* ---------------------------------------------------------------- */
  /*  Render: no source placeholder                                    */
  /* ---------------------------------------------------------------- */

  if (!activeSrc) {
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
  /*  Render: Settings Panels                                          */
  /* ---------------------------------------------------------------- */

  const renderSettings = () => {
    if (!settingsOpen) return null;

    return (
      <div
        className="absolute bottom-16 right-4 z-50 min-w-[260px] rounded-xl border border-white/10 bg-[#16161E]/95 backdrop-blur-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Main Menu */}
        {settingsPanel === "main" && (
          <div className="p-2">
            <button
              onClick={() => setSettingsPanel("audio")}
              className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm text-white/90 hover:bg-[#8B5CF6]/20 transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Languages className="w-4 h-4 text-[#A855F7]" />
                Audio Tracks
              </span>
              <span className="flex items-center gap-1 text-white/50 text-xs">
                {audioTracks.length > 0
                  ? audioTracks.find((t) => t.enabled)?.label || "Default"
                  : "Default"}
                <ChevronRight className="w-3.5 h-3.5" />
              </span>
            </button>
            <button
              onClick={() => setSettingsPanel("subtitles")}
              className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm text-white/90 hover:bg-[#8B5CF6]/20 transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Subtitles className="w-4 h-4 text-[#A855F7]" />
                Subtitles
              </span>
              <span className="flex items-center gap-1 text-white/50 text-xs">
                {subtitleCues.length > 0
                  ? subtitlesEnabled
                    ? "On"
                    : "Off"
                  : "None"}
                <ChevronRight className="w-3.5 h-3.5" />
              </span>
            </button>
          </div>
        )}

        {/* Audio Track Submenu */}
        {settingsPanel === "audio" && (
          <div className="p-2">
            <button
              onClick={() => setSettingsPanel("main")}
              className="flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Audio Tracks
            </button>
            <div className="mt-1 space-y-0.5">
              {audioTracks.length === 0 && (
                <p className="px-3 py-2 text-xs text-white/40">
                  No multiple audio tracks detected
                </p>
              )}
              {audioTracks.map((track) => (
                <button
                  key={track.id}
                  onClick={() => switchAudioTrack(track.id)}
                  className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                    track.id === activeAudioTrack
                      ? "bg-[#8B5CF6]/30 text-white"
                      : "text-white/70 hover:bg-white/5"
                  }`}
                >
                  <span>
                    {track.label}
                    {track.language !== "unknown" && (
                      <span className="ml-2 text-xs text-white/40 uppercase">
                        {track.language}
                      </span>
                    )}
                  </span>
                  {track.id === activeAudioTrack && (
                    <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Subtitle Submenu */}
        {settingsPanel === "subtitles" && (
          <div className="p-2">
            <button
              onClick={() => setSettingsPanel("main")}
              className="flex items-center gap-2 px-3 py-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Subtitles
            </button>

            <div className="mt-1 space-y-1">
              {/* Toggle */}
              {subtitleCues.length > 0 && (
                <button
                  onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}
                  className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                    subtitlesEnabled
                      ? "bg-[#8B5CF6]/30 text-white"
                      : "text-white/70 hover:bg-white/5"
                  }`}
                >
                  {subtitlesEnabled ? "Subtitles On" : "Subtitles Off"}
                  <span
                    className={`w-2 h-2 rounded-full ${subtitlesEnabled ? "bg-green-400" : "bg-white/30"}`}
                  />
                </button>
              )}

              {/* Upload */}
              <button
                onClick={() => subtitleInputRef.current?.click()}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/5 transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-[#A855F7]" />
                Upload Subtitle (.srt, .vtt, .ass)
              </button>

              {subtitleCues.length > 0 && (
                <>
                  <div className="h-px bg-white/10 my-1" />
                  <button
                    onClick={() => setSettingsPanel("subStyle")}
                    className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/5 transition-colors"
                  >
                    Customize Style
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setSubtitleCues([]);
                      setSubtitlesEnabled(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Remove Subtitles
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Subtitle Style Submenu */}
        {settingsPanel === "subStyle" && (
          <div className="p-3">
            <button
              onClick={() => setSettingsPanel("subtitles")}
              className="flex items-center gap-2 px-1 py-1.5 text-sm text-white/60 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Style
            </button>

            <div className="mt-2 space-y-4">
              {/* Font size */}
              <div>
                <label className="text-xs text-white/50 block mb-1.5">
                  Text Size: {subtitleStyle.fontSize}px
                </label>
                <input
                  type="range"
                  min={12}
                  max={40}
                  value={subtitleStyle.fontSize}
                  onChange={(e) =>
                    setSubtitleStyle((s) => ({
                      ...s,
                      fontSize: parseInt(e.target.value),
                    }))
                  }
                  className="w-full"
                />
              </div>

              {/* Color */}
              <div>
                <label className="text-xs text-white/50 block mb-1.5">
                  Text Color
                </label>
                <div className="flex gap-2">
                  {["#FFFFFF", "#FFFF00", "#00FF00", "#00FFFF", "#FF6B6B"].map(
                    (c) => (
                      <button
                        key={c}
                        onClick={() =>
                          setSubtitleStyle((s) => ({ ...s, color: c }))
                        }
                        className={`w-7 h-7 rounded-full border-2 transition-all ${
                          subtitleStyle.color === c
                            ? "border-[#8B5CF6] scale-110"
                            : "border-white/20"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    )
                  )}
                </div>
              </div>

              {/* BG Opacity */}
              <div>
                <label className="text-xs text-white/50 block mb-1.5">
                  Background Opacity:{" "}
                  {Math.round(subtitleStyle.bgOpacity * 100)}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={subtitleStyle.bgOpacity}
                  onChange={(e) =>
                    setSubtitleStyle((s) => ({
                      ...s,
                      bgOpacity: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full"
                />
              </div>
            </div>
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
      onMouseLeave={() => {
        if (playing) setControlsVisible(false);
      }}
      onClick={(e) => {
        // Close settings if clicking outside
        if (settingsOpen) {
          setSettingsOpen(false);
          setSettingsPanel("main");
          return;
        }
        togglePlay();
      }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain bg-black"
        playsInline
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={toggleFullscreen}
      />

      {/* Hidden subtitle file input */}
      <input
        ref={subtitleInputRef}
        type="file"
        accept=".srt,.vtt,.ass,.ssa"
        className="hidden"
        onChange={handleSubtitleUpload}
      />

      {/* Subtitle overlay */}
      {activeSub && (
        <div className="subtitle-overlay absolute bottom-20 left-0 right-0 flex justify-center px-4 z-30">
          <span
            className="inline-block px-4 py-2 rounded-lg max-w-[80%] text-center leading-relaxed whitespace-pre-line"
            style={{
              fontSize: `${subtitleStyle.fontSize}px`,
              color: subtitleStyle.color,
              backgroundColor: `rgba(0, 0, 0, ${subtitleStyle.bgOpacity})`,
            }}
          >
            {activeSub}
          </span>
        </div>
      )}

      {/* Big play button (when paused) */}
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="w-20 h-20 rounded-full bg-[#8B5CF6]/80 backdrop-blur-sm flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.4)]">
            <Play className="w-9 h-9 text-white ml-1" fill="white" />
          </div>
        </div>
      )}

      {/* Gradient overlay (bottom) */}
      <div
        className={`absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-20 transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Controls bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-30 px-4 pb-3 pt-2 transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div className="relative w-full h-5 flex items-center group/progress mb-1 cursor-pointer">
          {/* Track background */}
          <div className="absolute left-0 right-0 h-1 rounded-full bg-white/20 group-hover/progress:h-1.5 transition-all">
            {/* Buffered */}
            <div
              className="absolute top-0 left-0 h-full bg-white/20 rounded-full"
              style={{ width: `${bufferedPct}%` }}
            />
            {/* Progress */}
            <div
              className="absolute top-0 left-0 h-full bg-[#8B5CF6] rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={seek}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
          {/* Thumb indicator */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#8B5CF6] border-2 border-white opacity-0 group-hover/progress:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `calc(${progress}% - 7px)` }}
          />
        </div>

        {/* Bottom controls */}
        <div className="flex items-center justify-between">
          {/* Left side */}
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="p-1.5 rounded-lg text-white hover:bg-white/10 transition-colors"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="w-5 h-5" fill="white" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" fill="white" />
              )}
            </button>

            {/* Volume */}
            <div className="flex items-center gap-1.5 group/vol">
              <button
                onClick={toggleMute}
                className="p-1.5 rounded-lg text-white hover:bg-white/10 transition-colors"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
              <div className="w-0 overflow-hidden group-hover/vol:w-20 transition-all duration-200">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={changeVolume}
                  className="w-20"
                />
              </div>
            </div>

            {/* Time */}
            <span className="text-xs text-white/70 font-mono tabular-nums select-none">
              {formatTime(currentTime)}{" "}
              <span className="text-white/40">/</span>{" "}
              {formatTime(duration)}
            </span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-1.5">
            {/* Settings */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen(!settingsOpen);
                setSettingsPanel("main");
              }}
              className={`p-1.5 rounded-lg text-white hover:bg-white/10 transition-all ${
                settingsOpen ? "bg-white/10 rotate-45" : ""
              }`}
              aria-label="Settings"
            >
              <Settings className="w-5 h-5 transition-transform" />
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg text-white hover:bg-white/10 transition-colors"
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? (
                <Minimize className="w-5 h-5" />
              ) : (
                <Maximize className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Settings menu */}
      {renderSettings()}
    </div>
  );
}
