import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { colors, radius } from '../../src/lib/theme';
import { reportError } from '../../src/lib/userMessages';

export default function EducatorSetupScreen() {
  const router = useRouter();
  const [subjectArea, setSubjectArea] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleFinish() {
    const trimmed = subjectArea.trim();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter your teaching subject area.');
      return;
    }
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('profiles')
        .update({ subject_area: trimmed })
        .eq('id', user.id);

      if (error) throw error;

      router.replace('/educator');
    } catch (e) {
      Alert.alert('Error', reportError('educator-setup', e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome, Educator!</Text>
      <Text style={styles.subtitle}>
        Set up your subject area to personalize your educator dashboard.
      </Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Primary Subject Area</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Biology & Life Sciences"
          placeholderTextColor={colors.inkSoft}
          value={subjectArea}
          onChangeText={setSubjectArea}
        />
      </View>

      <TouchableOpacity
        style={styles.finishBtn}
        onPress={handleFinish}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.finishBtnText}>Open Educator Dashboard →</Text>
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
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.inkSoft,
    marginBottom: 24,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 6,
  },
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
  finishBtn: {
    backgroundColor: colors.violet,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  finishBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
