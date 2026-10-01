import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { Music, Pause, Play, ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react-native';
import { colors, radius } from '../lib/theme';
import {
  FOCUS_TRACKS,
  loadSavedTrackId,
  loadSavedVolume,
  saveTrackId,
  saveVolume,
} from '../lib/focusMusic';

/**
 * App-wide "Focus music" bar, mounted once in the tabs layout so it stays
 * alive (and keeps playing) across tab navigation. Collapsed: a small pill
 * at the bottom-right. Expanded: play/pause, track stepper, volume steps.
 *
 * Guarantees:
 *  - Never auto-plays: sounds load with shouldPlay: false; playback starts
 *    only from the play button.
 *  - Stops cleanly: the Sound is unloaded on unmount and when switching
 *    tracks, so nothing leaks or keeps playing after leaving the app tree.
 *  - Remembers the last track and volume (AsyncStorage, see focusMusic.ts).
 */
export function FocusMusic() {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [open, setOpen] = useState(false);
  const [trackId, setTrackId] = useState<string>(FOCUS_TRACKS[0].id);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.6);

  const track = FOCUS_TRACKS.find((t) => t.id === trackId) ?? FOCUS_TRACKS[0];
  const available = track.source !== null;
  const hasAnyTrack = FOCUS_TRACKS.some((t) => t.source !== null);

  // Restore last choice (paused) once on mount.
  useEffect(() => {
    (async () => {
      const savedTrack = await loadSavedTrackId();
      if (savedTrack && FOCUS_TRACKS.some((t) => t.id === savedTrack)) {
        setTrackId(savedTrack);
      }
      setVolume(await loadSavedVolume());
    })();
  }, []);

  const unloadCurrent = useCallback(() => {
    soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    setIsPlaying(false);
  }, []);

  // Clean stop on unmount.
  useEffect(() => unloadCurrent, [unloadCurrent]);

  const createAndPlay = useCallback(
    async (source: number) => {
      unloadCurrent();
      // Ambient/ducking mode so focus music yields to the tutor's voice
      // features instead of fighting them (tutor reconfigures for recording).
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        interruptionModeIOS: 1, // DoNotMix
        interruptionModeAndroid: 1, // DuckOthers
        shouldDuckAndroid: true,
      }).catch(() => {});
      const { sound } = await Audio.Sound.createAsync(
        source,
        { isLooping: true, shouldPlay: true, volume },
        (status: AVPlaybackStatus) => {
          if (status.isLoaded) setIsPlaying(status.isPlaying);
        },
      );
      soundRef.current = sound;
      setIsPlaying(true);
    },
    [unloadCurrent, volume],
  );

  const togglePlay = useCallback(async () => {
    if (!available || !track.source) return;
    try {
      if (soundRef.current) {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded) {
          if (status.isPlaying) {
            await soundRef.current.pauseAsync();
            setIsPlaying(false);
          } else {
            await soundRef.current.playAsync();
            setIsPlaying(true);
          }
          return;
        }
      }
      await createAndPlay(track.source);
    } catch {
      setIsPlaying(false);
    }
  }, [available, track.source, createAndPlay]);

  const stepTrack = (dir: 1 | -1) => {
    const playable = FOCUS_TRACKS.filter((t) => t.source !== null);
    if (playable.length === 0) return;
    const idx = playable.findIndex((t) => t.id === trackId);
    const next = playable[(idx + dir + playable.length) % playable.length];
    if (!next || next.id === trackId) return;
    unloadCurrent(); // never auto-play after switching
    setTrackId(next.id);
    saveTrackId(next.id);
  };

  const changeVolume = (delta: number) => {
    const next = Math.min(1, Math.max(0, Math.round((volume + delta) * 10) / 10));
    setVolume(next);
    saveVolume(next);
    soundRef.current?.setVolumeAsync(next).catch(() => {});
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {open ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Focus music</Text>
            <TouchableOpacity
              onPress={() => setOpen(false)}
              accessibilityLabel="Minimize focus music"
              style={styles.smallBtn}
            >
              <X size={16} color={colors.inkSoft} />
            </TouchableOpacity>
          </View>

          <Text style={styles.trackTitle} numberOfLines={1}>
            {track.title}
            {available ? '' : '  (unavailable)'}
          </Text>

          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => stepTrack(-1)}
              disabled={!hasAnyTrack}
              accessibilityLabel="Previous track"
            >
              <ChevronLeft size={20} color={hasAnyTrack ? colors.ink : colors.border} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.playBtn, (!available || !hasAnyTrack) && styles.playBtnDisabled]}
              onPress={togglePlay}
              disabled={!available || !hasAnyTrack}
              accessibilityLabel={isPlaying ? 'Pause focus music' : 'Play focus music'}
            >
              {isPlaying ? (
                <Pause size={18} color="#FFFFFF" />
              ) : (
                <Play size={18} color="#FFFFFF" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => stepTrack(1)}
              disabled={!hasAnyTrack}
              accessibilityLabel="Next track"
            >
              <ChevronRight size={20} color={hasAnyTrack ? colors.ink : colors.border} />
            </TouchableOpacity>

            <View style={styles.volumeGroup}>
              <TouchableOpacity onPress={() => changeVolume(-0.1)} accessibilityLabel="Quieter">
                <Minus size={16} color={colors.inkSoft} />
              </TouchableOpacity>
              <Text style={styles.volumeText}>{Math.round(volume * 100)}%</Text>
              <TouchableOpacity onPress={() => changeVolume(0.1)} accessibilityLabel="Louder">
                <Plus size={16} color={colors.inkSoft} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.pill}
        onPress={() => setOpen((v) => !v)}
        accessibilityLabel={open ? 'Hide focus music' : 'Show focus music'}
      >
        <Music size={20} color={colors.teal} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    alignItems: 'flex-end',
    zIndex: 50,
  },
  pill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  card: {
    width: 280,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  smallBtn: { padding: 4 },
  trackTitle: { fontSize: 12, color: colors.inkSoft, marginTop: 6, marginBottom: 8 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { padding: 6 },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.teal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playBtnDisabled: { opacity: 0.4 },
  volumeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
  },
  volumeText: { fontSize: 11, color: colors.inkSoft, minWidth: 32, textAlign: 'center' },
});
