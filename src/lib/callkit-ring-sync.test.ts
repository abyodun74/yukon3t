import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCallKitRingSync,
  nativePluginHasMethod,
  planCallKitEnd,
  ringEndReasonForStatus,
  type CallKitRingPort,
  type ServerCallStatus,
} from "@/lib/callkit-ring-sync";

describe("ringEndReasonForStatus", () => {
  it("leaves a call that is still ringing alone", () => {
    expect(ringEndReasonForStatus("RINGING")).toBeNull();
  });

  it("maps every resolved status to the CallKit end reason that matches it", () => {
    expect(ringEndReasonForStatus("ACCEPTED")).toBe("answeredElsewhere");
    expect(ringEndReasonForStatus("DECLINED")).toBe("declinedElsewhere");
    expect(ringEndReasonForStatus("MISSED")).toBe("unanswered");
    expect(ringEndReasonForStatus("ENDED")).toBe("remoteEnded");
  });

  it("ends a call the server doesn't know for this user", () => {
    expect(ringEndReasonForStatus(null)).toBe("remoteEnded");
  });
});

describe("nativePluginHasMethod", () => {
  const headers = [
    { name: "NativeCallKit", methods: [{ name: "getPendingCallEvents" }, { name: "endRingingCall" }] },
    { name: "Other", methods: [{ name: "getRingingCalls" }] },
  ];

  it("finds a method the installed build has", () => {
    expect(nativePluginHasMethod(headers, "NativeCallKit", "endRingingCall")).toBe(true);
  });

  it("is false for a method only another plugin has, or that this build lacks", () => {
    expect(nativePluginHasMethod(headers, "NativeCallKit", "getRingingCalls")).toBe(false);
    expect(nativePluginHasMethod(headers, "NativeCallKit", "reportCallAnswered")).toBe(false);
  });

  it("is false without the plugin or without any headers (a browser)", () => {
    expect(nativePluginHasMethod(headers, "Missing", "endRingingCall")).toBe(false);
    expect(nativePluginHasMethod(undefined, "NativeCallKit", "endRingingCall")).toBe(false);
  });
});

describe("createCallKitRingSync", () => {
  let ringing: string[];
  let statuses: Record<string, ServerCallStatus | null | undefined>;
  let answering: Set<string>;
  let port: {
    answered: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    ringing: ReturnType<typeof vi.fn>;
    endAnswered: ReturnType<typeof vi.fn>;
  };
  let status: ReturnType<typeof vi.fn>;

  function sync() {
    return createCallKitRingSync(port as unknown as CallKitRingPort, {
      status: status as unknown as (callId: string) => Promise<ServerCallStatus | null | undefined>,
      answeringHere: (id) => answering.has(id),
    });
  }

  beforeEach(() => {
    ringing = [];
    statuses = {};
    answering = new Set();
    port = {
      answered: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      ringing: vi.fn(async () => ringing),
      endAnswered: vi.fn(async () => {}),
    };
    status = vi.fn(async (id: string) => statuses[id]);
  });

  it("hands an answer on this device to CallKit", async () => {
    await sync().answeredHere("c1");
    expect(port.answered).toHaveBeenCalledWith("c1");
    expect(port.end).not.toHaveBeenCalled();
  });

  it("ends the ring as declined for a decline on this device", async () => {
    await sync().declinedHere("c1");
    expect(port.end).toHaveBeenCalledWith("c1", "declined");
  });

  it("swallows a native failure (old build, plugin error)", async () => {
    port.answered.mockRejectedValue(new Error("UNIMPLEMENTED"));
    port.end.mockRejectedValue(new Error("UNIMPLEMENTED"));
    port.ringing.mockRejectedValue(new Error("UNIMPLEMENTED"));
    const s = sync();
    await expect(s.answeredHere("c1")).resolves.toBeUndefined();
    await expect(s.declinedHere("c1")).resolves.toBeUndefined();
    await expect(s.reconcile(null)).resolves.toBeUndefined();
    expect(status).not.toHaveBeenCalled();
  });

  describe("reconcile", () => {
    it("ends each ring the server resolved, with its reason", async () => {
      ringing = ["answered", "declined", "missed", "gone"];
      statuses = { answered: "ACCEPTED", declined: "DECLINED", missed: "MISSED", gone: null };
      await sync().reconcile(null);
      expect(port.end.mock.calls).toEqual([
        ["answered", "answeredElsewhere"],
        ["declined", "declinedElsewhere"],
        ["missed", "unanswered"],
        ["gone", "remoteEnded"],
      ]);
    });

    it("leaves the call the server just reported as ringing without looking it up", async () => {
      ringing = ["c1"];
      await sync().reconcile("c1");
      expect(status).not.toHaveBeenCalled();
      expect(port.end).not.toHaveBeenCalled();
    });

    it("leaves a call that is still ringing for this user (another ring, a group invite)", async () => {
      ringing = ["c2"];
      statuses = { c2: "RINGING" };
      await sync().reconcile("c1");
      expect(status).toHaveBeenCalledWith("c2");
      expect(port.end).not.toHaveBeenCalled();
    });

    it("never ends a call this page is answering or has just answered", async () => {
      ringing = ["c1"];
      statuses = { c1: "ACCEPTED" };
      answering.add("c1");
      await sync().reconcile(null);
      expect(status).not.toHaveBeenCalled();
      expect(port.end).not.toHaveBeenCalled();
    });

    it("leaves a ring alone when its status couldn't be fetched", async () => {
      ringing = ["c1"];
      status.mockRejectedValue(new Error("offline"));
      await sync().reconcile(null);
      expect(port.end).not.toHaveBeenCalled();
      statuses = { c1: undefined };
      status.mockImplementation(async (id: string) => statuses[id]);
      await sync().reconcile(null);
      expect(port.end).not.toHaveBeenCalled();
    });

    it("does nothing when CallKit isn't ringing anything (or the build can't say)", async () => {
      await sync().reconcile(null);
      expect(status).not.toHaveBeenCalled();
    });

    it("looks each call up once while a check for it is already running", async () => {
      ringing = ["c1"];
      let release: (value: ServerCallStatus) => void = () => {};
      status.mockImplementation(() => new Promise<ServerCallStatus>((resolve) => (release = resolve)));
      const s = sync();
      const first = s.reconcile(null);
      const second = s.reconcile(null);
      await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1));
      release("DECLINED");
      await Promise.all([first, second]);
      expect(status).toHaveBeenCalledTimes(1);
      expect(port.end).toHaveBeenCalledTimes(1);
    });

    it("checks the same call again once the earlier check finished", async () => {
      ringing = ["c1"];
      statuses = { c1: "RINGING" };
      const s = sync();
      await s.reconcile(null);
      statuses = { c1: "MISSED" };
      await s.reconcile(null);
      expect(port.end).toHaveBeenCalledWith("c1", "unanswered");
    });
  });

  describe("reconcileDuringCall", () => {
    it("ends a ring CallKit shows for the call this page is in as answered elsewhere, without looking it up", async () => {
      ringing = ["active"];
      answering.add("active");
      await sync().reconcileDuringCall("active");
      expect(status).not.toHaveBeenCalled();
      expect(port.end).toHaveBeenCalledWith("active", "answeredElsewhere");
      expect(port.answered).not.toHaveBeenCalled();
    });

    it("reconciles any other ring as usual", async () => {
      ringing = ["active", "other", "still"];
      statuses = { other: "MISSED", still: "RINGING" };
      await sync().reconcileDuringCall("active");
      expect(port.end.mock.calls).toEqual([
        ["active", "answeredElsewhere"],
        ["other", "unanswered"],
      ]);
    });

    it("leaves another ring that is being answered here alone", async () => {
      ringing = ["other"];
      statuses = { other: "ACCEPTED" };
      answering.add("other");
      await sync().reconcileDuringCall("active");
      expect(port.end).not.toHaveBeenCalled();
    });

    it("does nothing on a build that can't list rings", async () => {
      port.ringing.mockRejectedValue(new Error("UNIMPLEMENTED"));
      await expect(sync().reconcileDuringCall("active")).resolves.toBeUndefined();
      expect(port.end).not.toHaveBeenCalled();
    });
  });

  describe("settle (an answer here was refused)", () => {
    it("ends the ring the way the call was resolved, even while marked as answering here", async () => {
      statuses = { c1: "ACCEPTED" };
      answering.add("c1");
      await sync().settle("c1");
      expect(port.end).toHaveBeenCalledWith("c1", "answeredElsewhere");
    });
  });

  describe("left (the page left a call answered here)", () => {
    it("ends CallKit's call for it", async () => {
      await sync().left("c1");
      expect(port.endAnswered).toHaveBeenCalledWith("c1");
      expect(port.end).not.toHaveBeenCalled();
    });

    it("does nothing on a build without the method", async () => {
      port.endAnswered.mockRejectedValue(new Error("UNIMPLEMENTED"));
      await expect(sync().left("c1")).resolves.toBeUndefined();
    });
  });
});

describe("planCallKitEnd", () => {
  it("hangs up the call this page is in", () => {
    expect(planCallKitEnd("c1", "c1", "hide")).toBe("hangUp");
    expect(planCallKitEnd("c1", "c1", "show")).toBe("hangUp");
  });

  it("ends a call whose answer is queued or in flight once it lands", () => {
    expect(planCallKitEnd("c1", null, "accept")).toBe("afterAnswer");
    expect(planCallKitEnd("c1", null, "hide")).toBe("afterAnswer");
    expect(planCallKitEnd("c1", "other", "hide")).toBe("afterAnswer");
  });

  it("ignores an End for a call this page has nothing to do with", () => {
    expect(planCallKitEnd("c1", null, "show")).toBe("ignore");
    expect(planCallKitEnd("c1", "other", "show")).toBe("ignore");
  });
});
