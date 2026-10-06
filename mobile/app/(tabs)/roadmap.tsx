import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { reportError } from "../../src/lib/userMessages";
import {
  getActiveSubject,
  listSubjects,
  type Subject,
} from "../../src/lib/subjects";
import { colors, radius } from "../../src/lib/theme";
import { AppDrawer } from "../../src/components/Drawer";
import { Menu, Check, Lock, ChevronDown, Map } from "lucide-react-native";

type TopicRow = {
  id: string;
  title: string;
  order_index: number;
  completed_at: string | null;
};
type ModuleRow = {
  id: string;
  title: string;
  order_index: number;
  status: string;
  topics: TopicRow[];
};

export default function MobileRoadmapScreen() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const hasLoadedOnce = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function loadData() {
        setLoading(!hasLoadedOnce.current);
        setLoadError(null);
        try {
          const subs = await listSubjects();
          const activeSub = await getActiveSubject();
          const selectedSubject = activeSub || subs[0] || null;

          const { data: moduleRows, error: modulesError } = selectedSubject
            ? await supabase
                .from("modules")
                .select(
                  "id, title, order_index, status, topics(id, title, order_index, completed_at)",
                )
                .eq("subject_id", selectedSubject.id)
                .order("order_index", { ascending: true })
            : { data: [], error: null };
          if (modulesError) throw modulesError;

          if (cancelled) return;
          setSubject(selectedSubject);
          setModules(
            (moduleRows ?? []).map((module: any) => ({
              ...module,
              topics: [...(module.topics ?? [])].sort(
                (left: any, right: any) => left.order_index - right.order_index,
              ),
            })),
          );
          hasLoadedOnce.current = true;
        } catch (error) {
          if (cancelled) return;
          console.log("[roadmap] load failed", {
            code: (error as { code?: string }).code,
          });
          setLoadError(reportError("roadmap", error));
        } finally {
          if (!cancelled) setLoading(false);
        }
      }

      void loadData();
      return () => {
        cancelled = true;
      };
    }, [reloadTick]),
  );

  if (loading && !hasLoadedOnce.current) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.teal} />
      </View>
    );
  }

  return (
    <View style={styles.outerContainer}>
      <AppDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.menuBtn}
            onPress={() => setDrawerOpen(true)}
          >
            <Menu size={24} color={colors.ink} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title}>Your roadmap</Text>
            <Text style={styles.sub}>
              {subject ? subject.name : "Per subject, from your modules"}
            </Text>
          </View>
        </View>

        {loadError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{loadError}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              accessibilityRole="button"
              onPress={() => {
                hasLoadedOnce.current = false;
                setReloadTick((tick) => tick + 1);
              }}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !subject ? (
          <View style={styles.card}>
            <View style={styles.emptyState}>
              <Map size={32} color={colors.inkSoft} />
              <Text style={styles.emptyText}>
                Add a subject to start your roadmap.
              </Text>
            </View>
          </View>
        ) : modules.length === 0 ? (
          <View style={styles.card}>
            <View style={styles.emptyState}>
              <Map size={32} color={colors.inkSoft} />
              <Text style={styles.emptyText}>
                Your roadmap isn't generated yet. You can generate it on the
                Edvira web app for now.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            {modules.map((m, index) => {
              const doneCount = m.topics.filter((t) => t.completed_at).length;
              const total = m.topics.length;
              const status: "complete" | "in_progress" | "not_started" =
                m.status === "complete"
                  ? "complete"
                  : doneCount > 0
                    ? "in_progress"
                    : "not_started";
              const isExpanded = expandedId === m.id;

              return (
                <View key={m.id} style={styles.modContainer}>
                  <TouchableOpacity
                    style={styles.modHeader}
                    accessibilityRole="button"
                    onPress={() => setExpandedId(isExpanded ? null : m.id)}
                  >
                    <View
                      style={
                        status === "complete"
                          ? styles.badgeDone
                          : status === "in_progress"
                            ? styles.badgeNow
                            : styles.badgeNotStarted
                      }
                    >
                      {status === "complete" ? (
                        <Check size={14} color={colors.tealDark} />
                      ) : status === "in_progress" ? (
                        <Text style={styles.badgeNowText}>●</Text>
                      ) : (
                        <Lock size={12} color={colors.inkSoft} />
                      )}
                    </View>

                    <View style={styles.modTextCol}>
                      <Text style={styles.modTitle}>
                        {index + 1}. {m.title}
                      </Text>
                      <Text style={styles.modSub}>
                        {status === "complete"
                          ? "Complete"
                          : status === "in_progress"
                            ? "In progress"
                            : "Not started"}
                        {total > 0 ? ` · ${doneCount}/${total} topics` : ""}
                      </Text>
                    </View>

                    <Text style={styles.pctText}>
                      {total > 0
                        ? `${Math.round((doneCount / total) * 100)}%`
                        : "—"}
                    </Text>
                    <ChevronDown size={18} color={colors.inkSoft} />
                  </TouchableOpacity>

                  {isExpanded ? (
                    <View style={styles.topicList}>
                      {m.topics.map((t, j) => (
                        <View key={t.id} style={styles.topicRow}>
                          <View
                            style={[
                              styles.checkCircle,
                              t.completed_at ? styles.checkCircleOn : null,
                            ]}
                          >
                            {t.completed_at ? (
                              <Check size={10} color="#fff" />
                            ) : null}
                          </View>
                          <Text
                            style={[
                              styles.topicTitle,
                              t.completed_at ? styles.topicTitleDone : null,
                            ]}
                          >
                            {j + 1}. {t.title}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  content: { padding: 18, paddingTop: 54, paddingBottom: 40 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
  },
  headerText: { flex: 1 },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  title: { fontSize: 24, fontWeight: "700", color: colors.ink },
  sub: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  emptyState: { alignItems: "center", padding: 32, gap: 8 },
  emptyText: {
    fontSize: 13,
    color: colors.inkSoft,
    textAlign: "center",
    lineHeight: 18,
  },
  modContainer: { borderBottomWidth: 1, borderBottomColor: colors.border },
  modHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  badgeDone: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.tealPale,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeNow: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.violetPale,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeNowText: { color: colors.violet, fontSize: 12, fontWeight: "700" },
  badgeNotStarted: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  modTextCol: { flex: 1 },
  modTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  modSub: { fontSize: 11, color: colors.inkSoft },
  pctText: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  topicList: {
    backgroundColor: colors.bg,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  topicRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  checkCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  checkCircleOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  topicTitle: { fontSize: 13, color: colors.ink, flex: 1 },
  topicTitleDone: { color: colors.inkSoft, textDecorationLine: "line-through" },
  errorCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18,
    gap: 10,
  },
  errorText: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  retryButton: {
    alignSelf: "flex-start",
    borderRadius: radius.md,
    backgroundColor: colors.teal,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryButtonText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
