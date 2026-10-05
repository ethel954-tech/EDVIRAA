import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { colors, radius } from '../../src/lib/theme';
import { AppDrawer } from '../../src/components/Drawer';
import { Menu, Check, Lock, ChevronDown, ChevronRight, Map } from 'lucide-react-native';

type Topic = { id: string; title: string; completed: boolean };
type Module = { id: string; title: string; status: 'complete' | 'in_progress' | 'locked'; topics: Topic[] };

export default function MobileRoadmapScreen() {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Roadmap data is generated and stored server-side (web uses the
  // generate-roadmap edge function). Until that is wired up on mobile the
  // screen shows an honest empty state instead of demo modules.
  const [modules] = useState<Module[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <View style={styles.outerContainer}>
      <AppDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header with Hamburger */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.menuBtn} onPress={() => setDrawerOpen(true)}>
            <Menu size={24} color={colors.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Your roadmap</Text>
            <Text style={styles.sub}>Per subject, from your modules</Text>
          </View>
        </View>

        {/* Hero Focus Card */}
        <View style={styles.heroCard}>
          <View style={styles.ringBadge}>
            <Text style={styles.ringText}>—</Text>
            <Text style={styles.ringSub}>Overall</Text>
          </View>
          <View style={styles.heroTextCol}>
            <Text style={styles.heroEyebrow}>Current focus</Text>
            <Text style={styles.heroTitle}>No roadmap yet</Text>
          </View>
        </View>

        {/* Modules List */}
        <View style={styles.card}>
          {modules.length === 0 ? (
            <View style={styles.emptyState}>
              <Map size={32} color={colors.inkSoft} />
              <Text style={styles.emptyTitle}>No roadmap generated yet</Text>
              <Text style={styles.emptyText}>
                Generate your roadmap from the Edvira web app, or from the Home
                tab once generation is available on mobile.
              </Text>
            </View>
          ) : modules.map((m, index) => {
            const doneCount = m.topics.filter((t) => t.completed).length;
            const pct = Math.round((doneCount / m.topics.length) * 100);
            const isExpanded = expandedId === m.id;

            return (
              <View key={m.id} style={styles.modContainer}>
                <TouchableOpacity
                  style={styles.modHeader}
                  onPress={() => setExpandedId(isExpanded ? null : m.id)}
                >
                  <View style={m.status === 'complete' ? styles.badgeDone : m.status === 'in_progress' ? styles.badgeNow : styles.badgeLocked}>
                    {m.status === 'complete' ? (
                      <Check size={14} color={colors.tealDark} />
                    ) : m.status === 'in_progress' ? (
                      <Text style={styles.badgeNowText}>●</Text>
                    ) : (
                      <Lock size={12} color={colors.inkSoft} />
                    )}
                  </View>

                  <View style={styles.modTextCol}>
                    <Text style={styles.modTitle}>{index + 1}. {m.title}</Text>
                    <Text style={styles.modSub}>
                      {m.status === 'complete' ? 'Complete' : m.status === 'in_progress' ? 'In progress' : 'Locked'} · {m.topics.length} topics
                    </Text>
                  </View>

                  <Text style={styles.pctText}>{m.status === 'locked' ? '—' : `${pct}%`}</Text>
                  <ChevronDown size={18} color={colors.inkSoft} />
                </TouchableOpacity>

                {isExpanded ? (
                  <View style={styles.topicList}>
                    {m.topics.map((t, j) => {
                      const isUpNext = m.status === 'in_progress' && !t.completed;
                      return (
                        <TouchableOpacity
                          key={t.id}
                          style={styles.topicRow}
                          onPress={() => router.push(`/lessons/${t.id}`)}
                          disabled={m.status === 'locked'}
                        >
                          <View style={[styles.checkCircle, t.completed && styles.checkCircleOn]}>
                            {t.completed ? <Check size={10} color="#fff" /> : null}
                          </View>
                          <Text style={[styles.topicTitle, t.completed && styles.topicTitleDone]}>
                            {j + 1}. {t.title}
                          </Text>
                          {isUpNext ? (
                            <View style={styles.upNextPill}>
                              <Text style={styles.upNextText}>Start</Text>
                              <ChevronRight size={12} color="#fff" />
                            </View>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
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
  sub: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18,
    gap: 16,
    marginBottom: 16,
  },
  ringBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.tealPale,
    borderWidth: 3,
    borderColor: colors.teal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ringText: { fontSize: 16, fontWeight: '700', color: colors.ink },
  ringSub: { fontSize: 9, color: colors.inkSoft },
  heroTextCol: { flex: 1 },
  heroEyebrow: { fontSize: 11, fontWeight: '600', color: colors.inkSoft },
  heroTitle: { fontSize: 18, fontWeight: '700', color: colors.ink, marginVertical: 2 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  modContainer: { borderBottomWidth: 1, borderBottomColor: colors.border },
  modHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  badgeDone: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.tealPale, justifyContent: 'center', alignItems: 'center' },
  badgeNow: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.violetPale, justifyContent: 'center', alignItems: 'center' },
  badgeNowText: { color: colors.violet, fontSize: 12, fontWeight: '700' },
  badgeLocked: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  modTextCol: { flex: 1 },
  modTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  modSub: { fontSize: 11, color: colors.inkSoft },
  pctText: { fontSize: 13, fontWeight: '600', color: colors.inkSoft },
  emptyState: { alignItems: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  emptyText: { fontSize: 13, color: colors.inkSoft, textAlign: 'center', lineHeight: 18 },
  topicList: { backgroundColor: colors.bg, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  checkCircle: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  checkCircleOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  topicTitle: { fontSize: 13, color: colors.ink, flex: 1 },
  topicTitleDone: { color: colors.inkSoft, textDecorationLine: 'line-through' },
  upNextPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.violet,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  upNextText: { fontSize: 11, fontWeight: '700', color: '#fff' },
});
