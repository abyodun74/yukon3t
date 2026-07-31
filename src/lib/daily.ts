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
