import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { colors, radius } from '../../src/lib/theme';
import { reportError } from '../../src/lib/userMessages';
import { Plus, Check, BookOpen } from 'lucide-react-native';

const PRESET_SUBJECTS = [
  'Biology 101',
  'Chemistry Fundamentals',
  'World History',
  'Calculus I',
  'Physics Mechanics',
  'Introduction to Psychology',
];

export default function SelectSubjectsScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(['Biology 101']);
  const [customSubject, setCustomSubject] = useState('');
  const [loading, setLoading] = useState(false);

  function toggleSubject(subjectName: string) {
    if (selected.includes(subjectName)) {
      setSelected(selected.filter((s) => s !== subjectName));
    } else {
      setSelected([...selected, subjectName]);
    }
  }

  function addCustomSubject() {
    const trimmed = customSubject.trim();
    if (!trimmed) return;
    if (!selected.includes(trimmed)) {
      setSelected([...selected, trimmed]);
    }
    setCustomSubject('');
  }

  async function handleFinish() {
    if (selected.length === 0) {
      Alert.alert('Select at least one subject', 'Please choose or add at least one subject to study.');
      return;
    }
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');

      const rows = selected.map((name) => ({
        student_id: user.id,
        name,
      }));

      const { error } = await supabase.from('subjects').insert(rows);
      if (error) throw error;

      router.replace('/(tabs)');
    } catch (e) {
      Alert.alert('Error', reportError('select-subjects', e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Which subjects are you studying?</Text>
      <Text style={styles.subtitle}>
        Select or add your current subjects to build your personalized AI study hub.
      </Text>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Add custom subject (e.g. Organic Chemistry)"
          placeholderTextColor={colors.inkSoft}
          value={customSubject}
          onChangeText={setCustomSubject}
        />
        <TouchableOpacity style={styles.addBtn} onPress={addCustomSubject}>
          <Plus size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={PRESET_SUBJECTS}
        keyExtractor={(item) => item}
        renderItem={({ item }) => {
          const isSelected = selected.includes(item);
          return (
            <TouchableOpacity
              style={[styles.subjectItem, isSelected && styles.subjectItemActive]}
              onPress={() => toggleSubject(item)}
            >
              <BookOpen size={20} color={isSelected ? colors.tealDark : colors.inkSoft} />
              <Text style={[styles.subjectName, isSelected && styles.subjectNameActive]}>
                {item}
              </Text>
              {isSelected ? (
                <View style={styles.checkBadge}>
                  <Check size={14} color="#fff" />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />

      <TouchableOpacity
        style={styles.finishBtn}
        onPress={handleFinish}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.finishBtnText}>Go to Study Dashboard →</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: colors.bg,
    paddingTop: 60,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.inkSoft,
    marginBottom: 20,
  },
  inputRow: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
  },
  addBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subjectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  subjectItemActive: {
    backgroundColor: colors.tealPale,
    borderColor: colors.teal,
  },
  subjectName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  subjectNameActive: {
    color: colors.tealDark,
  },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.teal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  finishBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  finishBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
