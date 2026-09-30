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
import { Menu, Flame, Zap, Award } from 'lucide-react-native';

const WEAK_SPOTS = [
  'Cell membrane transport',
  'Osmosis vs diffusion',
  'Photosynthesis light reactions',
];

export default function MobileProgressScreen() {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

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

        {/* Hero Completion Header */}
        <View style={styles.heroRow}>
          <View>
            <Text style={styles.bigPct}>74%</Text>
            <Text style={styles.bigPctLabel}>Overall completion</Text>
          </View>
          <View style={styles.miniStatsCol}>
            <View style={styles.miniStatItem}>
              <Award size={16} color={colors.amber} />
              <Text style={styles.miniStatNum}>4 <Text style={styles.miniStatLabel}>Badges</Text></Text>
            </View>
            <View style={styles.miniStatItem}>
              <Zap size={16} color={colors.teal} />
              <Text style={styles.miniStatNum}>87% <Text style={styles.miniStatLabel}>Quiz accuracy</Text></Text>
            </View>
            <View style={styles.miniStatItem}>
              <Flame size={16} color={colors.violet} />
              <Text style={styles.miniStatNum}>6 <Text style={styles.miniStatLabel}>Day streak</Text></Text>
            </View>
          </View>
        </View>

        {/* Grid: Calendar + Weak spots */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Streak calendar</Text>
          <View style={styles.calGrid}>
            {Array.from({ length: 14 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.calBlock,
                  i % 3 === 0 ? styles.calBlockOn : i % 2 === 0 ? styles.calBlockMid : styles.calBlockOff,
                ]}
              />
            ))}
          </View>
        </View>

        {/* Badges List */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent Badges</Text>
          <View style={styles.badgeRow}>
            <View style={styles.badgeCard}>
              <Text style={styles.badgeIcon}>🔥</Text>
              <Text style={styles.badgeName}>7-Day Streak</Text>
            </View>
            <View style={styles.badgeCard}>
              <Text style={styles.badgeIcon}>⚡</Text>
              <Text style={styles.badgeName}>300 XP</Text>
            </View>
            <View style={styles.badgeCard}>
              <Text style={styles.badgeIcon}>📚</Text>
              <Text style={styles.badgeName}>Document Reader</Text>
            </View>
          </View>
        </View>

        {/* Weak Spots List */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Weak spots</Text>
          {WEAK_SPOTS.map((spot, i) => (
            <TouchableOpacity
              key={i}
              style={styles.weakRow}
              onPress={() => router.push({ pathname: '/(tabs)/tutor', params: { query: `Help me review my weak spot: ${spot}` } })}
            >
              <Text style={styles.weakText}>{spot}</Text>
              <View style={styles.reviewBtn}>
                <Text style={styles.reviewText}>Review →</Text>
              </View>
            </TouchableOpacity>
          ))}
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
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  bigPct: { fontSize: 52, fontWeight: '700', color: colors.tealDark, lineHeight: 56 },
  bigPctLabel: { fontSize: 13, color: colors.inkSoft },
  miniStatsCol: { gap: 6 },
  miniStatItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniStatNum: { fontSize: 14, fontWeight: '700', color: colors.ink },
  miniStatLabel: { fontSize: 11, fontWeight: '400', color: colors.inkSoft },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  calBlock: { width: 34, height: 34, borderRadius: 6 },
  calBlockOn: { backgroundColor: colors.teal },
  calBlockMid: { backgroundColor: colors.tealPale },
  calBlockOff: { backgroundColor: colors.border },
  badgeRow: { flexDirection: 'row', gap: 10 },
  badgeCard: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 10,
    alignItems: 'center',
  },
  badgeIcon: { fontSize: 22, marginBottom: 4 },
  badgeName: { fontSize: 10, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  weakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  weakText: { fontSize: 13.5, color: colors.ink, flex: 1 },
  reviewBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  reviewText: { fontSize: 12, fontWeight: '700', color: colors.violet },
});
