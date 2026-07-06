import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { gmailSupportEmails, mailboxes } from "@/db/schema";
import { getGmailService, subscribeToMailbox } from "@/lib/gmail/client";
import { captureExceptionAndLog } from "@/lib/shared/sentry";

export const renewMailboxWatches = async () => {
  const supportEmails = await db
    .select({
      id: gmailSupportEmails.id,
      accessToken: gmailSupportEmails.accessToken,
      refreshToken: gmailSupportEmails.refreshToken,
    })
    .from(mailboxes)
    .innerJoin(gmailSupportEmails, eq(mailboxes.gmailSupportEmailId, gmailSupportEmails.id));

  let failures = 0;
  for (const supportEmail of supportEmails) {
    try {
      const { data } = await subscribeToMailbox(getGmailService(supportEmail));
      if (data.expiration) {
        await db
          .update(gmailSupportEmails)
          .set({ expiresAt: new Date(Number(data.expiration)) })
          .where(eq(gmailSupportEmails.id, supportEmail.id));
      }
    } catch (error) {
      captureExceptionAndLog(error, { extra: { gmailSupportEmailId: supportEmail.id } });
      failures++;
    }
  }

  // A dead watch means no inbound mail at all, so surface it as a failed job run
  // instead of only a Sentry event (this failed silently for two months once).
  if (failures > 0) {
    throw new Error(`Failed to renew ${failures} of ${supportEmails.length} Gmail watch(es)`);
  }

  return { renewed: supportEmails.length - failures, failed: failures };
};
