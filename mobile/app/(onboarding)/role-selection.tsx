import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { colors, radius } from '../../src/lib/theme';
import { GraduationCap, BookOpenCheck } from 'lucide-react-native';

export default function RoleSelectionScreen() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<'student' | 'educator' | null>(null);
  const [loading, setLoading] = useState(false);

  function confirmRoleSelection(role: 'student' | 'educator') {
    const roleLabel = role === 'student' ? 'Student' : 'Educator';
    Alert.alert(
      `Confirm ${roleLabel} Account`,
      "Your role choice is permanent and cannot be changed later. Are you sure you want to proceed?",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => saveRole(role) },
      ]
    );
  }

  async function saveRole(role: 'student' | 'educator') {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticated user found');

      // Role writes are RPC-only: the enforce_role_lock trigger rejects any
      // direct write to profiles.role that doesn't carry role_confirmed_at,
      // and that column is only settable by the server-side finalize_role()
      // RPC (see supabase/migrations/20250921000002_auth_role_finalization.sql).
      const { error } = await supabase.rpc('finalize_role', { chosen_role: role });

      if (error) throw error;

      if (role === 'student') {
        router.replace('/(onboarding)/select-subjects');
      } else {
        router.replace('/(onboarding)/educator-setup');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save role choice.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome! How will you use Study Assistant?</Text>
      <Text style={styles.subtitle}>
        Select your primary role. This selection is permanent.
      </Text>

      <TouchableOpacity
        style={[
          styles.roleCard,
          selectedRole === 'student' && styles.roleCardActive,
        ]}
        onPress={() => setSelectedRole('student')}
      >
        <View style={styles.iconCircle}>
          <GraduationCap size={28} color={colors.teal} />
        </View>
        <View style={styles.roleTextContainer}>
          <Text style={styles.roleTitle}>I am a Student</Text>
          <Text style={styles.roleDesc}>
            Upload study materials, chat with your AI tutor, track roadmaps, and join study rooms.
          </Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.roleCard,
          selectedRole === 'educator' && styles.roleCardActiveViolet,
        ]}
        onPress={() => setSelectedRole('educator')}
      >
        <View style={[styles.iconCircle, { backgroundColor: colors.violetPale }]}>
          <BookOpenCheck size={28} color={colors.violet} />
        </View>
        <View style={styles.roleTextContainer}>
          <Text style={styles.roleTitle}>I am an Educator</Text>
          <Text style={styles.roleDesc}>
            Create teacher-led rooms, build lessons & exams, grade submissions, and track class knowledge gaps.
          </Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.continueBtn,
          !selectedRole && styles.disabledBtn,
        ]}
        disabled={!selectedRole || loading}
        onPress={() => selectedRole && confirmRoleSelection(selectedRole)}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.continueBtnText}>Continue →</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.inkSoft,
    textAlign: 'center',
    marginBottom: 32,
  },
  roleCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18,
    marginBottom: 16,
    alignItems: 'center',
  },
  roleCardActive: {
    borderColor: colors.teal,
    backgroundColor: colors.tealPale,
  },
  roleCardActiveViolet: {
    borderColor: colors.violet,
    backgroundColor: colors.violetPale,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.tealPale,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  roleTextContainer: { flex: 1 },
  roleTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 4,
  },
  roleDesc: {
    fontSize: 13,
    color: colors.inkSoft,
    lineHeight: 18,
  },
  continueBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  continueBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
