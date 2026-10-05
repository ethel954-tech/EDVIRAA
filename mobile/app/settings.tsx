import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { colors, radius } from '../src/lib/theme';
import { User, LogOut, X, Shield, BookOpen } from 'lucide-react-native';

export default function SettingsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    loadUserProfile();
  }, []);

  async function loadUserProfile() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (user) {
        setUserEmail(user.email || '');
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        if (error) throw error;
        setProfile(data);
      }
      setLoadError(null);
    } catch (e) {
      console.error('[settings] loadUserProfile failed', e);
      setLoadError('Could not load your account details. Check your connection and reopen Settings.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            router.replace('/(auth)/sign-in');
          } catch (e) {
            console.error('[settings] signOut failed', e);
            Alert.alert('Could not sign out', 'Check your connection and try again.');
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Account Settings</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <X size={20} color={colors.ink} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="small" color={colors.teal} style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.content}>
          {loadError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{loadError}</Text>
              <TouchableOpacity onPress={loadUserProfile}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.profileCard}>
            <View style={styles.avatarCircle}>
              <User size={28} color={colors.tealDark} />
            </View>
            <View style={styles.profileText}>
              <Text style={styles.nameText}>
                {profile?.display_name || userEmail.split('@')[0] || 'User'}
              </Text>
              <Text style={styles.emailText}>{userEmail}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account Information</Text>
            <View style={styles.infoRow}>
              <Shield size={18} color={colors.inkSoft} />
              <Text style={styles.infoLabel}>Role</Text>
              <Text style={styles.infoValue}>
                {profile?.role ? profile.role.toUpperCase() : 'STUDENT'}
              </Text>
            </View>
            {profile?.subject_area ? (
              <View style={styles.infoRow}>
                <BookOpen size={18} color={colors.inkSoft} />
                <Text style={styles.infoLabel}>Subject Area</Text>
                <Text style={styles.infoValue}>{profile.subject_area}</Text>
              </View>
            ) : null}
          </View>

          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <LogOut size={18} color={colors.danger} />
            )}
            <Text style={styles.signOutText}>{signingOut ? 'Signing out…' : 'Sign Out'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
  },
  closeBtn: {
    padding: 6,
  },
  content: {
    marginTop: 20,
    gap: 20,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 14,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.tealPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileText: {
    flex: 1,
  },
  nameText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  emailText: {
    fontSize: 13,
    color: colors.inkSoft,
    marginTop: 2,
  },
  section: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.inkSoft,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.dangerPale,
    paddingVertical: 14,
    borderRadius: radius.md,
    marginTop: 10,
  },
  signOutText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '700',
  },
  errorBanner: {
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.dangerPale,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  errorText: { fontSize: 13, color: colors.danger, flex: 1 },
  retryText: { fontSize: 13, fontWeight: '700', color: colors.teal },
});
