/**
 * Focus music catalog — mobile (expo-av playback).
 *
 * Licensing rule: every track entry MUST carry a `license` string naming the
 * license (and attribution source). Only royalty-free tracks that permit use
 * in apps are allowed. A track with `source: null` is a placeholder: the
 * player shows it as "unavailable" until the file exists.
 *
 * To bundle a track: drop the file in mobile/assets/audio/ and set
 * `source: require('../../assets/audio/<file>.mp3')`. Keep the license text
 * with the file and mirror the entry in web/public/focus-music/LICENSES.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type FocusTrack = {
  id: string;
  title: string;
  artist: string;
  /** Bundled asset via require(), or null until the file is supplied. */
  source: number | null;
  /** License + attribution that must ship with the track. */
  license: string;
};

export const FOCUS_TRACKS: FocusTrack[] = [
  {
    id: "gentle-rain",
    title: "Gentle Rain",
    artist: "—",
    source: null,
    license: "PLACEHOLDER - no file supplied yet. Must be CC0 or equivalent before shipping.",
  },
  {
    id: "deep-focus-loop",
    title: "Deep Focus Loop",
    artist: "—",
    source: null,
    license: "PLACEHOLDER - no file supplied yet. Must be CC0 or equivalent before shipping.",
  },
  {
    id: "quiet-piano",
    title: "Quiet Piano",
    artist: "—",
    source: null,
    license: "PLACEHOLDER - no file supplied yet. Must be CC0 or equivalent before shipping.",
  },
];

const STORAGE_KEY_TRACK = "focus-music.trackId";
const STORAGE_KEY_VOLUME = "focus-music.volume";

export async function loadSavedTrackId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY_TRACK);
  } catch {
    return null;
  }
}

export async function saveTrackId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_TRACK, id);
  } catch {
    // best-effort
  }
}

export async function loadSavedVolume(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_VOLUME);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.6;
  } catch {
    return 0.6;
  }
}

export async function saveVolume(v: number): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_VOLUME, String(v));
  } catch {
    // best-effort
  }
}
