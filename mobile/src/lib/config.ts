/**
 * Single source of truth for the web app address on mobile.
 *
 * Educator and admin surfaces (grading, exam building, insights, admin
 * review) are web-only for now — every "use the web app" message on mobile
 * shows this URL. It comes ONLY from EXPO_PUBLIC_WEB_APP_URL: when it is
 * not set, callers must show plain instructions instead of a link/button.
 */
export const WEB_APP_URL =
  process.env.EXPO_PUBLIC_WEB_APP_URL || "";
