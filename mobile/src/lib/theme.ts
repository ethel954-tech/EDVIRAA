// Palettes mirror web/src/app/globals.css exactly (light + dark themes).
export const lightColors = {
  teal: "#0E6E55",
  tealDark: "#0A5544",
  tealPale: "#E1F1EC",
  violet: "#6C4BC8",
  violetDark: "#4F359B",  // dark violet for text/icons on pale-violet surfaces (light theme)
  violetPale: "#EDE7FA",
  amber: "#E8A33D",
  amberPale: "#FCEFDA",
  bg: "#F5FAF8",
  surface: "#FFFFFF",
  ink: "#14231F",
  inkSoft: "#5B6E68",
  border: "#DCEAE4",
  danger: "#DC2626",
  dangerPale: "#FEE2E2",
};

export const darkColors = {
  ...lightColors,
  bg: "#0F1815",
  surface: "#182420",
  ink: "#EAF3EF",
  inkSoft: "#93A6A0",
  border: "#25332E",
  tealPale: "#123A2E",
  violetDark: "#CDBBFA",  // light violet for text/icons on dark #241B42 surfaces
  violetPale: "#241B42",
  amberPale: "#3A2A0F",
};

// Mutable theme: screens read `colors.x` at render time, so mutating this
// object updates every screen once setScheme() is called from the root layout.
// Initialize from the OS scheme at module load so all static StyleSheet
// snapshots (built at import time) already use the right palette — this is
// what makes the app match the web's prefers-color-scheme behavior.
import { Appearance } from "react-native";

const initial = Appearance.getColorScheme() === "dark" ? darkColors : lightColors;
export const colors = { ...initial };

export function setScheme(scheme: "light" | "dark") {
  Object.assign(colors, scheme === "dark" ? darkColors : lightColors);
}

export const radius = {
  sm: 8,
  md: 10,
  lg: 14,
  full: 9999,
};
