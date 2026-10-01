import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
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
  Sparkles,
  ChevronDown,
} from 'lucide-react-native';

export default function MobileDashboardScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [gamification, setGamification] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [roadmapModules, setRoadmapModules] = useState<any[]>([]);
  const [roadmapProgress, setRoadmapProgress] = useState<{ completed: number; total: number } | null>(null);
  const [recentActivities, setRecentActivities] = useState<Array<{ id: string; title: string; detail: string | null; createdAt: string }>>([]);
  const [sessionsThisWeek, setSessionsThisWeek] = useState(0);
  const [badgeCount, setBadgeCount] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Subject management
  const [subject, setSubject] = useState<Subject | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    void loadData();
  }, []));

  async function loadData() {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoadError('Your session has expired. Sign in again to load your dashboard.');
        return;
      }

      const weekStart = new Date();
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());

      const [
        profileResult,
        gamificationResult,
        roomMembershipsResult,
        subs,
        activeSub,
        sessionsResult,
        quizzesResult,
        weeklySessionsResult,
        badgesResult,
      ] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
        supabase.from('gamification').select('xp, current_streak').eq('user_id', user.id).maybeSingle(),
        supabase.from('room_members').select('rooms(*)').eq('user_id', user.id),
        listSubjects(),
        getActiveSubject(),
        supabase.from('study_sessions').select('id, summary, started_at, xp_earned').eq('user_id', user.id).order('started_at', { ascending: false }).limit(5),
        supabase.from('quiz_attempts').select('id, score, created_at, quizzes(title)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
        supabase.from('study_sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('started_at', weekStart.toISOString()),
        supabase.from('user_badges').select('badge_id', { count: 'exact', head: true }).eq('user_id', user.id),
      ]);

      const queryError = [
        profileResult.error,
        gamificationResult.error,
        roomMembershipsResult.error,
        sessionsResult.error,
        quizzesResult.error,
        weeklySessionsResult.error,
        badgesResult.error,
      ].find(Boolean);
      if (queryError) throw new Error(queryError.message);

      setProfile(profileResult.data);
      setGamification(gamificationResult.data);
      setRooms((roomMembershipsResult.data ?? []).map((m: any) => Array.isArray(m.rooms) ? m.rooms[0] : m.rooms).filter(Boolean));
      setSubjects(subs);
      const selectedSubject = activeSub || subs[0] || null;
      setSubject(selectedSubject);
      setSessionsThisWeek(weeklySessionsResult.count ?? 0);
      setBadgeCount(badgesResult.count ?? 0);

      const { data: moduleRows, error: modulesError } = selectedSubject
        ? await supabase
            .from('modules')
            .select('id, title, order_index, status, topics(id, title, order_index, completed_at)')
            .eq('subject_id', selectedSubject.id)
            .order('order_index', { ascending: true })
        : { data: [] };
      if (modulesError) throw new Error(modulesError.message);
      const sortedModules = (moduleRows ?? []).map((module: any) => ({
        ...module,
        topics: [...(module.topics ?? [])].sort((left: any, right: any) => left.order_index - right.order_index),
      }));
      setRoadmapModules(sortedModules);
      const allTopics = sortedModules.flatMap((module: any) => module.topics);
      setRoadmapProgress(allTopics.length
        ? { completed: allTopics.filter((topic: any) => topic.completed_at).length, total: allTopics.length }
        : null);

      setRecentActivities([
        ...(sessionsResult.data ?? []).map((session: any) => ({
          id: `session-${session.id}`,
          title: session.summary?.trim() || 'Study session',
          detail: session.xp_earned > 0 ? `${session.xp_earned} XP earned` : null,
          createdAt: session.started_at,
        })),
        ...(quizzesResult.data ?? []).map((attempt: any) => {
          const quiz = Array.isArray(attempt.quizzes) ? attempt.quizzes[0] : attempt.quizzes;
          return {
            id: `quiz-${attempt.id}`,
            title: quiz?.title ?? 'Quiz attempt',
            detail: `${attempt.score}% score`,
            createdAt: attempt.created_at,
          };
        }),
      ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 5));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load your dashboard. Please try again.');
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

  if (loadError) {
    return (
      <View style={styles.center}>
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Couldn&apos;t load your dashboard</Text>
          <Text style={styles.errorMessage}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadData} accessibilityRole="button">
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const userInitial = profile?.display_name ? profile.display_name.charAt(0).toUpperCase() : 'A';
  const currentModule = roadmapModules.find((module) => module.status !== 'complete') || roadmapModules[0];
  const completedTopicCount = roadmapProgress?.completed ?? 0;
  const totalTopicCount = roadmapProgress?.total ?? 0;
  const roadmapPercent = totalTopicCount
    ? Math.round((completedTopicCount / totalTopicCount) * 100)
    : null;

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
          <Text style={styles.greeting}>Welcome back{profile?.display_name ? `, ${profile.display_name}` : ''}</Text>
          <TouchableOpacity
            style={styles.subjectChip}
            onPress={() => setSubjectModalOpen(true)}
          >
            <Text style={styles.subjectChipIcon}>📘</Text>
            <Text style={styles.subjectChipText}>{subject?.name || 'No subjects yet'}</Text>
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
            <Text style={styles.amberPillText}>{gamification ? `${gamification.current_streak} day streak` : 'Streak unavailable'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tealPill}
            onPress={() => router.push('/(tabs)/progress')}
          >
            <Zap size={14} color={colors.tealDark} />
            <Text style={styles.tealPillText}>{gamification ? `${gamification.xp} XP` : 'XP unavailable'}</Text>
          </TouchableOpacity>
        </View>

        {/* Hero Focus Card: Continue Roadmap */}
        <View style={styles.heroCard}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardEyebrow}>
              {subject?.name || 'No subjects yet'} · Roadmap
            </Text>
          </View>
          <Text style={styles.cardTitle}>{currentModule?.title || (subject ? 'No roadmap yet' : 'No subjects yet')}</Text>

          <View style={styles.progressRow}>
            <TouchableOpacity
              style={styles.progressRingBadge}
              onPress={() => router.push('/(tabs)/roadmap')}
            >
              <Text style={styles.ringPct}>{roadmapPercent === null ? '—' : `${roadmapPercent}%`}</Text>
              <Text style={styles.ringSub}>{totalTopicCount ? `${completedTopicCount}/${totalTopicCount} topics` : 'No roadmap'}</Text>
            </TouchableOpacity>

            <View style={styles.progressTextCol}>
              <Text style={styles.progressDesc}>{totalTopicCount ? `${completedTopicCount} of ${totalTopicCount} topics complete` : 'No roadmap progress yet'}</Text>
              <View style={styles.heroActionBtns}>
                <TouchableOpacity
                  style={styles.btnPrimary}
                  onPress={() => router.push('/(tabs)/roadmap')}
                >
                  <Text style={styles.btnPrimaryText}>Open roadmap</Text>
                  <ArrowRight size={15} color="#fff" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.btnSecondary}
                  onPress={() => router.push({ pathname: '/(tabs)/tutor', params: { query: `Help me study ${currentModule?.title || subject?.name || 'my subject'}` } })}
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
            <Text style={styles.statNum}>{sessionsThisWeek}</Text>
            <Text style={styles.statLabel}>Sessions this week</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.statCard}
            onPress={() => router.push('/(tabs)/progress')}
          >
            <Text style={styles.statNum}>{badgeCount}</Text>
            <Text style={styles.statLabel}>Badges earned</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.statCard}
            onPress={() => router.push('/(tabs)/progress')}
          >
            <Text style={styles.statNum}>{completedTopicCount}</Text>
            <Text style={styles.statLabel}>Topics completed</Text>
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
            <View>
              <Text style={styles.roomSub}>No rooms yet</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/rooms')}>
                <Text style={styles.viewAllText}>Browse rooms</Text>
              </TouchableOpacity>
            </View>
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
            <Text style={styles.sectionHeader}>{subject ? `${subject.name} Roadmap` : 'Your roadmap'}</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/roadmap')}>
              <Text style={styles.viewAllText}>Full map</Text>
            </TouchableOpacity>
          </View>

          {roadmapModules.length ? roadmapModules.slice(0, 3).map((module: any) => {
            const done = module.topics.filter((topic: any) => topic.completed_at).length;
            const total = module.topics.length;
            return (
              <TouchableOpacity key={module.id} style={styles.modRow} onPress={() => router.push('/(tabs)/roadmap')}>
                <View style={module.status === 'complete' ? styles.badgeDone : module.status === 'locked' ? styles.badgeUpNext : styles.badgeProgress}>
                  {module.status === 'complete' ? <Check size={14} color={colors.tealDark} /> : module.status === 'locked' ? <Lock size={12} color={colors.violet} /> : <Text style={styles.badgeProgressDot}>•</Text>}
                </View>
                <View style={styles.modTextCol}>
                  <Text style={styles.modTitle}>{module.title}</Text>
                  <Text style={styles.modSub}>{done} of {total} topics complete</Text>
                </View>
                <Text style={styles.modPct}>{total ? `${Math.round((done / total) * 100)}%` : '—'}</Text>
              </TouchableOpacity>
            );
          }) : (
            <Text style={styles.roomSub}>{subject ? 'No roadmap yet' : 'No subjects yet'}</Text>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeader}>Recent activity</Text>
          {recentActivities.length ? recentActivities.map((activity) => (
            <View key={activity.id} style={styles.modRow}>
              <View style={styles.modTextCol}>
                <Text style={styles.modTitle}>{activity.title}</Text>
                <Text style={styles.modSub}>{new Date(activity.createdAt).toLocaleDateString()}</Text>
              </View>
              {activity.detail ? <Text style={styles.modSub}>{activity.detail}</Text> : null}
            </View>
          )) : <Text style={styles.roomSub}>No recent activity</Text>}
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
              <Text style={styles.roomSub}>No subjects yet</Text>
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
  errorCard: {
    width: '100%',
    maxWidth: 420,
    padding: 20,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  errorTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  errorMessage: { fontSize: 14, color: colors.inkSoft, marginTop: 8 },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 16,
    minHeight: 42,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.teal,
    paddingHorizontal: 18,
  },
  retryButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
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
