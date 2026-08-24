/**
 * Senders that are machines by definition, so a reply could never reach a person.
 *
 * A match makes `handleGmailWebhookEvent` ignore the message outright, so this list is deliberately
 * conservative: the cost of a false positive is a real customer email silently never becoming a
 * ticket. Only local parts that no human ever owns belong here — role addresses a person might
 * actually read (notifications@, alerts@, support@, team@, info@) are intentionally NOT included.
 *
 * The previous pattern was `/noreply@.*​/`, which missed the far more common hyphenated spelling
 * and every suffixed variant, so AWS SNS, Anthropic and mailer-daemon bounces were all being
 * triaged as customer questions and drafted AI replies.
 */
const TRANSACTIONAL_LOCAL_PARTS = [
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "do_not_reply",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "bounces",
];

/** Only these take a product prefix (`cloudplatform-noreply@google.com`); a stray `bounce` or `postmaster` suffix is too weak a signal. */
const PREFIXABLE_LOCAL_PARTS = ["noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "do_not_reply"];

/**
 * Anchored to the whole address. The local part must be one of the names above — optionally with a
 * `-`/`_`/`+`/`.` separated suffix, and for the no-reply family a similarly separated prefix. That
 * covers per-message senders (`no-reply-lmg1dv-4tsbglrc6trqmaa@mail.anthropic.com`), VERP tags
 * (`bounces+123@`) and product-scoped ones (`cloudplatform-noreply@google.com`), while still
 * rejecting lookalikes like `noreply2@` where the token runs into other characters.
 */
const TRANSACTIONAL_EMAIL_REGEX = new RegExp(
  `^(?:(?:[^@]*[-_.])?(?:${PREFIXABLE_LOCAL_PARTS.join("|")})|(?:${TRANSACTIONAL_LOCAL_PARTS.join("|")}))(?:[-_+.][^@]*)?@`,
  "i",
);

export const matchesTransactionalEmailAddress = (email: string) => TRANSACTIONAL_EMAIL_REGEX.test(email.trim());
