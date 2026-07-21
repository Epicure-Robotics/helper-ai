import "@/app/globals.css";
import cx from "classnames";
import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

export const metadata: Metadata = {
  title: "Epicure Assist",
  description: "AI-powered assistant for Epicure Robotics",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cx("h-full")}>
      <body
        className="h-full overflow-y-hidden antialiased text-foreground bg-background font-regular"
        suppressHydrationWarning
      >
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
