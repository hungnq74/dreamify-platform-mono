import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNotificationStore } from "./useNotificationStore";
import { notificationService } from "@/services/notificationService";

vi.mock("@/services/notificationService", () => ({
  notificationService: {
    listNotifications: vi.fn(),
    markRead: vi.fn(),
  },
}));

const listNotifications = vi.mocked(notificationService.listNotifications);
const markRead = vi.mocked(notificationService.markRead);

function notification(id: string, read = false) {
  return {
    notification_id: id,
    read,
    type: "sync_success",
    title: `Notification ${id}`,
    body: "",
    created_at: "2026-01-01T00:00:00Z",
  } as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  listNotifications.mockResolvedValue({
    notifications: [notification("a"), notification("b")],
    unread_count: 2,
  } as never);
  markRead.mockResolvedValue(undefined as never);
});

afterEach(() => {
  useNotificationStore.getState().reset();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("polling lifecycle", () => {
  it("starts one interval however many times startPolling is called", async () => {
    const { startPolling } = useNotificationStore.getState();
    startPolling();
    startPolling();
    startPolling();
    await vi.advanceTimersByTimeAsync(0);

    // One immediate fetch, not three.
    expect(listNotifications).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(listNotifications).toHaveBeenCalledTimes(2);
  });

  it("stops fetching after stopPolling", async () => {
    const store = useNotificationStore.getState();
    store.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    store.stopPolling();

    await vi.advanceTimersByTimeAsync(180_000);
    expect(listNotifications).toHaveBeenCalledTimes(1);
  });

  it("reset stops the interval and clears state", async () => {
    const store = useNotificationStore.getState();
    store.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(useNotificationStore.getState().notifications).toHaveLength(2);

    useNotificationStore.getState().reset();
    await vi.advanceTimersByTimeAsync(180_000);

    expect(listNotifications).toHaveBeenCalledTimes(1);
    expect(useNotificationStore.getState().notifications).toEqual([]);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });
});

describe("optimistic reads survive a poll", () => {
  it("does not resurrect the unread flag when the server has not caught up", async () => {
    const store = useNotificationStore.getState();
    store.startPolling();
    await vi.advanceTimersByTimeAsync(0);

    await useNotificationStore.getState().markRead("a");
    expect(useNotificationStore.getState().unreadCount).toBe(1);

    // The server still reports "a" as unread on the next tick.
    await vi.advanceTimersByTimeAsync(60_000);

    const a = useNotificationStore
      .getState()
      .notifications.find((n) => n.notification_id === "a");
    expect(a?.read).toBe(true);
    expect(useNotificationStore.getState().unreadCount).toBe(1);
  });

  it("stops tracking an id once the server agrees it is read", async () => {
    const store = useNotificationStore.getState();
    store.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    await useNotificationStore.getState().markRead("a");

    listNotifications.mockResolvedValue({
      notifications: [notification("a", true), notification("b")],
      unread_count: 1,
    } as never);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(useNotificationStore.getState().unreadCount).toBe(1);
  });
});
