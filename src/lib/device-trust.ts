import { prisma } from "@/lib/prisma";
import { track } from "@/lib/analytics";

/**
 * True once this exact deviceId has been recorded against this user —
 * either as the account's very first device (auto-trusted, see
 * evaluateDevice below) or one that previously completed a
 * SecurityChallenge.
 */
async function isKnownDevice(userId: string, deviceId: string): Promise<boolean> {
  const existing = await prisma.knownDevice.findUnique({
    where: { userId_deviceId: { userId, deviceId } },
    select: { id: true },
  });
  return Boolean(existing);
}

async function hasAnyKnownDevice(userId: string): Promise<boolean> {
  const existing = await prisma.knownDevice.findFirst({
    where: { userId },
    select: { id: true },
  });
  return Boolean(existing);
}

/** Records a device as trusted — either the account's first-ever device, or one that just passed a SecurityChallenge. Upserts lastSeenAt/label on repeat calls for an already-known device. */
export async function trustDevice(userId: string, deviceId: string, label: string | null) {
  const existing = await isKnownDevice(userId, deviceId);
  await prisma.knownDevice.upsert({
    where: { userId_deviceId: { userId, deviceId } },
    create: { userId, deviceId, label },
    update: { lastSeenAt: new Date(), label: label ?? undefined },
  });
  if (!existing) {
    await track("DEVICE_TRUSTED", userId, { label });
  }
}

/** Bumps lastSeenAt on an already-known device, without touching its label. */
export async function touchKnownDevice(userId: string, deviceId: string) {
  await prisma.knownDevice
    .update({ where: { userId_deviceId: { userId, deviceId } }, data: { lastSeenAt: new Date() } })
    .catch(() => {
      // Row may not exist if called racing a device that was never actually
      // trusted — a no-op miss here isn't worth a query to guard against.
    });
}

export type DeviceEvaluation =
  // No prior known device at all (brand-new account, or one that predates
  // this feature) — nothing to compare against, so the current device is
  // trusted outright rather than demanding a step-up on someone's very
  // first sign-in.
  | { status: "trusted_first_device" }
  // deviceId already matches a KnownDevice row for this user.
  | { status: "known" }
  // deviceId doesn't match any KnownDevice row, and the account has at
  // least one — the caller should require a SecurityChallenge before
  // proceeding.
  | { status: "unrecognized" };

/**
 * The single place every step-up-gated action (login, password change,
 * posting) asks "does this request's device need to prove itself?". Doesn't
 * mutate anything — trusted_first_device still needs the caller to actually
 * call trustDevice() once the action it's gating succeeds, same as a
 * challenge does after it's confirmed.
 */
export async function evaluateDevice(userId: string, deviceId: string | null): Promise<DeviceEvaluation> {
  if (!deviceId) {
    // No device cookie at all — proxy.ts should always have set one, but if
    // it somehow didn't, don't turn that infra gap into a hard lockout.
    // Treated like a first-ever device: trusted, not challenged.
    return { status: "trusted_first_device" };
  }
  if (await isKnownDevice(userId, deviceId)) {
    return { status: "known" };
  }
  if (!(await hasAnyKnownDevice(userId))) {
    return { status: "trusted_first_device" };
  }
  return { status: "unrecognized" };
}
