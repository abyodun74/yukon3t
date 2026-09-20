-- Data cleanup only (no schema change).
--
-- Before this release a Circle post fanned "new post" notifications out to the author's subscribers/connections and
-- a Circle-scoped live stream fanned "is live" out to all the host's subscribers, whether or not they belonged to the
-- Circle. Circle content is members-only, so those notifications revealed content the recipient may not see (and
-- carried its id). Remove the ones whose recipient isn't a member of the Circle. Members' own notifications are kept.

DELETE FROM "Notification" n
USING "Post" p
WHERE n."postId" = p."id"
  AND n."type" IN ('SUBSCRIPTION_POST', 'CONNECTION_POST')
  AND p."circleId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "CircleMembership" m
    WHERE m."circleId" = p."circleId" AND m."userId" = n."recipientId"
  );

DELETE FROM "Notification" n
USING "LiveStream" s
WHERE n."liveStreamId" = s."id"
  AND n."type" = 'SUBSCRIPTION_LIVE'
  AND s."circleId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "CircleMembership" m
    WHERE m."circleId" = s."circleId" AND m."userId" = n."recipientId"
  );
