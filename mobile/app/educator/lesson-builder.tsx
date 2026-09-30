import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { colors, radius } from '../../src/lib/theme';

export default function MobileLessonBuilderScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreateLesson() {
    if (!title.trim() || !content.trim()) {
      Alert.alert('Required', 'Please fill in lesson title and content.');
      return;
    }
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('lessons').insert({
        created_by: user.id,
        title: title.trim(),
        content: content.trim(),
      });

      if (error) {
        console.error('Lesson insert error:', error);
        Alert.alert('Error', error.message || 'Failed to create lesson. Please ensure the "lessons" table exists and you have proper permissions.');
        setLoading(false);
        return;
      }

      Alert.alert('Success', 'Lesson created successfully!');
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save lesson.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Create New Lesson</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Lesson Title</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Intro to Cell Membranes"
          placeholderTextColor={colors.inkSoft}
          value={title}
          onChangeText={setTitle}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Lesson Content & Notes</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Type or paste lesson notes here..."
          placeholderTextColor={colors.inkSoft}
          value={content}
          onChangeText={setContent}
          multiline
          numberOfLines={8}
        />
      </View>

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={handleCreateLesson}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Publish Lesson</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 54 },
  title: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 20 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.ink,
  },
  textArea: { height: 160, textAlignVertical: 'top' },
  primaryBtn: {
    backgroundColor: colors.violet,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
