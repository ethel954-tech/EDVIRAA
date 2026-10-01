import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { colors, radius } from '../../../src/lib/theme';
import { AppDrawer } from '../../../src/components/Drawer';
import { Menu, KeyRound, Plus, Users, ChevronRight, X } from 'lucide-react-native';

export default function MobileRoomsScreen() {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModal, setCreateModal] = useState(false);
  const [joinModal, setJoinModal] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchRooms();
  }, []);

  async function fetchRooms() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: memberships } = await supabase
        .from('room_members')
        .select('rooms(*)')
        .eq('user_id', user.id);

      const list = (memberships ?? [])
        .map((m: any) => (Array.isArray(m.rooms) ? m.rooms[0] : m.rooms))
        .filter(Boolean);

      setRooms(list);
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRoom() {
    if (!roomName.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('create_room', { p_name: roomName.trim() });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const roomId = row?.room_id;
      setCreateModal(false);
      setRoomName('');
      if (roomId) {
        router.replace(`/(tabs)/rooms/${roomId}`);
      } else {
        fetchRooms();
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not create room.');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinRoom() {
    if (!inviteCode.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('join_room_by_code', {
        p_code: inviteCode.trim().toUpperCase(),
      });
      if (error) throw error;
      setJoinModal(false);
      setInviteCode('');
      if (data) {
        router.replace(`/(tabs)/rooms/${data}`);
      } else {
        fetchRooms();
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Join room failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.outerContainer}>
      <AppDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.menuBtn} onPress={() => setDrawerOpen(true)}>
            <Menu size={24} color={colors.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Study Rooms</Text>
            <Text style={styles.sub}>Collaborate live with peers &amp; teachers</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => setJoinModal(true)}
          >
            <KeyRound size={16} color={colors.inkSoft} />
            <Text style={styles.secondaryBtnText}>Join Code</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setCreateModal(true)}
          >
            <Plus size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Create Room</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="small" color={colors.teal} style={{ marginTop: 20 }} />
        ) : rooms.length === 0 ? (
          <View style={styles.emptyCard}>
            <Users size={32} color={colors.teal} />
            <Text style={styles.emptyTitle}>No study rooms yet</Text>
            <Text style={styles.emptySub}>
              Create a room to study together or join one with an invite code.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {rooms.map((room) => {
              const isTeacher = room.type === 'teacher';
              return (
                <TouchableOpacity
                  key={room.id}
                  style={[
                    styles.roomCard,
                    isTeacher ? styles.roomCardTeal : styles.roomCardViolet,
                  ]}
                  onPress={() => router.replace(`/(tabs)/rooms/${room.id}`)}
                >
                  <View style={styles.roomMain}>
                    <Text style={styles.roomTitle}>{room.name}</Text>
                    <Text style={styles.roomSub}>
                      {isTeacher ? 'Teacher-led room' : 'Peer study group'}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={colors.inkSoft} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Create Modal */}
        <Modal visible={createModal} transparent animationType="slide">
          <View style={styles.modalBg}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Create a room</Text>
                <TouchableOpacity onPress={() => setCreateModal(false)}>
                  <X size={20} color={colors.inkSoft} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.input}
                placeholder="Room Name (e.g. Chem Prep)"
                placeholderTextColor={colors.inkSoft}
                value={roomName}
                onChangeText={setRoomName}
                underlineColorAndroid="transparent"
                returnKeyType="done"
                onSubmitEditing={handleCreateRoom}
              />
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleCreateRoom}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create Room</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Join Modal */}
        <Modal visible={joinModal} transparent animationType="slide">
          <View style={styles.modalBg}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Join a room</Text>
                <TouchableOpacity onPress={() => setJoinModal(false)}>
                  <X size={20} color={colors.inkSoft} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.input}
                placeholder="Enter Invite Code"
                placeholderTextColor={colors.inkSoft}
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="characters"
                underlineColorAndroid="transparent"
                returnKeyType="done"
                onSubmitEditing={handleJoinRoom}
              />
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleJoinRoom}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Join Room</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  content: { padding: 18, paddingTop: 54, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  primaryBtn: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 11,
  },
  secondaryBtnText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 30,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.ink, marginTop: 10 },
  emptySub: { fontSize: 13, color: colors.inkSoft, textAlign: 'center', marginTop: 4 },
  list: { gap: 10 },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    borderLeftWidth: 4,
  },
  roomCardViolet: { borderLeftColor: colors.violet },
  roomCardTeal: { borderLeftColor: colors.teal },
  roomMain: { flex: 1 },
  roomTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  roomSub: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, gap: 14 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.ink,
    minHeight: 46,
  },
});
