import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from "react-native";
import { colors, radius } from "../src/lib/theme";
import { Laptop, ArrowRight } from "lucide-react-native";
import { WEB_APP_URL } from "../src/lib/config";

/**
 * Shown to educators and admins who land on a mobile surface that is not
 * available in the app yet. One screen, one action: open the web app.
 * No dead buttons — the single tap opens WEB_APP_URL.
 */
export default function WebOnlyScreen() {
  const openWebApp = () => {
    void Linking.openURL(WEB_APP_URL);
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Laptop size={32} color={colors.violet} />
        </View>
        <Text style={styles.title}>This part lives on the web</Text>
        <Text style={styles.body}>
          Grading, exam building, class insights and admin tools are available
          in the Edira web app. Open it in your browser — your account works
          there with the same login.
        </Text>

        <TouchableOpacity style={styles.button} onPress={openWebApp}>
          <Text style={styles.buttonText}>Open the web app</Text>
          <ArrowRight size={16} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.url}>{WEB_APP_URL}</Text>
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
});
