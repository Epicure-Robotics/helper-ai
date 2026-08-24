import { describe, expect, it } from "vitest";
import { isFormLeadMessage, isWebsiteFormNotificationSubject } from "@/lib/leads/formLeadDetection";

describe("formLeadDetection", () => {
  it("detects website form subjects case-insensitively", () => {
    expect(isWebsiteFormNotificationSubject("🚀 New Lead: Jeet Kshatriya - Epicure Robotics")).toBe(true);
    expect(
      isWebsiteFormNotificationSubject("New Lead [Franchise / machine purchase]: Tanmay Aggarwal - Epicure Robotics"),
    ).toBe(true);
    expect(isWebsiteFormNotificationSubject("Epicure Robotics - New Business Inquiry")).toBe(true);
    expect(isWebsiteFormNotificationSubject("Contact form submission")).toBe(true);
    expect(isWebsiteFormNotificationSubject("Random invoice")).toBe(false);
  });

  it("requires notification subject and From = mailbox", () => {
    const mailbox = "connect@epicurerobotics.com";
    expect(
      isFormLeadMessage({
        subject: "New Lead: ACME",
        fromAddress: mailbox,
        mailboxAddress: mailbox,
      }),
    ).toBe(true);
    expect(
      isFormLeadMessage({
        subject: "New Lead: ACME",
        fromAddress: "customer@example.com",
        mailboxAddress: mailbox,
      }),
    ).toBe(false);
  });

  it("treats dev/staging mailbox the same when From matches", () => {
    const devMailbox = "tn717473@gmail.com";
    expect(
      isFormLeadMessage({
        subject: "Website inquiry — TestCo",
        fromAddress: devMailbox,
        mailboxAddress: devMailbox,
      }),
    ).toBe(true);
  });
});
