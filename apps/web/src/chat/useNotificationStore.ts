import { create } from 'zustand';
import { Notification, notificationService } from '@/services/notificationService';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

// Timer and optimistic bookkeeping live at module scope rather than in store
// state: they are not rendered, and keeping them in the store meant every
// start/stop was a state write that notified every subscriber.
let intervalId: ReturnType<typeof setInterval> | null = null;
let visibilityListener: (() => void) | null = null;

// Ids the user has marked read locally but the server has not confirmed yet.
// fetchNotifications replaces the whole list, so without this a poll landing
// between the optimistic update and the server catching up would resurrect the
// unread badge.
const optimisticallyRead = new Set<string>();

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;

  fetchNotifications: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  reset: () => void;
}

function applyOptimisticReads(notifications: Notification[]): {
  notifications: Notification[];
  unreadDelta: number;
} {
  let unreadDelta = 0;
  const merged = notifications.map((notification) => {
    if (!optimisticallyRead.has(notification.notification_id)) return notification;
    if (notification.read) {
      // The server agrees now, so stop tracking it locally.
      optimisticallyRead.delete(notification.notification_id);
      return notification;
    }
    unreadDelta += 1;
    return { ...notification, read: true };
  });
  return { notifications: merged, unreadDelta };
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,

  fetchNotifications: async () => {
    set({ isLoading: true });
    try {
      const res = await notificationService.listNotifications(false, 20);
      const { notifications, unreadDelta } = applyOptimisticReads(res.notifications);
      set({
        notifications,
        unreadCount: Math.max(0, res.unread_count - unreadDelta),
      });
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    } finally {
      set({ isLoading: false });
    }
  },

  markRead: async (notificationId: string) => {
    optimisticallyRead.add(notificationId);
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.notification_id === notificationId ? { ...n, read: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
    try {
      await notificationService.markRead([notificationId]);
    } catch (err) {
      optimisticallyRead.delete(notificationId);
      console.error('Failed to mark notification read', err);
    }
  },

  markAllRead: async () => {
    const { notifications } = get();
    notifications.forEach((n) => optimisticallyRead.add(n.notification_id));
    set({
      notifications: notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    });
    try {
      await notificationService.markRead();
    } catch (err) {
      console.error('Failed to mark all notifications read', err);
    }
  },

  startPolling: () => {
    if (intervalId) return; // already polling
    const { fetchNotifications } = get();

    void fetchNotifications();
    intervalId = setInterval(fetchNotifications, POLL_INTERVAL_MS);

    // A backgrounded tab used to keep polling at full rate. Pause while hidden
    // and fetch once on return, so the badge is current when it is next looked
    // at without spending requests while it is not.
    if (typeof document !== 'undefined' && !visibilityListener) {
      visibilityListener = () => {
        if (document.hidden) {
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
          return;
        }
        if (!intervalId) {
          void get().fetchNotifications();
          intervalId = setInterval(get().fetchNotifications, POLL_INTERVAL_MS);
        }
      };
      document.addEventListener('visibilitychange', visibilityListener);
    }
  },

  stopPolling: () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityListener);
      visibilityListener = null;
    }
  },

  // Called on sign-out. Without it the interval outlived the session and kept
  // issuing requests that could only 401, and those failures were only
  // console.error'd so nothing surfaced.
  reset: () => {
    get().stopPolling();
    optimisticallyRead.clear();
    set({ notifications: [], unreadCount: 0, isLoading: false });
  },
}));
