import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import { Music, Pause, Play, ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react-native';
import { colors, radius } from '../lib/theme';
import {
  FOCUS_TRACKS,
  loadSavedCustomTracks,
  loadSavedTrackId,
  loadSavedVolume,
  saveCustomTracks,
  saveTrackId,
  saveVolume,
  type FocusTrack,
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
  const [customTracks, setCustomTracks] = useState<FocusTrack[]>([]);
  const [trackId, setTrackId] = useState<string>(FOCUS_TRACKS[0].id);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.6);

  const allTracks = [...FOCUS_TRACKS, ...customTracks];
  const track = allTracks.find((t) => t.id === trackId) ?? allTracks[0];
  const available = track.source !== null;
  const hasAnyTrack = allTracks.some((t) => t.source !== null);

  useEffect(() => {
    (async () => {
      const savedCustomTracks = await loadSavedCustomTracks();
      setCustomTracks(savedCustomTracks);

      const savedTrack = await loadSavedTrackId();
      if (savedTrack && (FOCUS_TRACKS.some((t) => t.id === savedTrack) || savedCustomTracks.some((t) => t.id === savedTrack))) {
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

  useEffect(() => unloadCurrent, [unloadCurrent]);

  const createAndPlay = useCallback(
    async (source: Exclude<FocusTrack['source'], null>) => {
      unloadCurrent();
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        interruptionModeIOS: 1,
        interruptionModeAndroid: 1,
        shouldDuckAndroid: true,
      }).catch(() => {});

      const soundSource = typeof source === 'number' ? source : { uri: source.uri };
      const { sound } = await Audio.Sound.createAsync(
        soundSource,
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
    const playable = allTracks.filter((t) => t.source !== null);
    if (playable.length === 0) return;
    const idx = playable.findIndex((t) => t.id === trackId);
    const next = playable[(idx + dir + playable.length) % playable.length];
    if (!next || next.id === trackId) return;
    unloadCurrent();
    setTrackId(next.id);
    saveTrackId(next.id);
  };

  const changeVolume = (delta: number) => {
    const next = Math.min(1, Math.max(0, Math.round((volume + delta) * 10) / 10));
    setVolume(next);
    saveVolume(next);
    soundRef.current?.setVolumeAsync(next).catch(() => {});
  };

  const handleUploadCustomTrack = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const uploadedTrack: FocusTrack = {
        id: `custom-${Date.now()}`,
        title: asset.name?.replace(/\.[^/.]+$/, '') || 'My track',
        artist: 'You',
        source: { uri: asset.uri },
        license: 'User-uploaded audio — only use music you own or have rights to use in the app.',
      };

      const nextTracks = [...customTracks, uploadedTrack];
      setCustomTracks(nextTracks);
      setTrackId(uploadedTrack.id);
      saveCustomTracks(nextTracks);
      saveTrackId(uploadedTrack.id);
      unloadCurrent();
    } catch (err) {
      console.warn('[focus-music] custom upload failed', err);
    }
  }, [customTracks, unloadCurrent]);

  const handleDeleteCustomTrack = useCallback((trackToDeleteId: string) => {
    const nextTracks = customTracks.filter((track) => track.id !== trackToDeleteId);
    setCustomTracks(nextTracks);
    saveCustomTracks(nextTracks);

    if (trackId === trackToDeleteId) {
      const nextDefaultTrack = FOCUS_TRACKS[0];
      setTrackId(nextDefaultTrack.id);
      saveTrackId(nextDefaultTrack.id);
      unloadCurrent();
    }
  }, [customTracks, trackId, unloadCurrent]);

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

          {customTracks.length > 0 ? (
            <View style={styles.customList}>
              <Text style={styles.customTitle}>Your tracks</Text>
              {customTracks.map((customTrackItem) => (
                <View key={customTrackItem.id} style={styles.customRow}>
                  <TouchableOpacity
                    style={styles.customTrackButton}
                    onPress={() => {
                      setTrackId(customTrackItem.id);
                      saveTrackId(customTrackItem.id);
                    }}
                    accessibilityLabel={`Play ${customTrackItem.title}`}
                  >
                    <Text style={styles.customTrackName} numberOfLines={1}>{customTrackItem.title}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDeleteCustomTrack(customTrackItem.id)}
                    accessibilityLabel={`Delete ${customTrackItem.title}`}
                  >
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.uploadBtn}
            onPress={handleUploadCustomTrack}
            accessibilityLabel="Upload your own focus music"
          >
            <Text style={styles.uploadBtnText}>Upload song</Text>
          </TouchableOpacity>
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
    bottom: 96,
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
  uploadBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  uploadBtnText: { fontSize: 12, color: colors.ink, fontWeight: '600' },
  customList: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    gap: 8,
  },
  customTitle: { fontSize: 11, fontWeight: '700', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.4 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customTrackButton: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  customTrackName: { fontSize: 11, color: colors.ink, fontWeight: '600' },
  deleteBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: '#FDE7E7',
  },
  deleteBtnText: { fontSize: 10, color: '#B42318', fontWeight: '700' },
});
