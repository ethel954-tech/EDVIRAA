import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { colors, radius } from "../src/lib/theme";
import { Laptop, ArrowRight, LogOut } from "lucide-react-native";
import { WEB_APP_URL } from "../src/lib/config";
import { supabase } from "../src/lib/supabase";

/**
 * Shown to educators and admins who land on a mobile surface that is not
 * available in the app yet.
 *
 * - With EXPO_PUBLIC_WEB_APP_URL set: one action, "Open the web app".
 * - Without it: plain instructions and NO link/button — never a dead tap.
 * A sign-out button (same error-handled logic as Settings) is always shown
 * so a signed-in educator or admin is never stuck on this screen.
 */
export default function WebOnlyScreen() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const openWebApp = () => {
    void Linking.openURL(WEB_APP_URL);
  };

  // Same flow as settings.tsx: confirm, then sign out; on failure alert
  // and stay here instead of silently "succeeding".
  function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            router.replace("/(auth)/sign-in");
          } catch (e) {
            console.error("[web-only] signOut failed", e);
            Alert.alert(
              "Could not sign out",
              "Check your connection and try again.",
            );
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Laptop size={32} color={colors.violet} />
        </View>
        <Text style={styles.title}>This part lives on the web</Text>
        <Text style={styles.body}>
          Grading, exam building, class insights and admin tools are available
          in the Edvira web app.
        </Text>

        {WEB_APP_URL ? (
          <>
            <TouchableOpacity style={styles.button} onPress={openWebApp}>
              <Text style={styles.buttonText}>Open the web app</Text>
              <ArrowRight size={16} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.url}>{WEB_APP_URL}</Text>
          </>
        ) : (
          <Text style={styles.instructions}>
            Open the Edvira web app in your browser and sign in with the same
            account.
          </Text>
        )}

        <View style={styles.signOutArea}>
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
            <Text style={styles.signOutText}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 24,
    alignItems: "center",
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.violetPale,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: colors.inkSoft,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.violet,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  url: {
    marginTop: 12,
    fontSize: 12,
    color: colors.inkSoft,
  },
  instructions: {
    fontSize: 14,
    color: colors.ink,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 4,
  },
  signOutArea: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignSelf: "stretch",
  },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.dangerPale,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  signOutText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "700",
  },
});
