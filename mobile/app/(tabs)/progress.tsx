import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { colors, radius } from '../../src/lib/theme';
import { AppDrawer } from '../../src/components/Drawer';
import { Menu, Flame, Zap, Award } from 'lucide-react-native';

export default function MobileProgressScreen() {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** null = unknown (error) or none yet — rendered as "—" */
  const [overallPct, setOverallPct] = useState<number | null>(null);
  const [badgeCount, setBadgeCount] = useState<number | null>(null);
  const [quizAccuracy, setQuizAccuracy] = useState<number | null>(null);
  const [dayStreak, setDayStreak] = useState<number>(0);

  useFocusEffect(useCallback(() => {
    void loadData();
  }, []));

  async function loadData() {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoadError('Your session has expired. Sign in again to load your progress.');
        return;
      }

      const [gamificationResult, badgesResult, attemptsResult] = await Promise.all([
        supabase.from('gamification').select('current_streak').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_badges').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('quiz_attempts').select('score').eq('user_id', user.id),
      ]);

      if (gamificationResult.error) console.error(gamificationResult.error.code);
      if (badgesResult.error) console.error(badgesResult.error.code);
      if (attemptsResult.error) console.error(attemptsResult.error.code);

      setDayStreak(gamificationResult.error ? 0 : (gamificationResult.data?.current_streak ?? 0));
      setBadgeCount(badgesResult.error ? null : (badgesResult.count ?? 0));

      const attemptScores = attemptsResult.error
        ? []
        : ((attemptsResult.data ?? []) as { score: number | null }[])
            .map((row) => row.score)
            .filter((score): score is number => typeof score === 'number');
      setQuizAccuracy(attemptScores.length
        ? Math.round(attemptScores.reduce((sum, value) => sum + value, 0) / attemptScores.length)
        : null);

      // Overall completion from the user's roadmap topics (same data the web
      // progress page uses): modules -> topics(completed_at) for their subjects.
      const subjectsResult = await supabase.from('subjects').select('id').eq('student_id', user.id);
      const subjectIds = (subjectsResult.data ?? []).map((s) => s.id as string);
      const moduleResult = subjectIds.length
        ? await supabase.from('modules').select('subject_id, topics(completed_at)').in('subject_id', subjectIds)
        : { data: null, error: subjectsResult.error };
      if (moduleResult.error) console.error(moduleResult.error.code);

      let topicsDone = 0;
      let topicsTotal = 0;
      for (const m of moduleResult.data ?? []) {
        const topics = (m.topics ?? []) as { completed_at: string | null }[];
        topicsTotal += topics.length;
        topicsDone += topics.filter((t) => t.completed_at).length;
      }
      setOverallPct(moduleResult.error || topicsTotal === 0 ? null : Math.round((topicsDone / topicsTotal) * 100));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load your progress. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.outerContainer}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.teal} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.outerContainer}>
      <AppDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.menuBtn} onPress={() => setDrawerOpen(true)}>
            <Menu size={24} color={colors.ink} />
          </TouchableOpacity>
          <Text style={styles.title}>Your progress</Text>
        </View>

        {loadError ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{loadError}</Text>
            <TouchableOpacity onPress={loadData} accessibilityRole="button">
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Hero Completion Header */}
        <View style={styles.heroRow}>
          <View>
            <Text style={styles.bigPct}>{overallPct === null ? '—' : `${overallPct}%`}</Text>
            <Text style={styles.bigPctLabel}>Overall completion</Text>
          </View>
          <View style={styles.miniStatsCol}>
            <View style={styles.miniStatItem}>
              <Award size={16} color={colors.amber} />
              <Text style={styles.miniStatNum}>{badgeCount === null ? '—' : badgeCount} <Text style={styles.miniStatLabel}>Badges</Text></Text>
            </View>
            <View style={styles.miniStatItem}>
              <Zap size={16} color={colors.teal} />
              <Text style={styles.miniStatNum}>{quizAccuracy === null ? '—' : `${quizAccuracy}%`} <Text style={styles.miniStatLabel}>Quiz accuracy</Text></Text>
            </View>
            <View style={styles.miniStatItem}>
              <Flame size={16} color={colors.violet} />
              <Text style={styles.miniStatNum}>{dayStreak} <Text style={styles.miniStatLabel}>Day streak</Text></Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 18, paddingTop: 54, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
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
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 16,
  },
  errorText: { fontSize: 14, color: colors.inkSoft, marginBottom: 8 },
  retryText: { fontSize: 13, fontWeight: '700', color: colors.teal },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  bigPct: { fontSize: 52, fontWeight: '700', color: colors.tealDark, lineHeight: 56 },
  bigPctLabel: { fontSize: 13, color: colors.inkSoft },
  miniStatsCol: { gap: 6 },
  miniStatItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniStatNum: { fontSize: 14, fontWeight: '700', color: colors.ink },
  miniStatLabel: { fontSize: 11, fontWeight: '400', color: colors.inkSoft },
});
