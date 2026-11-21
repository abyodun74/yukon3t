-- One-off backfill for the 2026-11 "notifications don't clear" fix (viewStory and getConversationMessages now mark
-- these rows read as they are seen). Marks read only what the reader had already seen before that fix shipped:
--   1. a "<name> added a new story" row (SUBSCRIPTION_STORY) whose recipient already has a StoryView row for it;
--   2. a MESSAGE row whose recipient's ConversationMember.lastReadAt for that chat is at or after the row's createdAt.
-- Read flags only: no row is deleted or otherwise changed, and a row already read is left alone (readAt IS NULL), so
-- running it again changes nothing.

UPDATE "Notification" AS n
SET "readAt" = CURRENT_TIMESTAMP
FROM "StoryView" AS sv
WHERE n."type" = 'SUBSCRIPTION_STORY'
  AND n."readAt" IS NULL
  AND n."storyId" IS NOT NULL
  AND sv."storyId" = n."storyId"
  AND sv."viewerId" = n."recipientId";

UPDATE "Notification" AS n
SET "readAt" = CURRENT_TIMESTAMP
FROM "ConversationMember" AS cm
WHERE n."type" = 'MESSAGE'
  AND n."readAt" IS NULL
  AND n."conversationId" IS NOT NULL
  AND cm."conversationId" = n."conversationId"
  AND cm."userId" = n."recipientId"
  AND cm."lastReadAt" IS NOT NULL
  AND cm."lastReadAt" >= n."createdAt";
