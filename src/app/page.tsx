"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Play,
  Link as LinkIcon,
  Upload,
  Film,
  Sparkles,
  MonitorPlay,
} from "lucide-react";
import UniversalPlayer from "@/components/UniversalPlayer";

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0A0A0B]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <MonitorPlay className="w-7 h-7 text-[#8B5CF6]" />
          <span className="text-xl font-bold text-white tracking-tight">
            Stream<span className="text-[#A855F7]">Pro</span>
          </span>
          <span className="ml-1.5 rounded-md bg-[#8B5CF6]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#A855F7] border border-[#8B5CF6]/30">
            Pro
          </span>
        </div>
        <nav className="flex items-center gap-6 text-sm text-white/50">
          <span className="hidden sm:inline hover:text-white/80 transition-colors cursor-pointer">
            Player
          </span>
          <span className="hidden sm:inline hover:text-white/80 transition-colors cursor-pointer">
            Docs
          </span>
          <div className="h-5 w-px bg-white/10 hidden sm:block" />
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-white/40">Ready</span>
          </div>
        </nav>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [url, setUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [objectUrl, setObjectUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Revoke object URL on unmount to prevent memory leaks */
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Handle URL submit */
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    // Cleanup any previous object URL
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      setObjectUrl("");
    }
    setFileName("");
    setActiveUrl(url.trim());
  };

  /* Handle file (drag or browse) */
  const handleFile = useCallback(
    (file: File) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const blobUrl = URL.createObjectURL(file);
      setObjectUrl(blobUrl);
      setFileName(file.name);
      setActiveUrl("");
      setUrl("");
    },
    [objectUrl]
  );

  /* Drag & drop */
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B]">
      <Header />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-28 pb-16">
        {/* Hero text */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 px-4 py-1.5 mb-5">
            <Sparkles className="w-3.5 h-3.5 text-[#A855F7]" />
            <span className="text-xs font-medium text-[#A855F7]">
              Universal Media Player
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-tight">
            Play{" "}
            <span className="bg-gradient-to-r from-[#8B5CF6] to-[#A855F7] bg-clip-text text-transparent">
              anything
            </span>
            , anywhere
          </h1>
          <p className="mt-3 text-white/40 text-base sm:text-lg max-w-xl mx-auto">
            MP4 · WebM · HLS · DASH · MKV — paste a streaming link or drop a
            local file
          </p>
        </div>

        {/* Input section */}
        <div className="max-w-3xl mx-auto mb-10 space-y-4">
          {/* URL input */}
          <form onSubmit={handleUrlSubmit} className="relative">
            <div className="absolute inset-0 rounded-xl bg-[#8B5CF6]/10 blur-xl -z-10" />
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#16161E]/80 backdrop-blur-sm px-4 py-3 focus-within:border-[#8B5CF6]/50 focus-within:shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-all">
              <LinkIcon className="w-5 h-5 text-[#8B5CF6] shrink-0" />
              <input
                type="text"
                placeholder="Paste streaming URL (.mp4, .m3u8, .mpd, .webm)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1 bg-transparent text-white text-sm placeholder-white/30 outline-none"
              />
              <button
                type="submit"
                disabled={!url.trim()}
                className="flex items-center gap-2 rounded-lg bg-[#8B5CF6] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#A855F7] disabled:opacity-30 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(139,92,246,0.3)]"
              >
                <Play className="w-4 h-4" fill="white" />
                Play
              </button>
            </div>
          </form>

          {/* Drop zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200 ${
              dragging
                ? "border-[#8B5CF6] bg-[#8B5CF6]/10 shadow-[0_0_20px_rgba(139,92,246,0.2)]"
                : "border-white/10 bg-[#16161E]/50 hover:border-white/20 hover:bg-[#16161E]/70"
            } px-6 py-6 text-center`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mkv,.mp4,.webm,.avi,.mov"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
            <div className="flex items-center justify-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/20">
                <Upload className="w-5 h-5 text-[#A855F7]" />
              </div>
              <div className="text-left">
                <p className="text-sm text-white/70 font-medium">
                  Drop a file here or{" "}
                  <span className="text-[#A855F7]">browse</span>
                </p>
                <p className="text-xs text-white/30 mt-0.5">
                  Supports MP4, WebM, MKV, AVI, MOV
                </p>
              </div>
            </div>
            {fileName && (
              <div className="mt-3 inline-flex items-center gap-2 bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 rounded-lg px-3 py-1.5">
                <Film className="w-3.5 h-3.5 text-[#A855F7]" />
                <span className="text-xs text-white/70 font-mono">
                  {fileName}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Player stage */}
        <div className="relative max-w-5xl mx-auto">
          {/* Cinematic backglow */}
          <div className="absolute -inset-6 rounded-3xl bg-[#8B5CF6]/8 blur-3xl -z-10 pointer-events-none" />
          <div className="rounded-2xl border border-white/5 overflow-hidden shadow-2xl glow-violet-lg">
            <UniversalPlayer src={activeUrl} objectUrl={objectUrl} />
          </div>
        </div>

        {/* Format support badges */}
        <div className="flex flex-wrap justify-center gap-2 mt-8">
          {["MP4", "WebM", "HLS", "DASH", "MKV"].map((fmt) => (
            <span
              key={fmt}
              className="rounded-full bg-[#16161E] border border-white/5 px-3 py-1 text-xs text-white/40 font-mono"
            >
              {fmt}
            </span>
          ))}
        </div>
      </main>
    </div>
  );
}
