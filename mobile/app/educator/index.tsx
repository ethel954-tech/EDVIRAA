import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { colors, radius } from '../../src/lib/theme';
import { Presentation, Plus, Users, BookOpen, ClipboardList, LogOut } from 'lucide-react-native';

export default function MobileEducatorDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: prof }, { data: rmList }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('rooms').select('*').eq('created_by', user.id).order('created_at', { ascending: false }),
      ]);

      setProfile(prof);
      setRooms(rmList ?? []);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/(auth)/sign-in');
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.violet} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.title}>Educator Dashboard</Text>
          <TouchableOpacity onPress={handleSignOut} style={styles.logoutBtn}>
            <LogOut size={18} color={colors.inkSoft} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sub}>{profile?.display_name || 'Teacher'} · {profile?.subject_area || 'Biology'}</Text>
      </View>

      {/* Violet Hero Banner */}
      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>Grading & class insights live on web</Text>
        <Text style={styles.heroSub}>
          Review submissions, launch exams, and see knowledge gaps from the
          Edvira web app. Here you can see your rooms below.
        </Text>
      </View>

      {/* Quick Action Buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionBtnViolet}
          onPress={() =>
            Alert.alert(
              'Available on web',
              'Creating lessons and exams is available on the Edvira web app for now.'
            )
          }
        >
          <BookOpen size={16} color="#fff" />
          <Text style={styles.actionBtnText}>New Lesson</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtnViolet}
          onPress={() =>
            Alert.alert(
              'Available on web',
              'Creating lessons and exams is available on the Edvira web app for now.'
            )
          }
        >
          <ClipboardList size={16} color="#fff" />
          <Text style={styles.actionBtnText}>New Exam</Text>
        </TouchableOpacity>
      </View>

      {/* Created Rooms */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Your rooms</Text>
        {rooms.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Presentation size={32} color={colors.violet} />
            <Text style={styles.emptyText}>No classes created yet.</Text>
          </View>
        ) : (
          rooms.map((room) => (
            <View key={room.id} style={styles.roomRow}>
              <View style={styles.roomMain}>
                <Text style={styles.roomTitle}>{room.name}</Text>
                <Text style={styles.roomSub}>
                  {room.type === 'teacher' ? 'Class' : 'Study Room'}
                </Text>
              </View>
              <Users size={16} color={colors.inkSoft} />
            </View>
          ))
        )}
      </View>

      {/* Class Knowledge Gaps */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Class knowledge gaps</Text>
        <Text style={styles.gapEmpty}>
          Knowledge-gap insights are available on the Edvira web app
          (Rooms → Insights), where quiz and exam mistakes are aggregated
          across your rooms.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 18, paddingTop: 54, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  header: { marginBottom: 18 },
  headerTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
  logoutBtn: { padding: 6 },
  sub: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.violetPale,
    borderRadius: radius.lg,
    padding: 18,
    gap: 16,
    marginBottom: 16,
  },
  heroNum: { fontSize: 36, fontWeight: '700', color: colors.violetDark },
  heroTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  heroSub: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  actionBtnViolet: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.violet,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  emptyContainer: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { fontSize: 13, color: colors.inkSoft, marginTop: 8 },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  roomMain: { flex: 1 },
  roomTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  roomSub: { fontSize: 11, color: colors.inkSoft },
  gapEmpty: { fontSize: 13, color: colors.inkSoft, lineHeight: 19 },
});
