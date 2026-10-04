import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();

  if (!caller) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .single();
  if (callerProfile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { userId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  let body: { decision?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.decision !== "verified" && body.decision !== "rejected") {
    return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (body.decision === "rejected" && !note) {
    return NextResponse.json(
      { error: "Provide a reason when rejecting an application." },
      { status: 400 },
    );
  }
  if (note.length > 1000) {
    return NextResponse.json({ error: "Review note is too long." }, { status: 400 });
  }

  const [{ data: application }, { data: educatorProfile }] = await Promise.all([
    supabase
      .from("educator_verifications")
      .select("educator_verification_status, educator_evidence_path, educator_submitted_at")
      .eq("user_id", userId)
      .single(),
    supabase.from("profiles").select("role").eq("id", userId).single(),
  ]);

  if (
    educatorProfile?.role !== "educator" ||
    !application ||
    application.educator_verification_status !== "pending" ||
    !application.educator_submitted_at ||
    !application.educator_evidence_path
  ) {
    return NextResponse.json(
      { error: "This educator application is not awaiting review." },
      { status: 409 },
    );
  }

  // Only approving grants access, so the evidence must still be readable then;
  // a rejection can be recorded even if the file has since gone missing.
  if (body.decision === "verified") {
    const { data: evidence, error: evidenceError } = await supabase.storage
      .from("educator-verification")
      .createSignedUrl(application.educator_evidence_path, 60);
    if (evidenceError || !evidence?.signedUrl) {
      return NextResponse.json(
        { error: "The submitted evidence is unavailable; the application was not changed." },
        { status: 409 },
      );
    }
  }

  // Guard the transition with the same pending precondition we just read so a
  // concurrent review (or a retry) can't overwrite an already-decided row.
  const { data: updated, error } = await supabase
    .from("educator_verifications")
    .update({
      educator_verification_status: body.decision,
      educator_reviewed_at: new Date().toISOString(),
      educator_review_note: note || null,
    })
    .eq("user_id", userId)
    .eq("educator_verification_status", "pending")
    .select("user_id");

  if (error) {
    console.error("Failed to update educator verification", {
      userId,
      decision: body.decision,
      code: error.code,
    });
    return NextResponse.json(
      { error: "The application could not be updated. Please try again." },
      { status: 400 },
    );
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "This educator application is no longer awaiting review." },
      { status: 409 },
    );
  }

  return NextResponse.json({ userId, status: body.decision });
}
