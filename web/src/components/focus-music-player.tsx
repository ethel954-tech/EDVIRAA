"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Music, Pause, Play, Volume2, X } from "lucide-react";
import {
  FOCUS_TRACKS,
  useFocusTrackId,
  useFocusVolume,
  type FocusTrack,
} from "@/lib/focus-music";

/**
 * App-wide "Focus music" player, mounted once in the authenticated app shell.
 * Collapsed: a small floating pill (bottom-right). Expanded: a compact card
 * with play/pause, track list, and volume.
 *
 * Guarantees:
 *  - Never auto-plays: track + volume are restored paused via
 *    useSyncExternalStore (see focus-music.ts); play() only runs on click.
 *  - Stops cleanly on unmount (logout / app-shell teardown): the <audio>
 *    element is captured inside the effect and paused + released.
 *  - Remembers the last track and volume via localStorage.
 */
export function FocusMusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [open, setOpen] = useState(false);
  const [trackId, setTrackId] = useFocusTrackId();
  const [volume, setVolume] = useFocusVolume();
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const track: FocusTrack =
    FOCUS_TRACKS.find((t) => t.id === trackId) ?? FOCUS_TRACKS[0];
  const available = track.src !== null;

  // Clean stop on unmount: pause + release the source. The element is
  // captured in the effect (per react-hooks/exhaustive-deps guidance).
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };
  }, []);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !available) return;
    setError(null);
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      setLoading(true);
      await audio.play();
      setPlaying(true);
    } catch {
      setError("Playback failed — the audio file may be missing.");
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }, [available, playing]);

  const selectTrack = (id: string) => {
    if (id === trackId) return;
    setTrackId(id);
    // Changing src pauses; nothing auto-plays after a track switch.
  };

  const changeVolume = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolume(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 print:hidden">
      {/* Hidden audio element owned by the player. Declarative src keeps the
          element in sync with the selected track without effects. */}
      <audio
        ref={audioRef}
        src={track.src ?? undefined}
        loop
        preload="none"
        onEnded={() => setPlaying(false)}
        onError={() => {
          if (available) {
            setPlaying(false);
            setError("Audio file unavailable.");
          }
        }}
        aria-hidden="true"
      />

      {open ? (
        <div className="mb-2 w-64 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-[var(--ink)]">Focus music</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Minimize focus music player"
              className="rounded-full p-1 text-[var(--ink-soft)] hover:text-[var(--ink)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ul className="mb-2 space-y-1">
            {FOCUS_TRACKS.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => selectTrack(t.id)}
                  disabled={t.src === null}
                  className={`w-full rounded-[8px] px-2 py-1.5 text-left text-xs ${
                    t.id === trackId
                      ? "bg-[var(--teal-pale)] font-semibold text-[var(--teal-dark)]"
                      : "text-[var(--ink-soft)] hover:bg-[var(--bg)]"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {t.title}
                  {t.src === null ? (
                    <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">
                      (unavailable)
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!available || loading}
              aria-label={playing ? "Pause focus music" : "Play focus music"}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--teal)] text-white disabled:opacity-50"
            >
              {loading ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : playing ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="ml-0.5 h-4 w-4" />
              )}
            </button>

            <Volume2 className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              aria-label="Focus music volume"
              className="h-1 flex-1 accent-[var(--teal)]"
            />
          </div>

          {error ? (
            <p role="alert" className="mt-2 text-[11px] text-red-600">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Hide focus music player" : "Show focus music player"}
        className="ml-auto flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--teal)] shadow-md hover:border-[var(--teal)]"
      >
        <Music className="h-5 w-5" />
      </button>
    </div>
  );
}
