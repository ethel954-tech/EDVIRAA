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
  /** Bundled asset via require(), a user-uploaded local URI, or null until available. */
  source: number | { uri: string } | null;
  /** License + attribution that must ship with the track. */
  license: string;
};

const DEFAULT_TRACK_ASSET = require('../../assets/audio/quiet-piano-loop.wav');

export const FOCUS_TRACKS: FocusTrack[] = [
  { id: 'quiet-piano', title: 'Quiet Piano', artist: 'EDVIRAA', source: DEFAULT_TRACK_ASSET, license: 'CC0 — generated in-house for EDVIRAA app use; no third-party copyright restrictions.' },
];

const STORAGE_KEY_TRACK = "focus-music.trackId";
const STORAGE_KEY_VOLUME = "focus-music.volume";
const STORAGE_KEY_CUSTOM_TRACKS = "focus-music.customTracks";

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

export async function loadSavedCustomTracks(): Promise<FocusTrack[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_CUSTOM_TRACKS);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((track): track is FocusTrack => {
      if (!track || typeof track !== 'object') return false;
      const candidate = track as Partial<FocusTrack>;
      return Boolean(candidate.id && candidate.title && candidate.artist && candidate.license) && (
        candidate.source === null ||
        (typeof candidate.source === 'object' && candidate.source !== null && typeof candidate.source.uri === 'string') ||
        typeof candidate.source === 'number'
      );
    });
  } catch {
    return [];
  }
}

export async function saveCustomTracks(tracks: FocusTrack[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_CUSTOM_TRACKS, JSON.stringify(tracks));
  } catch {
    // best-effort
  }
}
