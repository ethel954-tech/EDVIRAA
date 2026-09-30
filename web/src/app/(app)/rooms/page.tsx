import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RoomsView, type RoomSummary } from "./rooms-view";

export const metadata: Metadata = { title: "Rooms" };

export default async function RoomsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Both roles use rooms; pending-role users must finish role selection.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile?.role) redirect("/auth/role");

  // Rooms I'm in (as member or creator) with my join date, via the roster.
  const { data: memberships } = await supabase
    .from("room_members")
    .select(
      "joined_at, rooms(id, name, type, invite_code, created_by, creator_role, created_at)",
    )
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false });

  // Without generated DB types, supabase-js types embedded resources as
  // arrays even for many-to-one joins — normalize to the object shape.
  const rooms = (memberships ?? [])
    .map((m) => (Array.isArray(m.rooms) ? m.rooms[0] : m.rooms))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  const roomIds = rooms.map((r) => r.id);

  // Roster per room for avatar stacks (RLS: members see the full roster).
  const { data: roster } = roomIds.length
    ? await supabase
        .from("room_members")
        .select("room_id, profiles(display_name, avatar_color)")
        .in("room_id", roomIds)
    : { data: null };

  const membersByRoom = new Map<string, { name: string; color: number | null }[]>();
  for (const row of roster ?? []) {
    const list = membersByRoom.get(row.room_id) ?? [];
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (p) list.push({ name: p.display_name, color: p.avatar_color });
    membersByRoom.set(row.room_id, list);
  }

  const summaries: RoomSummary[] = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    createdBy: r.created_by,
    creatorRole: r.creator_role,
    createdAt: r.created_at,
    isOwn: r.created_by === user.id,
    members: membersByRoom.get(r.id) ?? [],
  }));

  return <RoomsView role={profile.role} rooms={summaries} />;
}
