import { describe, expect, it, vi } from "vitest";
import { createToolProgressController, type ToolProgressAdapter } from "./tool-progress.js";

function createMockAdapter() {
  const messages: Array<{ id: number; text: string }> = [];
  let nextId = 1;
  const adapter: ToolProgressAdapter = {
    send: vi.fn(async (text: string) => {
      const id = nextId++;
      messages.push({ id, text });
      return id;
    }),
    edit: vi.fn(async (messageId: string | number, text: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (msg) {
        msg.text = text;
      }
    }),
    delete: vi.fn(async (messageId: string | number) => {
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx >= 0) {
        messages.splice(idx, 1);
      }
    }),
  };
  return { adapter, messages };
}

describe("createToolProgressController", () => {
  it("does nothing when disabled", async () => {
    const { adapter } = createMockAdapter();
    const ctrl = createToolProgressController({
      enabled: false,
      adapter,
    });

    ctrl.onToolStart("exec", "🔧 exec: ls -la");
    ctrl.onToolEnd("exec", "🔧 exec: ls -la", false);
    await ctrl.cleanup();

    expect(adapter.send).not.toHaveBeenCalled();
    expect(adapter.edit).not.toHaveBeenCalled();
    expect(adapter.delete).not.toHaveBeenCalled();
  });

  it("sends a status message on first tool start", async () => {
    const { adapter, messages } = createMockAdapter();
    const ctrl = createToolProgressController({
      enabled: true,
      adapter,
      config: { throttleMs: 0 },
    });

    ctrl.onToolStart("exec", "🔧 exec: ls -la");
    // Allow async flush
    await vi.waitFor(() => {
      expect(adapter.send).toHaveBeenCalledTimes(1);
    });

    expect(messages.length).toBe(1);
    expect(messages[0].text).toContain("🔧 exec: ls -la");

    await ctrl.cleanup();
  });

  it("edits existing message on subsequent updates", async () => {
    const { adapter, messages } = createMockAdapter();
    const ctrl = createToolProgressController({
      enabled: true,
      adapter,
      config: { throttleMs: 0 },
    });

    ctrl.onToolStart("exec", "🔧 exec: ls -la");
    await vi.waitFor(() => {
      expect(adapter.send).toHaveBeenCalledTimes(1);
    });

    ctrl.onToolEnd("exec", "🔧 exec: ls -la", false);
    ctrl.onToolStart("read", "📖 read: src/index.ts");
    await vi.waitFor(() => {
      expect(adapter.edit).toHaveBeenCalled();
    });

    // Should have sent once and edited at least once
    expect(adapter.send).toHaveBeenCalledTimes(1);
    // Message should show completed tool and active tool
    const lastText = messages[0].text;
    expect(lastText).toContain("✅");
    expect(lastText).toContain("📖 read: src/index.ts");

    await ctrl.cleanup();
  });

  it("shows error mark for failed tools", async () => {
    const { adapter, messages } = createMockAdapter();
    const ctrl = createToolProgressController({
      enabled: true,
      adapter,
      config: { throttleMs: 0 },
    });

    ctrl.onToolStart("exec", "🔧 exec: bad-cmd");
    await vi.waitFor(() => {
      expect(adapter.send).toHaveBeenCalledTimes(1);
    });

    ctrl.onToolEnd("exec", "🔧 exec: bad-cmd", true);
    await vi.waitFor(() => {
      expect(adapter.edit).toHaveBeenCalled();
    });

    const lastText = messages[0].text;
    expect(lastText).toContain("❌");

    await ctrl.cleanup();
  });

  it("cleanup deletes the status message", async () => {
    const { adapter, messages } = createMockAdapter();
    const ctrl = createToolProgressController({
      enabled: true,
      adapter,
      config: { throttleMs: 0 },
    });

    ctrl.onToolStart("exec", "🔧 exec: ls");
    await vi.waitFor(() => {
      expect(adapter.send).toHaveBeenCalledTimes(1);
    });

    expect(messages.length).toBe(1);
    await ctrl.cleanup();
    expect(adapter.delete).toHaveBeenCalledWith(1);
    expect(messages.length).toBe(0);
  });

  it("uses tool name as fallback when meta is undefined", async () => {
    const { adapter, messages } = createMockAdapter();
    const ctrl = createToolProgressController({
      enabled: true,
      adapter,
      config: { throttleMs: 0 },
    });

    ctrl.onToolStart("web_search", undefined);
    await vi.waitFor(() => {
      expect(adapter.send).toHaveBeenCalledTimes(1);
    });

    expect(messages[0].text).toContain("web_search");

    await ctrl.cleanup();
  });

  it("respects maxVisibleTools", async () => {
    const { adapter, messages } = createMockAdapter();
    const ctrl = createToolProgressController({
      enabled: true,
      adapter,
      config: { throttleMs: 0, maxVisibleTools: 2 },
    });

    // Complete 3 tools then start a 4th
    ctrl.onToolStart("tool1", "step 1");
    await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1));

    ctrl.onToolEnd("tool1", "step 1", false);
    ctrl.onToolStart("tool2", "step 2");
    await vi.waitFor(() => expect(adapter.edit).toHaveBeenCalled());

    ctrl.onToolEnd("tool2", "step 2", false);
    ctrl.onToolStart("tool3", "step 3");
    // Wait for edits to propagate
    await new Promise((r) => setTimeout(r, 50));

    ctrl.onToolEnd("tool3", "step 3", false);
    ctrl.onToolStart("tool4", "step 4");
    // Wait for all edits to flush
    await new Promise((r) => setTimeout(r, 50));

    // With maxVisibleTools=2 and 3 completed + 1 active, should show "... 1 more"
    const lastText = messages[0].text;
    expect(lastText).toContain("... 1 more");
    expect(lastText).toContain("step 4");

    await ctrl.cleanup();
  });

  it("handles adapter errors gracefully", async () => {
    const onError = vi.fn();
    const adapter: ToolProgressAdapter = {
      send: vi.fn(async () => {
        throw new Error("send failed");
      }),
      edit: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    const ctrl = createToolProgressController({
      enabled: true,
      adapter,
      config: { throttleMs: 0 },
      onError,
    });

    ctrl.onToolStart("exec", "test");
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    // Should not throw
    await ctrl.cleanup();
  });
});
