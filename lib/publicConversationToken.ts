import crypto from "crypto";
import { env } from "@/lib/env";

/**
 * Generate a secure token for public conversation viewing
 * Token format: conversationId.timestamp.signature
 */
export function generatePublicConversationToken(conversationId: number): string {
  const timestamp = Date.now().toString();
  const data = `${conversationId}:${timestamp}`;

  // Use SUPABASE_SERVICE_ROLE_KEY as the signing key
  const signature = crypto.createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY).update(data).digest("base64url");

  return `${conversationId}.${timestamp}.${signature}`;
}

/**
 * Verify and extract conversation ID from a public token
 * Returns conversationId if valid, null if invalid or expired
 */
export function verifyPublicConversationToken(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const conversationIdStr = parts[0];
    const timestamp = parts[1];
    const signature = parts[2];

    if (!conversationIdStr || !timestamp || !signature) return null;

    const conversationId = parseInt(conversationIdStr, 10);
    if (isNaN(conversationId)) return null;

    // Verify signature
    const data = `${conversationId}:${timestamp}`;
    const expectedSignature = crypto
      .createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY)
      .update(data)
      .digest("base64url");

    if (signature !== expectedSignature) {
      return null;
    }

    // Optional: Check if token is expired (30 days)
    const tokenAge = Date.now() - parseInt(timestamp, 10);
    const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
    if (tokenAge > MAX_AGE) {
      return null;
    }

    return conversationId;
  } catch {
    return null;
  }
}
