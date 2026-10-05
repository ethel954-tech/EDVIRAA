/**
 * Single source of truth for the web app address on mobile.
 *
 * Educator and admin surfaces (grading, exam building, insights, admin
 * review) are web-only for now — every "use the web app" message on mobile
 * shows this URL. Override it per build with EXPO_PUBLIC_WEB_APP_URL.
 */
export const WEB_APP_URL =
  process.env.EXPO_PUBLIC_WEB_APP_URL || "https://app.edviraa.com";
