"use client";

import { useParams } from "next/navigation";
import Loading from "@/app/(dashboard)/loading";
import { FileUploadProvider } from "@/components/fileUploadContext";
import { PageHeader } from "@/components/pageHeader";
import { Alert } from "@/components/ui/alert";
import { useDocumentTitle } from "@/components/useDocumentTitle";
import { api } from "@/trpc/react";
import ChatWidgetSetting from "../chat/chatWidgetSetting";
import CommonIssuesSetting from "../common-issues/commonIssuesSetting";
import AutoCloseSetting from "../customers/autoCloseSetting";
import ClosedThreadEmailSetting from "../customers/closedThreadEmailSetting";
import CustomerSetting from "../customers/customerSetting";
import HolidayAutoReplySetting from "../customers/holidayAutoReplySetting";
import WeekendAutoReplySetting from "../customers/weekendAutoReplySetting";
import EmailFinderSetting from "../email-finder/emailFinderSetting";
import ConnectSupportEmail from "../integrations/connectSupportEmail";
import GmailArchiveSetting from "../integrations/gmailArchiveSetting";
import ImportOldEmail from "../integrations/importOldEmail";
import KnowledgeSetting from "../knowledge/knowledgeSetting";
import NotificationsSetting from "../notifications/notificationsSetting";
import MailboxSetting from "../preferences/mailboxSetting";
import PreferencesSetting from "../preferences/preferencesSetting";
import TeamSetting from "../team/teamSetting";
import ToolSetting from "../tools/toolSetting";

export default function TabsPage() {
  const params = useParams<{ tab: string }>();
  const { data: mailbox, error } = api.mailbox.get.useQuery();
  useDocumentTitle("Settings");

  if (error) return <Alert variant="destructive">Error loading mailbox: {error.message}</Alert>;
  if (!mailbox) return <Loading />;

  const items = [
    {
      label: "Knowledge",
      id: "knowledge",
      content: <KnowledgeSetting websitesEnabled={mailbox.firecrawlEnabled} />,
    },
    {
      label: "Team",
      id: "team",
      content: <TeamSetting />,
    },
    {
      label: "Categories",
      id: "common-issues",
      content: <CommonIssuesSetting />,
    },
    {
      label: "Partner locations",
      id: "customers",
      content: (
        <>
          <CustomerSetting mailbox={mailbox} />
          <AutoCloseSetting mailbox={mailbox} />
          <ClosedThreadEmailSetting mailbox={mailbox} />
          <WeekendAutoReplySetting mailbox={mailbox} />
          <HolidayAutoReplySetting mailbox={mailbox} />
        </>
      ),
    },
    {
      label: "In-App Chat",
      id: "in-app-chat",
      content: <ChatWidgetSetting mailbox={mailbox} />,
    },
    {
      label: "Integrations",
      id: "integrations",
      content: (
        <>
          <ToolSetting />
          <ConnectSupportEmail />
          <GmailArchiveSetting mailbox={mailbox} />
          <ImportOldEmail />
        </>
      ),
    },
    {
      label: "Find with AI",
      id: "find-with-ai",
      content: <EmailFinderSetting />,
    },
    {
      label: "Mailbox",
      id: "mailbox",
      content: <MailboxSetting mailbox={mailbox} />,
    },
    {
      label: "User preferences",
      id: "preferences",
      content: <PreferencesSetting />,
    },
    {
      label: "Notifications",
      id: "notifications",
      content: <NotificationsSetting />,
    },
  ];

  const selectedItem = items.find((item) => item.id === params.tab) || items[0];

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={selectedItem?.label ?? "Settings"} />
      <FileUploadProvider>
        <div className="grow overflow-y-auto">
          <div className="grow overflow-y-auto bg-background sm:px-6 pb-4 px-4">{selectedItem?.content}</div>
        </div>
      </FileUploadProvider>
    </div>
  );
}
