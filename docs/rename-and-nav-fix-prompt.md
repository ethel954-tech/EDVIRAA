# Task: Terminology Rename + Mobile Navigation Fix

## 1. Terminology rename (applies across web, mobile, and backend)

Rename throughout the codebase, UI copy, and database:

| Old term | New term | Notes |
|---|---|---|
| Class (student's private container) | **Subject** | Student's own documents, roadmap, tutor chat |
| Teacher Room | **Class** | Educator-created; students join it |
| Peer Room | **Study Room** | Unchanged in meaning, just confirming the name stays |

**Database:** rename the `classes` table to `subjects` (and `class_id` foreign keys to `subject_id` on `documents`, `modules`, etc.). The existing `rooms` table stays as-is (it already covers both Study Rooms and Classes via the `type` enum: `'peer'` → Study Room, `'teacher'` → Class) — only the **display label** changes for `type = 'teacher'` rows, not the schema.

**UI copy to update:**
- Onboarding: "Select your classes" → "Select or create your subjects"
- Any "Create Teacher Room" button/label → "Create Class"
- Any "Join Room" flow for students joining an educator's room → should read "Join Class" when `type = 'teacher'`, "Join Study Room" when `type = 'peer'`

## 2. Subject switcher (new capability)

Students can currently only pick their subject(s) once, at onboarding. Add a way to create and switch between subjects at any time:

- **On the Tutor screen:** add a dropdown/switcher at the top showing the current subject name. Tapping it lists all the student's subjects plus a **"+ New Subject"** row at the bottom. Selecting a different subject swaps the tutor conversation, roadmap, and documents shown — each subject keeps its own independent tutor chat history (same mental model as switching Projects in Claude).
- **"+ New Subject"** reuses the existing onboarding flow (name it, optional diagnostic assessment, roadmap generated) but triggered from inside the app instead of only at signup.
- **On Home/Dashboard:** reflect whichever subject was last active in the hero "continue your roadmap" card, and provide the same subject switcher there too (not just on the Tutor screen).

This is primarily a **navigation and UI change** — RAG retrieval is already scoped per subject in the schema, so no backend rework is needed beyond the rename in section 1.

## 3. Mobile home screen redesign

Current problem: the mobile home screen lists every feature as its own icon block below the fold, on top of the bottom tab bar — two competing navigation systems on one screen, which is what's making it feel cluttered.

**Fix:**
- Remove the icon-grid list of features from the home screen entirely — navigation between major sections (Tutor, Roadmap, Study Rooms, Progress) happens **only** through the bottom tab bar, never duplicated elsewhere.
- The Home tab becomes an actual dashboard, not a menu: one hero card ("Continue your Subject roadmap" — progress ring, subject name, single "Continue" button), a compact stat row (streak, XP), and a short preview list of active Study Rooms/Classes (2-3 max, with a "See all" link into the Rooms tab rather than showing everything on Home).
- Bottom tab bar stays at 5 items: **Home, Subjects (or Tutor), Roadmap, Rooms, Progress** — pick whichever of Subjects/Tutor makes more sense as the persistent tab now that subject-switching lives inside the Tutor screen (recommendation: keep the tab labeled **Tutor**, since that's the actual destination; the subject switcher is a control *within* that screen, not a separate tab).

See the attached mobile dashboard mockup for the visual target — same design tokens (teal/violet/amber, Fraunces + Inter) as the rest of the app for consistency.