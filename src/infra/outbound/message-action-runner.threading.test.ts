import { describe, expect, it, vi } from "vitest";
import {
  resolveAndApplyOutboundReplyToId,
  resolveAndApplyOutboundThreadId,
} from "./message-action-threading.js";

const threadContext = {
  cfg: {},
  to: "forum:123",
  toolContext: { currentChannelId: "forum:123", currentThreadTs: "42" },
};
const replyContext = {
  channel: "workspace",
  toolContext: {
    currentChannelId: "channel:C123",
    currentMessageId: "msg-42",
    replyToMode: "all",
  },
} satisfies Parameters<typeof resolveAndApplyOutboundReplyToId>[1];

describe("message action threading helpers", () => {
  it("skips auto-threading for an explicit null threadId", () => {
    const resolveAutoThreadId = vi.fn(() => "42");
    const resolved = resolveAndApplyOutboundThreadId(
      { threadId: null },
      { ...threadContext, resolveAutoThreadId },
    );

    expect(resolved).toBeUndefined();
    expect(resolveAutoThreadId).not.toHaveBeenCalled();
  });

  it("inherits replies for routable target aliases", () => {
    const actionParams: Record<string, unknown> = { to: "user:U123" };
    const resolved = resolveAndApplyOutboundReplyToId(actionParams, {
      channel: "slack",
      toolContext: {
        ...replyContext.toolContext,
        currentChannelId: "D123",
        currentMessagingTarget: "user:U123",
      },
    });

    expect(resolved).toEqual({ replyToId: "msg-42", source: "implicit", mode: "all" });
    expect(actionParams.replyTo).toBe("msg-42");
  });

  it("skips inherited reply ids for explicit top-level sends", () => {
    const actionParams: Record<string, unknown> = { target: "channel:C123", topLevel: true };
    expect(resolveAndApplyOutboundReplyToId(actionParams, replyContext)).toBeUndefined();
    expect(actionParams.replyTo).toBeUndefined();
  });

  it("consumes batched replies once for normalized aliases", () => {
    const hasRepliedRef = { value: false };
    const matchesToolContextTarget = vi.fn(({ target }: { target: string }) => target === "U123");
    const context = {
      channel: "slack",
      toolContext: {
        currentChannelId: "D123",
        currentMessagingTarget: "user:U123",
        currentMessageId: "msg-42",
        replyToMode: "batched",
        hasRepliedRef,
      },
      matchesToolContextTarget,
    } satisfies Parameters<typeof resolveAndApplyOutboundReplyToId>[1];
    const actionParams: Record<string, unknown> = { target: "U123" };

    expect(resolveAndApplyOutboundReplyToId(actionParams, context)).toEqual({
      replyToId: "msg-42",
      source: "implicit",
      mode: "first",
    });
    expect(actionParams.replyTo).toBe("msg-42");
    expect(resolveAndApplyOutboundReplyToId({ target: "U123" }, context)).toBeUndefined();
    expect(hasRepliedRef.value).toBe(true);
    expect(matchesToolContextTarget).toHaveBeenCalledTimes(2);
  });

  it("consumes first-mode for explicit replies", () => {
    const hasRepliedRef = { value: false };
    const context = {
      ...replyContext,
      toolContext: { ...replyContext.toolContext, replyToMode: "first", hasRepliedRef },
    } satisfies Parameters<typeof resolveAndApplyOutboundReplyToId>[1];

    expect(resolveAndApplyOutboundReplyToId({ replyTo: "explicit-1" }, context)).toEqual({
      replyToId: "explicit-1",
      source: "explicit",
    });
    expect(resolveAndApplyOutboundReplyToId({ target: "channel:C123" }, context)).toBeUndefined();
    expect(hasRepliedRef.value).toBe(true);
  });

  it("isolates replies across providers with matching target IDs", () => {
    const actionParams: Record<string, unknown> = { target: "channel:C123" };
    const resolved = resolveAndApplyOutboundReplyToId(actionParams, {
      channel: "discord",
      toolContext: { ...replyContext.toolContext, currentChannelProvider: "slack" },
    });

    expect(resolved).toBeUndefined();
    expect(actionParams.replyTo).toBeUndefined();
  });

  it.each([
    ["first", ["456", undefined, undefined]],
    ["batched", ["456", undefined, undefined]],
    ["all", ["456", "456", "456"]],
    ["off", [undefined, undefined, undefined]],
  ] as const)("applies %s mode across one turn's message-tool sends", (mode, expected) => {
    const context = {
      channel: "telegram",
      toolContext: {
        currentChannelId: "telegram:123",
        currentMessageId: "456",
        replyToMode: mode,
        hasRepliedRef: { value: false },
      },
    } satisfies Parameters<typeof resolveAndApplyOutboundReplyToId>[1];
    const sends = expected.map(() => {
      const actionParams: Record<string, unknown> = { target: "telegram:123" };
      resolveAndApplyOutboundReplyToId(actionParams, context);
      return actionParams.replyTo;
    });

    expect(sends).toEqual(expected);
  });

  it.each(["first", "batched"] as const)(
    "lets an explicit replyTo consume the %s turn ref",
    (mode) => {
      const hasRepliedRef = { value: false };
      const context = {
        channel: "telegram",
        toolContext: {
          currentChannelId: "telegram:123",
          currentMessageId: "456",
          replyToMode: mode,
          hasRepliedRef,
        },
      } satisfies Parameters<typeof resolveAndApplyOutboundReplyToId>[1];

      expect(resolveAndApplyOutboundReplyToId({ replyTo: "455" }, context)).toEqual({
        replyToId: "455",
        source: "explicit",
      });
      expect(hasRepliedRef.value).toBe(true);
      expect(resolveAndApplyOutboundReplyToId({ target: "telegram:123" }, context)).toBeUndefined();
    },
  );
});
