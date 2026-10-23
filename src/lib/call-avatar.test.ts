import { describe, expect, it } from "vitest";
import { callPeerAvatarUrl, ringCallerAvatarUrl } from "@/lib/call-avatar";
import { HIDDEN_CALLER_NAME } from "@/lib/hidden-chats-rules";
import { isAvatarRouteUrl } from "@/lib/avatar-url";
import type { CallRoster } from "@/lib/use-call-roster";

const ANA_AVATAR = "/api/avatar/ana1/0f8fad5b-d9cb-469f-a165-70867728950e-t.jpg";
const BEN_AVATAR = "/api/avatar/ben1/7c9e6679-7425-40de-944b-e07fc1f90ae7.png";
const CY_AVATAR = "/api/avatar/cy1/16fd2706-8baf-433b-82eb-8c7fada847da-t.webp";

function oneToOne(over = false): CallRoster {
  return {
    group: false,
    over,
    participants: over
      ? []
      : [
          { userId: "ana1", name: "Ana", avatarUrl: ANA_AVATAR, status: "JOINED" },
          { userId: "ben1", name: "Ben", avatarUrl: BEN_AVATAR, status: "RINGING" },
        ],
  };
}

const group: CallRoster = {
  group: true,
  over: false,
  participants: [
    { userId: "ana1", name: "Ana", avatarUrl: ANA_AVATAR, status: "JOINED" },
    { userId: "ben1", name: "Ben", avatarUrl: BEN_AVATAR, status: "JOINED" },
    { userId: "cy1", name: "Cy", avatarUrl: CY_AVATAR, status: "JOINED" },
  ],
};

describe("ringCallerAvatarUrl", () => {
  it("passes the stored private-avatar route URL through unchanged, so the signed-in app loads it with its cookie", () => {
    const url = ringCallerAvatarUrl("Ana", ANA_AVATAR);
    expect(url).toBe(ANA_AVATAR);
    expect(isAvatarRouteUrl(url)).toBe(true);
  });

  it("keeps a legacy public URL as is", () => {
    const legacy = "https://media.example.com/avatar/ana1/0f8fad5b-d9cb-469f-a165-70867728950e.jpg";
    expect(ringCallerAvatarUrl("Ana", legacy)).toBe(legacy);
  });

  it("is null for a caller without a picture, named or not", () => {
    expect(ringCallerAvatarUrl("Ana", null)).toBeNull();
    expect(ringCallerAvatarUrl(null, null)).toBeNull();
  });

  it("shows the picture of a caller with no name", () => {
    expect(ringCallerAvatarUrl(null, ANA_AVATAR)).toBe(ANA_AVATAR);
  });

  it("withholds the picture of a caller announced as Private call", () => {
    expect(ringCallerAvatarUrl(HIDDEN_CALLER_NAME, ANA_AVATAR)).toBeNull();
  });
});

describe("callPeerAvatarUrl", () => {
  it("is null until the roster has loaded, and once the call is over", () => {
    expect(callPeerAvatarUrl(null, { selfUserId: "ana1", peerName: "Ben" })).toBeNull();
    expect(callPeerAvatarUrl(undefined, { selfUserId: "ana1", peerUserId: "ben1" })).toBeNull();
    expect(callPeerAvatarUrl(oneToOne(true), { selfUserId: "ana1", peerUserId: "ben1" })).toBeNull();
  });

  it("caller side, outgoing: the callee's picture, before and after they join the room", () => {
    expect(callPeerAvatarUrl(oneToOne(), { selfUserId: "ana1", peerName: "Ben" })).toBe(BEN_AVATAR);
    expect(callPeerAvatarUrl(oneToOne(), { selfUserId: "ana1", peerUserId: "ben1", peerName: "Ben" })).toBe(BEN_AVATAR);
  });

  it("callee side, incoming: the caller's picture, never their own", () => {
    expect(callPeerAvatarUrl(oneToOne(), { selfUserId: "ben1", peerName: "Ana" })).toBe(ANA_AVATAR);
    expect(callPeerAvatarUrl(oneToOne(), { selfUserId: "ben1", peerUserId: "ana1", peerName: "Ana" })).toBe(ANA_AVATAR);
  });

  it("withholds a hidden caller's picture in a 1:1 call, whether or not they're in the room yet", () => {
    expect(callPeerAvatarUrl(oneToOne(), { selfUserId: "ben1", peerName: HIDDEN_CALLER_NAME })).toBeNull();
    expect(
      callPeerAvatarUrl(oneToOne(), { selfUserId: "ben1", peerUserId: "ana1", peerName: HIDDEN_CALLER_NAME }),
    ).toBeNull();
  });

  it("is null for a peer the roster doesn't list, and for a person with no picture", () => {
    expect(callPeerAvatarUrl(oneToOne(), { selfUserId: "ana1", peerUserId: "zed9" })).toBeNull();
    const noPicture: CallRoster = {
      group: false,
      over: false,
      participants: [
        { userId: "ana1", name: "Ana", avatarUrl: ANA_AVATAR, status: "JOINED" },
        { userId: "ben1", name: "Ben", avatarUrl: null, status: "JOINED" },
      ],
    };
    expect(callPeerAvatarUrl(noPicture, { selfUserId: "ana1", peerName: "Ben" })).toBeNull();
  });

  it("without a participant or a self id there's nobody to pick", () => {
    expect(callPeerAvatarUrl(oneToOne(), { peerName: "Ben" })).toBeNull();
  });

  it("in a call people were added to: each participant's own picture, and nobody's while connecting to several", () => {
    expect(callPeerAvatarUrl(group, { selfUserId: "ana1", peerUserId: "cy1", peerName: "Ben" })).toBe(CY_AVATAR);
    expect(callPeerAvatarUrl(group, { selfUserId: "ana1", peerName: "Ben" })).toBeNull();
  });
});
