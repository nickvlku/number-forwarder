"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { encodeWav } from "@/lib/wav";
import { formatDuration } from "@/lib/format";

const MAX_SECONDS = 60;
const TARGET_RATE = 16000;

type Phase = "idle" | "recording" | "processing" | "review" | "saving";

/** Decodes whatever the browser recorded (webm/opus, mp4/aac) and re-encodes it as 16 kHz mono WAV for Twilio. */
async function toWav(blob: Blob): Promise<ArrayBuffer> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.ceil(decoded.duration * TARGET_RATE);
    const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0), TARGET_RATE);
  } finally {
    await ctx.close();
  }
}

export function GreetingRecorder({ hasRecording }: { hasRecording: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const wav = useRef<ArrayBuffer | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const start = async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio. Try Chrome or Safari over HTTPS.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setPhase("processing");
        try {
          const buf = await toWav(new Blob(chunks.current, { type: rec.mimeType }));
          wav.current = buf;
          setPreviewUrl(URL.createObjectURL(new Blob([buf], { type: "audio/wav" })));
          setPhase("review");
        } catch (err) {
          setError(`Could not process the recording: ${err instanceof Error ? err.message : String(err)}`);
          setPhase("idle");
        }
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setPhase("recording");
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof DOMException && err.name === "NotAllowedError" ? "Microphone access was denied." : String(err));
    }
  };

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  const discard = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    wav.current = null;
    setPhase("idle");
  };

  const save = async () => {
    if (!wav.current) return;
    setPhase("saving");
    setError(null);
    const res = await fetch("/api/greeting", { method: "PUT", headers: { "content-type": "audio/wav" }, body: wav.current });
    if (!res.ok) {
      setError(`Save failed: ${await res.text()}`);
      setPhase("review");
      return;
    }
    discard();
    router.refresh();
  };

  const remove = async () => {
    if (!window.confirm("Remove the recording and go back to text-to-speech?")) return;
    setError(null);
    const res = await fetch("/api/greeting", { method: "DELETE" });
    if (!res.ok) {
      setError(`Remove failed: ${await res.text()}`);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3 pt-1">
      {phase === "idle" && (
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" className="btn-primary" onClick={start}>
            {hasRecording ? "Record a new greeting" : "Record greeting"}
          </button>
          {hasRecording && (
            <button type="button" className="btn" onClick={remove}>
              Remove recording
            </button>
          )}
          <span className="muted text-xs">Up to {MAX_SECONDS} seconds. Saved as mono 16 kHz WAV.</span>
        </div>
      )}

      {phase === "recording" && (
        <div className="flex items-center gap-3">
          <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: "var(--danger)" }} />
          <span className="num font-semibold">Recording {formatDuration(seconds)}</span>
          <button type="button" className="btn" onClick={stop}>
            Stop
          </button>
        </div>
      )}

      {phase === "processing" && <p className="muted text-sm">Processing…</p>}

      {(phase === "review" || phase === "saving") && previewUrl && (
        <div className="flex flex-col gap-2">
          <div className="label">New take</div>
          <audio controls src={previewUrl} className="w-full" />
          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary" onClick={save} disabled={phase === "saving"}>
              {phase === "saving" ? "Saving…" : "Save as greeting"}
            </button>
            <button type="button" className="btn" onClick={discard} disabled={phase === "saving"}>
              Discard
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
