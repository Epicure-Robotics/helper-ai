import { NextResponse } from "next/server";
import { and, eq, isNull, notInArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMessages, conversations, DRAFT_STATUSES, userProfiles } from "@/db/schema";
import { authUsers } from "@/db/supabaseSchema/auth";
import { getFullName } from "@/lib/auth/authUtils";
import { verifyPublicConversationToken } from "@/lib/publicConversationToken";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  // Verify token and extract conversation ID
  const conversationId = verifyPublicConversationToken(token);

  if (!conversationId) {
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invalid Link</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px;">
          <h1>Invalid or Expired Link</h1>
          <p>This link is invalid or has expired. Public links expire after 30 days.</p>
        </body>
      </html>
    `,
      {
        status: 400,
        headers: { "Content-Type": "text/html" },
      },
    );
  }

  // Fetch conversation
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
    columns: {
      id: true,
      slug: true,
      subject: true,
      emailFrom: true,
      emailFromName: true,
      createdAt: true,
      status: true,
    },
  });

  if (!conversation) {
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Not Found</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px;">
          <h1>Conversation Not Found</h1>
          <p>This conversation could not be found.</p>
        </body>
      </html>
    `,
      {
        status: 404,
        headers: { "Content-Type": "text/html" },
      },
    );
  }

  // Fetch messages with HTML content
  const messages = await db.query.conversationMessages.findMany({
    where: and(
      eq(conversationMessages.conversationId, conversationId),
      isNull(conversationMessages.deletedAt),
      or(eq(conversationMessages.role, "user"), notInArray(conversationMessages.status, DRAFT_STATUSES)),
    ),
    columns: {
      id: true,
      htmlBody: true,
      cleanedUpText: true,
      createdAt: true,
      userId: true,
      emailFrom: true,
      role: true,
    },
    orderBy: (conversationMessages, { asc }) => [asc(conversationMessages.createdAt)],
  });

  // Fetch team members for message attribution
  const members = await db
    .select({
      id: userProfiles.id,
      displayName: userProfiles.displayName,
      email: authUsers.email,
    })
    .from(userProfiles)
    .innerJoin(authUsers, eq(userProfiles.id, authUsers.id));

  // Build HTML response with editorial magazine design
  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(conversation.subject || "Conversation")}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
        <style>
          :root {
            --cream: #FAF7F0;
            --warm-white: #FDFCF9;
            --charcoal: #2B2B2B;
            --soft-black: #1a1a1a;
            --terracotta: #D4745E;
            --warm-gray: #8B8680;
            --border-subtle: #E8E3DA;
            --shadow-soft: rgba(43, 43, 43, 0.08);
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Work Sans', -apple-system, sans-serif;
            line-height: 1.75;
            color: var(--charcoal);
            background: var(--cream);
            min-height: 100vh;
            padding: 40px 20px;
            position: relative;
          }

          /* Subtle paper texture */
          body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-image:
              repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.01) 2px, rgba(0,0,0,0.01) 4px);
            pointer-events: none;
            z-index: 1;
          }

          .container {
            max-width: 820px;
            margin: 0 auto;
            background: var(--warm-white);
            box-shadow: 0 2px 40px var(--shadow-soft);
            position: relative;
            z-index: 2;
            animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
          }

          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .header {
            padding: 60px 60px 50px;
            border-bottom: 3px solid var(--terracotta);
            position: relative;
          }

          .header::after {
            content: '';
            position: absolute;
            bottom: -6px;
            left: 60px;
            width: 80px;
            height: 3px;
            background: var(--terracotta);
            opacity: 0.3;
          }

          .header h1 {
            font-family: 'Crimson Pro', Georgia, serif;
            font-size: 42px;
            font-weight: 700;
            line-height: 1.2;
            color: var(--soft-black);
            margin-bottom: 24px;
            letter-spacing: -0.02em;
          }

          .header-meta {
            display: flex;
            align-items: center;
            gap: 24px;
            flex-wrap: wrap;
            font-size: 15px;
            color: var(--warm-gray);
          }

          .meta-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 500;
          }

          .meta-separator {
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: var(--terracotta);
            opacity: 0.4;
          }

          .status-badge {
            display: inline-flex;
            align-items: center;
            padding: 6px 14px;
            background: var(--terracotta);
            color: white;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            border-radius: 2px;
          }

          .conversation-timeline {
            padding: 0;
            position: relative;
          }

          /* Vertical timeline line */
          .conversation-timeline::before {
            content: '';
            position: absolute;
            left: 60px;
            top: 0;
            bottom: 0;
            width: 2px;
            background: linear-gradient(to bottom,
              var(--border-subtle) 0%,
              var(--terracotta) 10%,
              var(--terracotta) 90%,
              var(--border-subtle) 100%);
            opacity: 0.3;
          }

          .message {
            position: relative;
            padding: 48px 60px 48px 100px;
            border-bottom: 1px solid var(--border-subtle);
            animation: fadeIn 0.5s ease-out backwards;
          }

          .message:nth-child(1) { animation-delay: 0.1s; }
          .message:nth-child(2) { animation-delay: 0.15s; }
          .message:nth-child(3) { animation-delay: 0.2s; }
          .message:nth-child(4) { animation-delay: 0.25s; }
          .message:nth-child(5) { animation-delay: 0.3s; }

          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateX(-10px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }

          .message:last-child {
            border-bottom: none;
          }

          /* Timeline dot */
          .message::before {
            content: '';
            position: absolute;
            left: 53px;
            top: 56px;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: var(--warm-white);
            border: 3px solid var(--terracotta);
            box-shadow: 0 0 0 4px var(--warm-white);
            z-index: 2;
            transition: all 0.3s ease;
          }

          .message:hover::before {
            transform: scale(1.3);
            border-color: var(--charcoal);
          }

          .message-header {
            margin-bottom: 20px;
          }

          .message-author {
            font-family: 'Crimson Pro', Georgia, serif;
            font-size: 24px;
            font-weight: 700;
            color: var(--soft-black);
            margin-bottom: 6px;
            letter-spacing: -0.01em;
          }

          .message-meta {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
          }

          .message-role {
            font-size: 13px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--terracotta);
          }

          .message-date {
            font-size: 14px;
            color: var(--warm-gray);
            font-weight: 500;
          }

          .message-content {
            font-size: 17px;
            line-height: 1.8;
            color: var(--charcoal);
          }

          .message-content.text {
            white-space: pre-wrap;
            word-wrap: break-word;
          }

          .message-content iframe {
            width: 100%;
            border: 1px solid var(--border-subtle);
            min-height: 400px;
            background: white;
            margin-top: 12px;
          }

          .footer {
            padding: 40px 60px;
            text-align: center;
            color: var(--warm-gray);
            font-size: 14px;
            border-top: 1px solid var(--border-subtle);
            background: linear-gradient(to bottom, transparent, rgba(0,0,0,0.01));
          }

          .footer-lock {
            display: inline-block;
            margin-right: 8px;
            color: var(--terracotta);
          }

          @media (max-width: 768px) {
            body {
              padding: 20px 16px;
            }

            .container {
              box-shadow: none;
            }

            .header {
              padding: 40px 32px 32px;
            }

            .header::after {
              left: 32px;
            }

            .header h1 {
              font-size: 32px;
            }

            .conversation-timeline::before {
              left: 32px;
            }

            .message {
              padding: 36px 32px 36px 60px;
            }

            .message::before {
              left: 25px;
              top: 44px;
            }

            .message-author {
              font-size: 20px;
            }

            .message-content {
              font-size: 16px;
            }

            .footer {
              padding: 32px 32px;
            }
          }

          @media (max-width: 480px) {
            .header h1 {
              font-size: 26px;
            }

            .header-meta {
              flex-direction: column;
              align-items: flex-start;
              gap: 12px;
            }

            .meta-separator {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <header class="header">
            <h1>${escapeHtml(conversation.subject || "Conversation")}</h1>
            <div class="header-meta">
              <div class="meta-item">
                <span>From</span>
                <strong>${escapeHtml(conversation.emailFromName || conversation.emailFrom || "Unknown")}</strong>
              </div>
              <span class="meta-separator"></span>
              <div class="meta-item">
                <span class="status-badge">${escapeHtml(conversation.status || "Active")}</span>
              </div>
            </div>
          </header>
          <div class="conversation-timeline">
            ${messages
              .map((message, index) => {
                const isCustomer = message.role === "user";
                const author = isCustomer
                  ? message.emailFrom || "Customer"
                  : getFullName(members.find((m) => m.id === message.userId) ?? { displayName: null, email: null }) ||
                    "Support Team";
                const hasHtml = message.htmlBody && message.htmlBody.trim().length > 0;

                return `
                  <article class="message">
                    <div class="message-header">
                      <h2 class="message-author">${escapeHtml(author)}</h2>
                      <div class="message-meta">
                        <span class="message-role">${isCustomer ? "Customer" : "Support"}</span>
                        <span class="message-date">${formatDate(message.createdAt)}</span>
                      </div>
                    </div>
                    <div class="message-content ${hasHtml ? "html" : "text"}">
                      ${
                        hasHtml
                          ? `<iframe id="msg-${index}" sandbox="allow-same-origin" srcdoc="${escapeHtml(message.htmlBody || "")}" onload="this.style.height=(this.contentWindow.document.body.scrollHeight+20)+'px'"></iframe>`
                          : escapeHtml(message.cleanedUpText || "")
                      }
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
          <footer class="footer">
            <span class="footer-lock">🔒</span>
            Secure read-only conversation • Link expires in 30 days
          </footer>
        </div>
      </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
      "Cache-Control": "private, max-age=300", // Cache for 5 minutes
    },
  });
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}
