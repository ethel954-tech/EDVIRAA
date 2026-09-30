import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6,12}$/;

/**
 * Invite-link landing: /rooms/join?code=XXXX
 * Resolves the code via join_room_by_code and redirects into the room.
 * Works for logged-out recipients too — the middleware bounces them to
 * login with next=/rooms/join?code=…, and this page runs after they return.
 */
export default async function JoinRoomPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  // Invalid/missing code: back to the rooms list (they can type it manually).
  if (!code || !CODE_RE.test(code.toUpperCase())) {
    redirect("/rooms");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: roomId, error } = await supabase.rpc("join_room_by_code", {
    p_code: code,
  });

  if (error || !roomId) {
    // Bad code: rooms list shows whatever they're already in.
    redirect("/rooms");
  }

  redirect(`/rooms/${roomId}`);
}
