import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessingResponse } from "@/services/processingService";

vi.mock("@/services/processingService", () => ({
  processingService: {
    runProcessing: vi.fn(),
    pollProcessingStatus: vi.fn(),
    getWorkflowStatus: vi.fn(),
  },
}));

vi.mock("@/services/workflowStreamService", () => ({
  streamWorkflow: vi.fn(),
}));

vi.mock("@/services/conversationService", () => ({
  conversationService: {
    loadConversation: vi.fn(),
    getDashboardData: vi.fn(),
    stopWorkflow: vi.fn(),
    updateDashboardTheme: vi.fn(),
  },
}));

import { useChatStore } from "./useChatStore";
import { processingService } from "@/services/processingService";
import { streamWorkflow } from "@/services/workflowStreamService";

const mockedProcessingService = vi.mocked(processingService);
const mockedStreamWorkflow = vi.mocked(streamWorkflow);

function createLocalStorageStub(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const terminalResult: ProcessingResponse = {
  success: true,
  status: "completed",
  fileID: "",
} as ProcessingResponse;

describe("workflowStreamState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", createLocalStorageStub());
    useChatStore.setState({
      workflowStreamState: "idle",
      isStreamingWorkflow: false,
      currentProjectId: null,
      currentConversationId: null,
    });
    mockedProcessingService.runProcessing.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "accepted",
        fileID: "",
        conversation_id: "conversation_a",
      },
    } as never);
    mockedProcessingService.pollProcessingStatus.mockResolvedValue(terminalResult);
  });

  it("is 'live' while the stream is connected, so the poller stays quiet", async () => {
    let seenWhileConnected: string | undefined;
    mockedStreamWorkflow.mockImplementation(async (options) => {
      options.onConnected?.();
      seenWhileConnected = useChatStore.getState().workflowStreamState;
      return { connected: true, result: terminalResult };
    });

    await useChatStore
      .getState()
      .processFileWithMessage("build dashboard", undefined, "project_a");
    await flushPromises();

    expect(seenWhileConnected).toBe("live");
  });

  it("is 'fallback' once the stream gives up, which re-enables the poller", async () => {
    let seenAfterFallback: string | undefined;
    mockedStreamWorkflow.mockImplementation(async (options) => {
      options.onFallbackToPolling?.();
      seenAfterFallback = useChatStore.getState().workflowStreamState;
      return { connected: false };
    });

    await useChatStore
      .getState()
      .processFileWithMessage("build dashboard", undefined, "project_a");
    await flushPromises();

    expect(seenAfterFallback).toBe("fallback");
  });

  it("returns to 'idle' when the stream resolves without calling any callback", async () => {
    // This is exactly what the byte-pinned store tests mock, so the state
    // machine has to terminate cleanly on it and not strand a deadline timer.
    mockedStreamWorkflow.mockResolvedValue({ connected: false } as never);

    await useChatStore
      .getState()
      .processFileWithMessage("build dashboard", undefined, "project_a");
    await flushPromises();

    expect(useChatStore.getState().workflowStreamState).toBe("idle");
    expect(useChatStore.getState().isStreamingWorkflow).toBe(false);
    expect(mockedProcessingService.pollProcessingStatus).toHaveBeenCalled();
  });

  it("falls back when the stream never connects within the deadline", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let stateAtDeadline: string | undefined;

    mockedStreamWorkflow.mockImplementation(async () => {
      // Never connects, never falls back — just hangs past the deadline.
      await vi.advanceTimersByTimeAsync(5000);
      stateAtDeadline = useChatStore.getState().workflowStreamState;
      return { connected: false };
    });

    const run = useChatStore
      .getState()
      .processFileWithMessage("build dashboard", undefined, "project_a");
    await vi.advanceTimersByTimeAsync(6000);
    await run;

    expect(stateAtDeadline).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("did not connect within 4s"),
    );

    warn.mockRestore();
    vi.useRealTimers();
  });
});
