import "@/app/globals.css";
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "@/components/themeProvider";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-app",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Epicure Assist",
  description: "Lead inbox and AI drafts for Epicure Robotics",
  // Avoid manifest fetch 401s on protected preview deployments (Vercel Deployment Protection).
  // PWA install requires the manifest to be publicly accessible, so we only advertise it in production.
  ...(env.VERCEL_ENV === "production" ? { manifest: "/app.webmanifest" } : {}),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("h-full", plusJakarta.variable)}>
      <head>
        {env.NODE_ENV === "development" && (
          <>
            <Script src="//unpkg.com/react-grab/dist/index.global.js" strategy="beforeInteractive" />
            <Script src="//unpkg.com/@react-grab/cursor/dist/client.global.js" strategy="lazyOnload" />
          </>
        )}
      </head>
      <body className="h-full antialiased font-sans text-foreground bg-background" suppressHydrationWarning>
        <ThemeProvider attribute="class" forcedTheme="light">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
