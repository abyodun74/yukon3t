// Server-side calls to Daily.co's REST API — same raw-fetch pattern as
// email.ts and moderation.ts, rather than pulling in a server SDK for two
// endpoints. The client only ever gets @daily-co/daily-js, for joining.
export function isCallingConfigured() {
  return Boolean(process.env.DAILY_API_KEY);
}

function apiKey() {
  const key = process.env.DAILY_API_KEY;
  if (!key) throw new Error("not_configured");
  return key;
}

/**
 * Creates a private, single-use room. Privacy is "private" — joining
 * requires a meeting token minted per-participant by createMeetingToken(),
 * not just knowledge of the room URL, since a call's room name/URL is
 * otherwise guessable by anyone who saw the Call row's id.
 */
export async function createCallRoom({
  name,
  expiresInSeconds = 60 * 60,
}: {
  name: string;
  expiresInSeconds?: number;
}) {
  const res = await fetch("https://api.daily.co/v1/rooms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      privacy: "private",
      properties: {
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
        enable_screenshare: true,
        enable_chat: false,
        eject_at_room_exp: true,
        // Daily's prebuilt UI otherwise shows its own camera/mic "prejoin"
        // lobby screen with its own Join button before actually connecting
        // — on a 1:1 call, accepting the ring (see respondToCall) is already
        // that confirmation, so both sides should connect immediately
        // instead of needing a second tap each.
        enable_prejoin_ui: false,
      },
    }),
  });

  if (!res.ok) {
    throw new Error("daily_room_create_failed");
  }
  const data = await res.json();
  return { url: data.url as string, name: data.name as string };
}

export async function createMeetingToken({
  roomName,
  userId,
  userName,
  isOwner,
}: {
  roomName: string;
  userId: string;
  userName: string;
  isOwner: boolean;
}) {
  const res = await fetch("https://api.daily.co/v1/meeting-tokens", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_id: userId,
        user_name: userName,
        is_owner: isOwner,
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      },
    }),
  });

  if (!res.ok) {
    throw new Error("daily_token_create_failed");
  }
  const data = await res.json();
  return data.token as string;
}

export async function deleteCallRoom(roomName: string) {
  try {
    await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
  } catch {
    // Best-effort cleanup — the room's own `exp` property (see
    // createCallRoom) guarantees it disappears either way.
  }
}

async function createRoom(name: string, properties: Record<string, unknown>) {
  const res = await fetch("https://api.daily.co/v1/rooms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, privacy: "private", properties }),
  });
  if (!res.ok) {
    throw new Error("daily_room_create_failed");
  }
  const data = await res.json();
  return { url: data.url as string, name: data.name as string };
}

/**
 * Creates a persistent group room for a Collab's live session — unlike
 * createCallRoom's single-use 1:1 rooms, this is joined/left freely by any
 * number of participants over the collab's lifetime (same "create once,
 * reuse forever" pattern as Circle.voiceRoomName). Daily's prebuilt call UI
 * (see CallFrame) surfaces screen share, in-call chat, emoji reactions, and
 * hand-raising automatically once these room properties are on — no custom
 * WebRTC UI needed for any of that.
 */
export async function createCollabRoom({
  name,
  expiresInSeconds = 60 * 60 * 24 * 365,
}: {
  name: string;
  expiresInSeconds?: number;
}) {
  const baseProperties = {
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    enable_screenshare: true,
    enable_chat: true,
    enable_emoji_reactions: true,
    enable_hand_raising: true,
    eject_at_room_exp: true,
  };
  try {
    // Cloud recording needs a Daily plan that supports it — attempted first
    // since most do, with a plain fallback below so a plan that doesn't
    // support it still gets a working room, just without the record button.
    return await createRoom(name, { ...baseProperties, enable_recording: "cloud" });
  } catch {
    return await createRoom(name, baseProperties);
  }
}

export type DailyRecording = {
  id: string;
  status: string;
  start_ts: number;
  duration?: number;
};

/** Lists cloud recordings for a room — Daily is the source of truth, nothing is mirrored into our own DB. */
export async function listRoomRecordings(roomName: string) {
  const res = await fetch(
    `https://api.daily.co/v1/recordings?room_name=${encodeURIComponent(roomName)}&limit=50`,
    { headers: { Authorization: `Bearer ${apiKey()}` } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data ?? []) as DailyRecording[];
}

/** Access links are short-lived (Daily-signed, expiring), so this is fetched fresh on demand rather than cached. */
export async function getRecordingAccessLink(recordingId: string) {
  const res = await fetch(
    `https://api.daily.co/v1/recordings/${encodeURIComponent(recordingId)}/access-link`,
    { headers: { Authorization: `Bearer ${apiKey()}` } },
  );
  if (!res.ok) {
    throw new Error("daily_access_link_failed");
  }
  const data = await res.json();
  return data.download_link as string;
}
