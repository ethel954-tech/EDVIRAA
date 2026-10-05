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
import { Plus, Trash2 } from 'lucide-react-native';

interface Question {
  question: string;
  options: string[];
  correctAnswer: number;
}

export default function MobileExamBuilderScreen() {
  const router = useRouter();
  const [examTitle, setExamTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [questions, setQuestions] = useState<Question[]>([
    { question: '', options: ['', '', '', ''], correctAnswer: 0 },
  ]);
  const [loading, setLoading] = useState(false);

  function handleAddQuestion() {
    setQuestions([
      ...questions,
      { question: '', options: ['', '', '', ''], correctAnswer: 0 },
    ]);
  }

  function handleRemoveQuestion(index: number) {
    if (questions.length === 1) {
      Alert.alert('Notice', 'Exam must have at least one question.');
      return;
    }
    setQuestions(questions.filter((_, i) => i !== index));
  }

  function updateQuestionText(index: number, text: string) {
    const updated = [...questions];
    updated[index].question = text;
    setQuestions(updated);
  }

  function updateOptionText(qIndex: number, optIndex: number, text: string) {
    const updated = [...questions];
    updated[qIndex].options[optIndex] = text;
    setQuestions(updated);
  }

  function setCorrectAnswer(qIndex: number, optIndex: number) {
    const updated = [...questions];
    updated[qIndex].correctAnswer = optIndex;
    setQuestions(updated);
  }

  async function handleCreateExam() {
    if (!examTitle.trim()) {
      Alert.alert('Required', 'Please enter an exam title.');
      return;
    }

    for (let i = 0; i < questions.length; i++) {
      if (!questions[i].question.trim()) {
        Alert.alert('Incomplete', `Question #${i + 1} text cannot be blank.`);
        return;
      }
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('exams').insert({
        created_by: user.id,
        title: examTitle.trim(),
        duration_minutes: parseInt(durationMinutes, 10) || 30,
        questions: questions,
      });

      if (error) {
        console.error('Exam insert error:', error);
        Alert.alert('Error', 'Could not create the exam. Please try again.');
        setLoading(false);
        return;
      }

      Alert.alert('Success', 'Exam created and published successfully!');
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save exam.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Create New Exam</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Exam Title</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Midterm Cellular Biology Quiz"
          placeholderTextColor={colors.inkSoft}
          value={examTitle}
          onChangeText={setExamTitle}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Time Limit (Minutes)</Text>
        <TextInput
          style={styles.input}
          placeholder="30"
          placeholderTextColor={colors.inkSoft}
          keyboardType="numeric"
          value={durationMinutes}
          onChangeText={setDurationMinutes}
        />
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Questions ({questions.length})</Text>

      {questions.map((q, qIndex) => (
        <View key={qIndex} style={styles.qCard}>
          <View style={styles.qHeader}>
            <Text style={styles.qNumber}>Question {qIndex + 1}</Text>
            {questions.length > 1 && (
              <TouchableOpacity onPress={() => handleRemoveQuestion(qIndex)}>
                <Trash2 size={16} color="#DC2626" />
              </TouchableOpacity>
            )}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Enter question text..."
            placeholderTextColor={colors.inkSoft}
            value={q.question}
            onChangeText={(text) => updateQuestionText(qIndex, text)}
          />

          <Text style={[styles.label, { marginTop: 10 }]}>Options (Tap to mark correct answer):</Text>
          {q.options.map((opt, optIndex) => (
            <View key={optIndex} style={styles.optRow}>
              <TouchableOpacity
                style={[
                  styles.radio,
                  q.correctAnswer === optIndex && styles.radioSelected,
                ]}
                onPress={() => setCorrectAnswer(qIndex, optIndex)}
              >
                {q.correctAnswer === optIndex && <View style={styles.radioInner} />}
              </TouchableOpacity>

              <TextInput
                style={[styles.input, styles.optInput]}
                placeholder={`Option ${optIndex + 1}`}
                placeholderTextColor={colors.inkSoft}
                value={opt}
                onChangeText={(text) => updateOptionText(qIndex, optIndex, text)}
              />
            </View>
          ))}
        </View>
      ))}

      <TouchableOpacity style={styles.addBtn} onPress={handleAddQuestion}>
        <Plus size={16} color={colors.violet} />
        <Text style={styles.addBtnText}>Add Question</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={handleCreateExam}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Publish Exam</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 54, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  inputGroup: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
  },
  qCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 14,
  },
  qHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  qNumber: { fontSize: 14, fontWeight: '700', color: colors.violet },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  optInput: { flex: 1 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.inkSoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: { borderColor: colors.violet },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.violet },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.violet,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    marginBottom: 20,
  },
  addBtnText: { color: colors.violet, fontWeight: '600', fontSize: 14 },
  primaryBtn: {
    backgroundColor: colors.violet,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
