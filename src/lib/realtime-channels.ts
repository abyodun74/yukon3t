/**
 * Every realtime channel this app publishes to or subscribes from, in one
 * place so a naming collision (two features accidentally sharing a topic)
 * is a merge conflict here, not a silent cross-talk bug discovered live.
 * Parameterized by whatever scopes the event to its intended listener(s) —
 * a userId for a single recipient, a conversationId for both members of a
 * thread, etc. Deliberately dependency-free (no server secrets, no
 * client-only APIs) so both realtime-server.ts (publishing) and
 * realtime-client.ts's consumers (subscribing) can import it directly
 * without crossing the server/client boundary.
 */
export const REALTIME_CHANNELS = {
  navBadges: (userId: string) => `nav-badges:${userId}`,
  // Global, not per-user — createAnnouncement (actions/announcements.ts)
  // is the one broadcast every signed-in user should hear about at once.
  announcements: () => `announcements`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  // Every call-lifecycle signal aimed at one specific user — a new ring
  // (they're the callee), or a status change (accepted/declined/ended) for
  // a call they're party to as either caller or callee. One channel/event
  // rather than splitting "ringing" from "status changed" into separate
  // channels: same "thin signal, go refetch" shape as every other channel
  // here, and each subscriber already knows from its own local state
  // whether it's watching for an incoming ring or an outgoing call's status.
  callSignal: (userId: string) => `call:${userId}`,
  liveStreams: () => `live-streams`,
  liveStream: (liveStreamId: string) => `live-stream:${liveStreamId}`,
  voiceChannel: (channelId: string) => `voice-channel:${channelId}`,
  collabSession: (collabId: string) => `collab-session:${collabId}`,
  homeFeed: (category: string) => `home-feed:${category}`,
} as const;
