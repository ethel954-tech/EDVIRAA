import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const supabase = await createServerClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();

  if (!caller) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { userId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }
  if (caller.id === userId) {
    return NextResponse.json(
      { error: "You cannot deactivate your own account." },
      { status: 400 },
    );
  }

  let body: { active?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "An active boolean is required." }, { status: 400 });
  }

  // Read the target through the caller's RLS-bound client before touching the
  // service-role key, so we can reject unknown ids and protect admin accounts.
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (targetError) {
    console.error("Failed to look up target user", { userId, code: targetError.code });
    return NextResponse.json(
      { error: "The account could not be updated. Please try again." },
      { status: 500 },
    );
  }

  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (body.active === false && target.role === "admin") {
    return NextResponse.json(
      { error: "Admin accounts cannot be deactivated here." },
      { status: 403 },
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json(
      { error: "Server-side Supabase admin credentials are not configured." },
      { status: 503 },
    );
  }

  const authAdmin = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authAdmin.auth.admin.updateUserById(userId, {
    ban_duration: body.active ? "none" : "876000h",
  });

  if (error) {
    console.error("Failed to update user status", {
      userId,
      active: body.active,
      code: error.code,
    });
    return NextResponse.json(
      { error: "The account could not be updated. Please try again." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    active: !data.user.banned_until,
    userId: data.user.id,
  });
}