/**
 * Shared design tokens — single source of truth for the design system
 * (spec section 3). These values are mirrored in `src/app/globals.css`
 * so Tailwind can generate utilities from them. Keep both files in sync:
 * change a color here, then change the same CSS variable in globals.css.
 *
 * The mobile app (NativeWind) will import this file directly.
 */
export const theme = {
  colors: {
    /** Primary — calm teal for the core product chrome and actions */
    primary: {
      50: "#EEF7F4",
      100: "#D6ECE4",
      200: "#AFDACE",
      300: "#7FC2B0",
      400: "#4EA58F",
      500: "#2F8B73",
      600: "#0F6E56",
      700: "#0D5A47",
      800: "#0B4638",
      900: "#09362C",
    },
    /** Secondary — purple for AI/tutor-related elements */
    secondary: {
      50: "#F4F1FB",
      100: "#E9E2F7",
      200: "#D2C4EF",
      300: "#B39FE2",
      400: "#9478D4",
      500: "#7C5CC9",
      600: "#6B48B8",
      700: "#563799",
      800: "#412B76",
      900: "#2E1E54",
    },
    /** Accent — coral for gamification (XP, streaks, badges) and the current user */
    accent: {
      50: "#FFF1EE",
      100: "#FFE0DA",
      200: "#FFC2B7",
      300: "#FF9D8D",
      400: "#FB7C69",
      500: "#F96048",
      600: "#E64B36",
      700: "#C23A29",
      800: "#992C20",
      900: "#74221A",
    },
    /** Neutrals */
    surface: "#FFFFFF",
    surfaceMuted: "#F6F8F7",
    ink: "#1A2B26",
  },
  radii: {
    /** Buttons, inputs, small chips */
    btn: "10px",
    /** Cards, panels, modals */
    card: "12px",
  },
} as const;
