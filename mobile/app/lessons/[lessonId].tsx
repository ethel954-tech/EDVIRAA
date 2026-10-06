import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { colors, radius } from "../../src/lib/theme";
import { ArrowLeft } from "lucide-react-native";

export default function LessonScreen() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Lesson");
  const [content, setContent] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLesson();
  }, [lessonId]);

  async function loadLesson() {
    setLoading(true);
    setError(null);
    try {
      if (!lessonId) {
        setTitle("Lesson");
        setContent([]);
        setError("missing");
        return;
      }

      const { data, error } = await supabase
        .from("lessons")
        .select("title, lesson_blocks")
        .eq("id", lessonId)
        .single();

      if (error) {
        console.error(error.code || error.name);
        setTitle("Lesson");
        setContent([]);
        setError("query");
        return;
      }

      if (!data) {
        setTitle("Lesson");
        setContent([]);
        setError("missing");
        return;
      }

      setTitle(data.title);
      const blocks = Array.isArray(data.lesson_blocks) ? data.lesson_blocks : [];
      setContent(
        blocks
          .map((b: any) => (typeof b?.content === "string" ? b.content : b?.text))
          .filter(Boolean)
      );
    } catch (err: any) {
      console.error(err?.code || err?.name);
      setTitle("Lesson");
      setContent([]);
      setError("query");
    } finally {
      setLoading(false);
    }
  }



  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator
          size="large"
          color={colors.teal}
          style={{ marginTop: 40 }}
        />
      ) : error ? (
        <View style={styles.content}>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>This lesson isn&apos;t available.</Text>
            <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
              <Text style={styles.backLinkText}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          onScroll={(e) => {
            const { contentSize, contentOffset, layoutMeasurement } =
              e.nativeEvent;
            const scrollable = contentSize.height - layoutMeasurement.height;
            const pct =
              scrollable > 0
                ? Math.min(
                    100,
                    Math.max(
                      0,
                      Math.round((contentOffset.y / scrollable) * 100),
                    ),
                  )
                : 100;
            setProgress(pct);
          }}
          scrollEventThrottle={16}
        >
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {progress >= 90 ? "You can complete this lesson now" : `${progress}% read · keep scrolling`}
          </Text>

          {content.map((para, i) => (
            <Text key={i} style={styles.para}>
              {para}
            </Text>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 50,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.ink, flex: 1 },
  content: { padding: 18, paddingBottom: 60 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginBottom: 6,
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.violet },
  progressLabel: { fontSize: 11, color: colors.inkSoft, marginBottom: 18 },
  para: { fontSize: 15, lineHeight: 24, color: colors.ink, marginBottom: 16 },
  completeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: 8,
  },
  errorBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: { fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  backLink: {
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  backLinkText: { fontSize: 14, fontWeight: '700', color: colors.tealDark },
});
