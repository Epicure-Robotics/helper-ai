#!/usr/bin/env tsx
/**
 * Dry-run script placeholder. Epicure Assist does not use external subscription DB reminders.
 */
function main() {
  console.log("Subscription expiration reminders are not used for Epicure Assist.");
  console.log("See jobs/sendSubscriptionExpirationReminders.ts (no-op stub).");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
