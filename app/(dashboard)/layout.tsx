import "@/app/globals.css";
import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";
import { AppSidebar } from "@/app/(dashboard)/appSidebar";
import AutoReplyBanner from "@/app/(dashboard)/autoReplyBanner";
import InboxClientLayout from "@/app/(dashboard)/clientLayout";
import GmailWatchBanner from "@/app/(dashboard)/gmailWatchBanner";
import { StandaloneDisplayIntegration } from "@/app/(dashboard)/standaloneDisplayIntegration";
import { TopCommandBar } from "@/app/(dashboard)/topCommandBar";
import { SentryContext } from "@/components/sentryContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "@/components/useSession";
import { TRPCReactProvider } from "@/trpc/react";
import { HydrateClient } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Epicure Assist",
  description: "Lead inbox and AI drafts for Epicure Robotics",
  itunes: {
    appId: "6739270977",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <Toaster richColors />
      <TRPCReactProvider>
        <SessionProvider>
          <StandaloneDisplayIntegration />
          <HydrateClient>
            <SentryContext />
            <SidebarProvider>
              <InboxClientLayout>
                <div className="flex h-svh w-full bg-sidebar">
                  <Suspense>
                    <AppSidebar />
                  </Suspense>
                  <div className="flex-1 min-w-0 flex flex-col bg-sidebar">
                    <Suspense>
                      <GmailWatchBanner />
                    </Suspense>
                    <Suspense>
                      <AutoReplyBanner />
                    </Suspense>
                    <Suspense>
                      <TopCommandBar />
                    </Suspense>
                    <div className="flex-1 min-h-0 min-w-0">
                      <main className="h-full border-border/60 bg-background md:border-l md:border-t">{children}</main>
                    </div>
                  </div>
                </div>
              </InboxClientLayout>
            </SidebarProvider>
          </HydrateClient>
        </SessionProvider>
      </TRPCReactProvider>
    </NuqsAdapter>
  );
}
