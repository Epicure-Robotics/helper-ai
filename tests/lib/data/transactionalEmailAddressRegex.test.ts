import { describe, expect, test } from "vitest";
import { matchesTransactionalEmailAddress } from "@/lib/data/transactionalEmailAddressRegex";

describe("matchesTransactionalEmailAddress", () => {
  test.each([
    "noreply@example.com",
    "no-reply@sns.amazonaws.com",
    "no_reply@example.com",
    "donotreply@example.com",
    "do-not-reply@example.com",
    "mailer-daemon@googlemail.com",
    "postmaster@example.com",
    // per-message and VERP senders seen in the real support inbox
    "no-reply-lmg1dv-4tsbglrc6trqmaa@mail.anthropic.com",
    "bounces+acct_123@stripe.com",
    // product-scoped prefix
    "cloudplatform-noreply@google.com",
    // casing varies between providers
    "NoReply@Example.com",
  ])("ignores %s", (email) => {
    expect(matchesTransactionalEmailAddress(email)).toBe(true);
  });

  test.each([
    "bob@gmail.com",
    "prasad.b@thesmartq.com",
    // lookalikes must not be swallowed
    "noreply2@example.com",
    "noreplyx@example.com",
    "replyto@example.com",
    // role addresses a human may actually read — deliberately not filtered
    "notifications@vercel.com",
    "support@example.com",
    "team@mail.cursor.com",
  ])("keeps %s", (email) => {
    expect(matchesTransactionalEmailAddress(email)).toBe(false);
  });
});
