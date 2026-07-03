import { userFactory } from "@tests/support/factories/users";
import { beforeEach, expect, test, vi } from "vitest";
import { getMailboxInfo } from "@/lib/data/mailbox";

beforeEach(() => {
  vi.clearAllMocks();
});

test("getMailboxInfo", async () => {
  const { mailbox } = await userFactory.createRootUser();
  const info = getMailboxInfo(mailbox);
  expect(info).toEqual({
    id: mailbox.id,
    name: mailbox.name,
    slug: mailbox.slug,
    preferences: {},
    widgetHMACSecret: mailbox.widgetHMACSecret,
    widgetDisplayMode: "always",
    widgetDisplayMinValue: null,
    widgetHost: null,
    vipThreshold: null,
    vipExpectedResponseHours: null,
    githubConnectUrl: null,
    githubConnected: false,
    githubRepoName: null,
    githubRepoOwner: null,
    autoCloseDaysOfInactivity: 14,
    autoCloseEnabled: false,
    closedThreadEmailEnabled: mailbox.closedThreadEmailEnabled,
    weekendAutoReplyEnabled: mailbox.weekendAutoReplyEnabled,
    weekendAutoReplyMessage: mailbox.weekendAutoReplyMessage,
    holidayAutoReplyEnabled: mailbox.holidayAutoReplyEnabled,
    holidayAutoReplyMessage: mailbox.holidayAutoReplyMessage,
    firecrawlEnabled: false,
  });
});
