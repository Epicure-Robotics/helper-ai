import { JSDOM } from "jsdom";

export type ParsedFormLead = {
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  /** The "What's this about?" dropdown value, when the body carries it. Subject tag wins over this. */
  category: string | null;
};

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

const assertCell = (s: string | undefined): string => s ?? "";

const pick = (text: string, label: RegExp): string | null => {
  const m = text.match(label);
  return m?.[1] ? normalize(m[1]) : null;
};

/**
 * Parses website contact-form notification emails (HTML tables or labeled lines).
 * Tolerant of minor formatting differences from Resend / Nodemailer templates.
 */
export function parseFormLeadHtml(html: string): ParsedFormLead | null {
  if (!html?.trim()) return null;

  const doc = new JSDOM(html).window.document;
  const text = normalize(doc.body?.textContent ?? "").replace(/\r\n/g, "\n");

  let name =
    pick(text, /(?:^|\n|\s)name\s*[:\-]\s*([^\n]+?)(?=\s*(?:email|phone|message)\s*[:\-]|$)/i) ??
    pick(text, /contact details[^]*?name\s*[:\-]\s*([^\n]+?)(?=\s*(?:email|phone|message)\s*[:\-]|$)/is) ??
    pick(text, /name\s*[:\-]\s*(.+?)(?=email|phone|message|$)/is);

  let email =
    pick(text, /(?:^|\n|\s)email\s*[:\-]\s*([^\s\n]+@[^\s\n]+)/i) ??
    pick(text, /contact details[^]*?email\s*[:\-]\s*([^\s\n]+@[^\s\n]+)/is) ??
    pick(text, /email\s*[:\-]\s*(\S+@\S+)/i);

  let phone =
    pick(text, /(?:^|\n|\s)phone\s*[:\-]\s*([^\n]+?)(?=\s*(?:message|name|email)\s*[:\-]|$)/i) ??
    pick(text, /contact details[^]*?phone\s*[:\-]\s*([^\n]+?)(?=\s*message\s*[:\-]|$)/is) ??
    pick(text, /phone\s*[:\-]\s*(.+?)(?=message|$)/is);

  let category =
    pick(
      text,
      /(?:what'?s this about|enquiry type|inquiry type|category|topic)\s*[:\-]\s*([^\n]+?)(?=\s*(?:name|email|phone|message)\s*[:\-]|$)/i,
    ) ?? null;

  let message =
    pick(text, /(?:^|\n|\s)message\s*[:\-]\s*([\s\S]+?)$/im) ??
    pick(text, /new business inquiry[^]*?message\s*[:\-]\s*([\s\S]+)/is) ??
    pick(text, /message\s*[:\-]\s*(.+)/is);

  // Table-heavy templates: scan cells for label / value pairs
  const cells = Array.from(doc.querySelectorAll("td,th")).map((c) => normalize(c.textContent ?? ""));
  for (let i = 0; i < cells.length - 1; i++) {
    const label = assertCell(cells[i]).toLowerCase();
    const val = cells[i + 1];
    if (!val) continue;
    if (label.includes("name") && !name) name = val;
    if (label.includes("email") && !email && val.includes("@")) email = val;
    if (label.includes("phone") && !phone) phone = val;
    if (label.includes("message") && !message) message = val;
    if ((label.includes("about") || label.includes("enquiry") || label.includes("inquiry")) && !category) {
      category = val;
    }
  }

  if (!email?.includes("@")) return null;
  if (!name) name = email.split("@")[0] ?? "Lead";

  return {
    name: normalize(name),
    email: email.toLowerCase(),
    phone: phone ? normalize(phone) : null,
    message: message ? normalize(message) : null,
    category: category ? normalize(category) : null,
  };
}
