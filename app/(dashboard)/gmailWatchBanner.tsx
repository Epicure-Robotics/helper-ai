"use client";

import Link from "next/link";
import { api } from "@/trpc/react";

export default function GmailWatchBanner() {
  const { data } = api.gmailSupportEmail.get.useQuery();

  if (!data?.enabled || !data.supportAccount?.watchBroken) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-center text-sm text-foreground">
      <span>
        <strong>Gmail connection is broken.</strong> New emails to {data.supportAccount.email} are not coming in —
        reconnect to resume.
      </span>
      <Link
        href="/settings/integrations"
        className="font-semibold underline decoration-destructive/40 underline-offset-2 hover:decoration-destructive"
      >
        Reconnect
      </Link>
    </div>
  );
}
