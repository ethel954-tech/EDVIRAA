import { useCallback, useSyncExternalStore } from "react";

/**
 * Focus music catalog — shared by the web player.
 *
 * Licensing rule: every track entry MUST carry a `license` string naming the
 * license (and attribution source). Only royalty-free tracks that permit use
 * in apps are allowed. A track with `src: null` is a placeholder: it renders
 * as "unavailable" in the player until a file is dropped into
 * /public/focus-music and its entry is filled in.
 *
 * Full license notes live in web/public/focus-music/LICENSES.md.
 */

export type FocusTrack = {
  id: string;
  title: string;
  artist: string;
  /** Public path under /public, or null until the file is supplied. */
  src: string | null;
  /** License + attribution that must ship with the track. */
  license: string;
};

export const FOCUS_TRACKS: FocusTrack[] = [
  {
    id: "quiet-piano",
    title: "Quiet Piano",
    artist: "EDVIRAA",
    src: "/focus-music/quiet-piano-loop.wav",
    license: "CC0 — generated in-house for EDVIRAA app use; no third-party copyright restrictions.",
  },
];

const STORAGE_KEY_TRACK = "focus-music:trackId";
const STORAGE_KEY_VOLUME = "focus-music:volume";

/**
 * Persisted-value store: a small external store over localStorage so the
 * player can restore the last choice with useSyncExternalStore — no mount
 * effects, no cascading setState (react-hooks compiler rules).
 */
const persistedListeners = new Map<string, Set<() => void>>();

function subscribeKey(key: string, onChange: () => void) {
  let set = persistedListeners.get(key);
  if (!set) {
    set = new Set();
    persistedListeners.set(key, set);
  }
  set.add(onChange);
  return () => {
    set.delete(onChange);
  };
}

function readPersisted(key: string, fallback: string | number): string | number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    if (typeof fallback === "number") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
    }
    return raw;
  } catch {
    return fallback;
  }
}

function usePersistedValue(key: string, fallback: string | number) {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeKey(key, onChange),
    [key],
  );
  const getSnapshot = useCallback(() => readPersisted(key, fallback), [key, fallback]);
  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => fallback, // server snapshot
  );

  const set = useCallback(
    (next: string | number) => {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // private mode / storage disabled — state still updates in memory
      }
      const listeners = persistedListeners.get(key);
      if (listeners) {
        for (const listener of listeners) listener();
      }
    },
    [key],
  );

  return [value, set] as const;
}

export function useFocusTrackId(): readonly [string, (id: string) => void] {
  const [value, set] = usePersistedValue(STORAGE_KEY_TRACK, FOCUS_TRACKS[0].id);
  const valid = FOCUS_TRACKS.some((t) => t.id === value) ? value : FOCUS_TRACKS[0].id;
  return [valid as string, set];
}

export function useFocusVolume(): readonly [number, (v: number) => void] {
  const [value, set] = usePersistedValue(STORAGE_KEY_VOLUME, 0.6);
  return [value as number, set];
}
