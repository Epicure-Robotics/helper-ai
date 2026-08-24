import { describe, expect, it } from "vitest";
import { parseFormLeadHtml } from "@/lib/leads/parseFormBody";

describe("parseFormLeadHtml", () => {
  it("parses labeled plain-style HTML", () => {
    const html = `<html><body>
      Name: Jane Doe<br/>
      Email: jane@example.com<br/>
      Phone: +1 555-0100<br/>
      Message: Need pricing for two cells.
    </body></html>`;
    const r = parseFormLeadHtml(html);
    expect(r).not.toBeNull();
    expect(r!.name).toContain("Jane");
    expect(r!.email).toBe("jane@example.com");
    expect(r!.phone).toContain("555");
    expect(r!.message).toMatch(/pricing/i);
  });

  it("parses table cells", () => {
    const html = `<table>
      <tr><td>Name</td><td>Acme Corp</td></tr>
      <tr><td>Email</td><td>buyer@acme.com</td></tr>
      <tr><td>Message</td><td>Factory expansion question</td></tr>
    </table>`;
    const r = parseFormLeadHtml(html);
    expect(r?.email).toBe("buyer@acme.com");
    expect(r?.name).toContain("Acme");
  });

  it("picks up the enquiry category row when the body carries one", () => {
    const html = `<html><body>
      What's this about: Events &amp; bulk requirements<br/>
      Name: Priya N<br/>
      Email: priya@example.com<br/>
      Message: 400 servings on the 12th.
    </body></html>`;
    const r = parseFormLeadHtml(html);
    expect(r?.category).toMatch(/bulk/i);
    expect(r?.name).toContain("Priya");
    expect(r?.email).toBe("priya@example.com");
  });

  it("leaves category null when the body has no such row", () => {
    const html = `<html><body>Name: Jane<br/>Email: jane@example.com</body></html>`;
    expect(parseFormLeadHtml(html)?.category).toBeNull();
  });

  it("returns null without email", () => {
    expect(parseFormLeadHtml("<p>Name only</p>")).toBeNull();
  });
});
