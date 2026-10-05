import React, { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Appearance, useColorScheme } from 'react-native';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { supabase } from '../src/lib/supabase';
import { colors, setScheme } from '../src/lib/theme';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [loading, setLoading] = useState(true);
  const [checkingRole, setCheckingRole] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [userRole, setUserRole] = useState<'student' | 'educator' | 'admin' | null>(null);
  const colorScheme = useColorScheme();

  // Keep the app palette in sync with the OS, matching the web app's
  // prefers-color-scheme behavior in globals.css. The palette is captured at
  // module load (theme.ts), so when the OS scheme flips mid-session we reload
  // the bundle so all static styles rebuild with the new palette.
  const didMount = useRef(false);
  useEffect(() => {
    setScheme(colorScheme === 'dark' ? 'dark' : 'light');
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const sub = Appearance.addChangeListener(({ colorScheme: next }) => {
      setScheme(next === 'dark' ? 'dark' : 'light');
      // Full remount: styles are snapshot at module load, so a reload is
      // needed for every screen to pick up the new palette.
      if (typeof globalThis !== 'undefined' && (globalThis as any).expo?.modules?.ExpoUpdates?.reload) {
        (globalThis as any).expo.modules.ExpoUpdates.reload();
      }
    });
    return () => sub.remove();
  }, [colorScheme]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchRole(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      if (session?.user) {
        await fetchRole(session.user.id);
      } else {
        setUserRole(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchRole(userId: string) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
      setUserRole(
        data?.role === 'student' || data?.role === 'educator' || data?.role === 'admin'
          ? data.role
          : null,
      );
    } catch {
      setUserRole(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';
    const inEducator = segments[0] === 'educator';
    const inTabs = segments[0] === '(tabs)';
    const inLessons = segments[0] === 'lessons';

    if (!session) {
      if (!inAuthGroup) {
        router.replace('/(auth)/sign-in');
      }
    } else if (!userRole) {
      const isRoleSelection = inOnboarding && segments[1] === 'role-selection';
      if (isRoleSelection) return;
      // After finalize_role() succeeds the client navigates to the next
      // onboarding step / its destination, but userRole is stale (null).
      // Re-check the profile instead of bouncing to role-selection or allowing
      // another onboarding screen before the role has actually been selected.
      setCheckingRole(true);
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return;
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        if (data?.role === 'student' || data?.role === 'educator' || data?.role === 'admin') {
          setUserRole(data.role);
        } else {
          router.replace('/(onboarding)/role-selection');
        }
      }).catch(() => {
        router.replace('/(onboarding)/role-selection');
      }).finally(() => setCheckingRole(false));
    } else if (userRole === 'student') {
      // (tabs) area plus the full-screen lesson reader are both valid
      // student destinations - anything else bounces back to Home.
      if (!inTabs && !inLessons) {
        router.replace('/(tabs)');
      }
    } else if (userRole === 'educator' && segments[0] !== 'web-only') {
      // Educator tools (grading, exam building, insights) are web-only for
      // now. The old /educator dashboard is unreachable; its dead buttons
      // no longer appear to educators.
      router.replace('/web-only');
    } else if (userRole === 'admin' && segments[0] !== 'web-only') {
      router.replace('/web-only');
    }
  }, [session, userRole, loading, segments]);

  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      {/* Keep the navigator always mounted: unmounting it while `loading`
          causes expo-router to lose its initial route and show
          "unmatched route". Instead, overlay the loading UI. */}
      {(loading || checkingRole) && (
        <View style={styles.loadingContainer} pointerEvents="auto">
          <ActivityIndicator size="large" color={colors.teal} />
        </View>
      )}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="educator" />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
});
