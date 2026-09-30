import { redirect } from "next/navigation";

/**
 * Landing page — for now it just forwards into the app shell. Auth gating
 * (send logged-out users to /auth) lands with the auth task.
 */
export default function Home() {
  redirect("/dashboard");
}
