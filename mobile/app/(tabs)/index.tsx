import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { colors, radius } from '../../src/lib/theme';
import { getActiveSubject, setActiveSubject, listSubjects, type Subject } from '../../src/lib/subjects';
import { AppDrawer } from '../../src/components/Drawer';
import {
  Menu,
  Flame,
  Zap,
  ArrowRight,
  Check,
  Lock,
  Users,
  ChevronRight,
  Sparkles,
  ChevronDown,
} from 'lucide-react-native';

export default function MobileDashboardScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [gamification, setGamification] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Subject management
  const [subject, setSubject] = useState<Subject | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: prof }, { data: gami }, { data: rmMembers }, subs, activeSub] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('gamification').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('room_members').select('rooms(*)').eq('user_id', user.id).limit(4),
        listSubjects().catch(() => []),
        getActiveSubject().catch(() => null),
      ]);

      setProfile(prof);
      setGamification(gami || { xp: 340, current_streak: 6 });
      setRooms((rmMembers ?? []).map((m: any) => Array.isArray(m.rooms) ? m.rooms[0] : m.rooms).filter(Boolean));
      setSubjects(subs);
      setSubject(activeSub || (subs.length > 0 ? subs[0] : { id: 'default', name: 'Biology 101' }));
    } catch {
      // Graceful fallback defaults
    } finally {
      setLoading(false);
    }
  }

  async function handleSwitchSubject(next: Subject) {
    setSubjectModalOpen(false);
    setSubject(next);
    try {
      await setActiveSubject(next.id);
    } catch {
      // non-fatal fallback
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.teal} />
      </View>
    );
  }

  const userInitial = profile?.display_name ? profile.display_name.charAt(0).toUpperCase() : 'A';

  return (
    <View style={styles.outerContainer}>
      {/* Slide-out Drawer */}
      <AppDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        userProfile={profile}
      />

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Top Header with Hamburger & Avatar */}
        <View style={styles.topHeader}>
          <TouchableOpacity
            style={styles.menuBtn}
            onPress={() => setDrawerOpen(true)}
            accessibilityLabel="Open Navigation Menu"
          >
            <Menu size={24} color={colors.ink} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.avatar} onPress={() => setDrawerOpen(true)}>
            <Text style={styles.avatarText}>{userInitial}</Text>
          </TouchableOpacity>
        </View>

        {/* Greeting Banner & Subject Chip */}
        <View style={styles.greetingHeader}>
          <Text style={styles.greeting}>Good afternoon, {profile?.display_name || 'Student'}</Text>
          <TouchableOpacity
            style={styles.subjectChip}
            onPress={() => setSubjectModalOpen(true)}
          >
            <Text style={styles.subjectChipIcon}>📘</Text>
            <Text style={styles.subjectChipText}>{subject ? subject.name : 'Biology 101'}</Text>
            <ChevronDown size={14} color={colors.inkSoft} />
          </TouchableOpacity>
        </View>

        {/* Streak & XP Pills - Fully Clickable to Progress */}
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={styles.amberPill}
            onPress={() => router.push('/(tabs)/progress')}
          >
            <Flame size={14} color="#8A5A0F" />
            <Text style={styles.amberPillText}>{gamification?.current_streak || 6} day streak</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tealPill}
            onPress={() => router.push('/(tabs)/progress')}
          >
            <Zap size={14} color={colors.tealDark} />
            <Text style={styles.tealPillText}>{gamification?.xp || 340} XP</Text>
          </TouchableOpacity>
        </View>

        {/* Hero Focus Card: Continue Roadmap */}
        <View style={styles.heroCard}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardEyebrow}>
              {subject ? subject.name : 'Biology 101'} · Continue your roadmap
            </Text>
          </View>
          <Text style={styles.cardTitle}>Membrane Transport</Text>

          <View style={styles.progressRow}>
            <TouchableOpacity
              style={styles.progressRingBadge}
              onPress={() => router.push('/lessons/next')}
            >
              <Text style={styles.ringPct}>62%</Text>
              <Text style={styles.ringSub}>Module 2</Text>
            </TouchableOpacity>

            <View style={styles.progressTextCol}>
              <Text style={styles.progressDesc}>Up next: Cell Membrane Osmosis &amp; Diffusion</Text>
              <View style={styles.heroActionBtns}>
                <TouchableOpacity
                  style={styles.btnPrimary}
                  onPress={() => router.push('/lessons/next')}
                >
                  <Text style={styles.btnPrimaryText}>Open lesson</Text>
                  <ArrowRight size={15} color="#fff" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.btnSecondary}
                  onPress={() => router.push({ pathname: '/(tabs)/tutor', params: { query: `Explain Membrane Transport for ${subject?.name || 'Biology 101'}` } })}
                >
                  <Sparkles size={14} color={colors.violet} />
                  <Text style={styles.btnSecondaryText}>Ask Tutor</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* Quick Stats Grid - Fully Clickable */}
        <View style={styles.statsRow}>
          <TouchableOpacity
            style={styles.statCard}
            onPress={() => router.push('/(tabs)/progress')}
          >
            <Text style={styles.statNum}>12</Text>
            <Text style={styles.statLabel}>Sessions this week</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.statCard}
            onPress={() => router.push('/(tabs)/progress')}
          >
            <Text style={styles.statNum}>4</Text>
            <Text style={styles.statLabel}>Badges earned</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.statCard}
            onPress={() => router.push('/(tabs)/progress')}
          >
            <Text style={styles.statNum}>87%</Text>
            <Text style={styles.statLabel}>Quiz accuracy</Text>
          </TouchableOpacity>
        </View>

        {/* Active Rooms Summary */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeader}>Study Rooms</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/rooms')}>
              <Text style={styles.viewAllText}>View all</Text>
            </TouchableOpacity>
          </View>
          {rooms.length === 0 ? (
            <TouchableOpacity
              style={styles.roomRowViolet}
              onPress={() => router.push('/(tabs)/rooms')}
            >
              <View>
                <Text style={styles.roomName}>Chem exam prep</Text>
                <Text style={styles.roomSub}>3 members · live now</Text>
              </View>
              <View style={styles.liveDot} />
            </TouchableOpacity>
          ) : (
            rooms.map((r, i) => (
              <TouchableOpacity
                key={r.id || i}
                style={i % 2 === 0 ? styles.roomRowViolet : styles.roomRowTeal}
                onPress={() => router.push(`/(tabs)/rooms/${r.id}`)}
              >
                <View>
                  <Text style={styles.roomName}>{r.name}</Text>
                  <Text style={styles.roomSub}>
                    {r.type === 'teacher' ? 'Teacher room' : 'Peer study'}
                  </Text>
                </View>
                <Users size={18} color={colors.inkSoft} />
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Roadmap Summary Card */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeader}>{subject ? subject.name : 'Biology 101'} Roadmap</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/roadmap')}>
              <Text style={styles.viewAllText}>Full map</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.modRow} onPress={() => router.push('/(tabs)/roadmap')}>
            <View style={styles.badgeDone}>
              <Check size={14} color={colors.tealDark} />
            </View>
            <View style={styles.modTextCol}>
              <Text style={styles.modTitle}>Intro to Cells</Text>
              <Text style={styles.modSub}>Module 1 · Complete</Text>
            </View>
            <Text style={styles.modPct}>100%</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.modRow} onPress={() => router.push('/(tabs)/roadmap')}>
            <View style={styles.badgeProgress}>
              <Text style={styles.badgeProgressDot}>●</Text>
            </View>
            <View style={styles.modTextCol}>
              <Text style={styles.modTitle}>Cell Structure</Text>
              <Text style={styles.modSub}>Module 2 · In progress</Text>
            </View>
            <Text style={[styles.modPct, { color: colors.violet }]}>62%</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.modRow} onPress={() => router.push('/lessons/next')}>
            <View style={styles.badgeUpNext}>
              <Lock size={12} color={colors.violet} />
            </View>
            <View style={styles.modTextCol}>
              <Text style={styles.modTitle}>Membrane Transport</Text>
              <Text style={styles.modSub}>Module 3 · Up next — tap to open</Text>
            </View>
            <ChevronRight size={18} color={colors.violet} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Floating AI Tutor FAB Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(tabs)/tutor')}
        accessibilityLabel="Open AI Tutor Chat"
      >
        <Sparkles size={22} color="#fff" />
      </TouchableOpacity>

      {/* Subject Picker Modal */}
      <Modal visible={subjectModalOpen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSubjectModalOpen(false)}
        >
          <View style={styles.subjectModal}>
            <Text style={styles.modalTitle}>Select Active Subject</Text>
            {subjects.length === 0 ? (
              <TouchableOpacity
                style={styles.subjectRowActive}
                onPress={() => setSubjectModalOpen(false)}
              >
                <Text style={styles.subjectRowText}>📘 Biology 101</Text>
                <Check size={16} color={colors.tealDark} />
              </TouchableOpacity>
            ) : (
              subjects.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.subjectRow, s.id === subject?.id && styles.subjectRowActive]}
                  onPress={() => handleSwitchSubject(s)}
                >
                  <Text style={styles.subjectRowText}>📘 {s.name}</Text>
                  {s.id === subject?.id && <Check size={16} color={colors.tealDark} />}
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity
              style={styles.addSubjectBtn}
              onPress={() => {
                setSubjectModalOpen(false);
                router.push('/(tabs)/documents');
              }}
            >
              <Text style={styles.addSubjectText}>+ Manage Subjects &amp; Notes</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingTop: 54,
    paddingBottom: 90,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
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
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.violet,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  greetingHeader: {
    marginBottom: 14,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.4,
  },
  subjectChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 8,
  },
  subjectChipIcon: {
    fontSize: 13,
  },
  subjectChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  amberPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.amberPale,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  amberPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A5A0F',
  },
  tealPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.tealPale,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  tealPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.tealDark,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18,
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardEyebrow: {
    fontSize: 12,
    color: colors.inkSoft,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    marginVertical: 4,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 10,
  },
  progressRingBadge: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: colors.tealPale,
    borderWidth: 3,
    borderColor: colors.teal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ringPct: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  ringSub: {
    fontSize: 10,
    color: colors.inkSoft,
  },
  progressTextCol: {
    flex: 1,
  },
  progressDesc: {
    fontSize: 12,
    color: colors.inkSoft,
    marginBottom: 8,
  },
  heroActionBtns: {
    flexDirection: 'row',
    gap: 8,
  },
  btnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  btnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: colors.violetPale,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  btnSecondaryText: {
    color: colors.violet,
    fontSize: 13,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
  },
  statNum: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
  },
  statLabel: {
    fontSize: 11,
    color: colors.inkSoft,
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18,
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  viewAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.teal,
  },
  roomRowViolet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 10,
    borderLeftWidth: 3.5,
    borderLeftColor: colors.violet,
    paddingVertical: 8,
    marginBottom: 8,
  },
  roomRowTeal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 10,
    borderLeftWidth: 3.5,
    borderLeftColor: colors.teal,
    paddingVertical: 8,
    marginBottom: 8,
  },
  roomName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  roomSub: {
    fontSize: 12,
    color: colors.inkSoft,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.teal,
  },
  modRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  badgeDone: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: colors.tealPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeProgress: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: colors.violetPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeProgressDot: {
    color: colors.violet,
    fontSize: 12,
    fontWeight: '700',
  },
  badgeUpNext: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: colors.violetPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modTextCol: {
    flex: 1,
  },
  modTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  modSub: {
    fontSize: 11,
    color: colors.inkSoft,
  },
  modPct: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.teal,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: colors.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  subjectModal: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 14,
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    marginBottom: 4,
  },
  subjectRowActive: {
    backgroundColor: colors.tealPale,
  },
  subjectRowText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  addSubjectBtn: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addSubjectText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.teal,
    textAlign: 'center',
  },
});
