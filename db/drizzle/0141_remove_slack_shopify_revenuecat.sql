DROP TABLE "agent_messages" CASCADE;--> statement-breakpoint
DROP TABLE "agent_threads" CASCADE;--> statement-breakpoint
DROP INDEX "messages_slack_message_ts_idx";--> statement-breakpoint
ALTER TABLE "user_profiles" ALTER COLUMN "access" SET DEFAULT '{"role":"active","keywords":[],"routingRoles":[]}'::jsonb;--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "slack_channel";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "slack_message_ts";--> statement-breakpoint
ALTER TABLE "faqs" DROP COLUMN "slack_channel";--> statement-breakpoint
ALTER TABLE "faqs" DROP COLUMN "slack_message_ts";--> statement-breakpoint
ALTER TABLE "mailboxes_mailbox" DROP COLUMN "slack_escalation_channel";--> statement-breakpoint
ALTER TABLE "mailboxes_mailbox" DROP COLUMN "slack_bot_token";--> statement-breakpoint
ALTER TABLE "mailboxes_mailbox" DROP COLUMN "slack_bot_user_id";--> statement-breakpoint
ALTER TABLE "mailboxes_mailbox" DROP COLUMN "slack_team_id";--> statement-breakpoint
ALTER TABLE "mailboxes_mailbox" DROP COLUMN "vip_channel_id";--> statement-breakpoint
ALTER TABLE "conversations_note" DROP COLUMN "slack_message_ts";--> statement-breakpoint
ALTER TABLE "conversations_note" DROP COLUMN "slack_channel";