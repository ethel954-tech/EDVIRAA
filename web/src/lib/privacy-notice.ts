// ============================================================================
// AI privacy notice — single source of truth for every surface that sends
// student content to the AI provider (tutor chat, document upload, tutor
// attachments). Edit the wording HERE ONLY; each screen renders it verbatim.
// ============================================================================

export const PRIVACY_NOTICE = {
  /** Short, plain-language notice shown on AI/upload screens. */
  text:
    "Documents and questions you send here are processed by our AI provider. " +
    "On the free tier, the provider may use that content to improve its products — " +
    "so please don't upload anything private you wouldn't want shared.",
} as const;
