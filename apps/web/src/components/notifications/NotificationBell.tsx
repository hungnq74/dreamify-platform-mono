import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@/lib/navigation';
import { Bell, CheckCheck, ArrowRight, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { useNotificationStore } from '@/chat/useNotificationStore';
import { Notification } from '@/services/notificationService';

function formatRelativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NotificationIcon({ type }: { type: Notification['type'] }) {
  if (type === 'sync_success') return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (type === 'token_expired') return <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />;
  return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
}

function NotificationItem({ notification, onClose }: { notification: Notification; onClose: () => void }) {
  const navigate = useNavigate();
  const { markRead } = useNotificationStore();

  const handleClick = async () => {
    if (!notification.read) {
      await markRead(notification.notification_id);
    }
    if (notification.type === 'sync_success' && notification.asset_id && notification.project_id) {
      onClose();
      navigate(`/workspace/project?projectId=${notification.project_id}&analyze=${notification.asset_id}`);
    }
  };

  const isClickable = notification.type === 'sync_success' && !!notification.asset_id;

  return (
    <div
      onClick={isClickable ? handleClick : undefined}
      className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 last:border-0 transition-colors ${
        isClickable ? 'cursor-pointer hover:bg-muted/60' : ''
      } ${!notification.read ? 'bg-primary/5' : ''}`}
    >
      <div className="mt-0.5">
        <NotificationIcon type={notification.type} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${!notification.read ? 'font-medium text-foreground' : 'text-foreground/80'}`}>
          {notification.title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.body}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-muted-foreground/70">{formatRelativeTime(notification.created_at)}</span>
          {isClickable && (
            <span className="flex items-center gap-0.5 text-xs text-primary font-medium">
              Analyze <ArrowRight className="w-3 h-3" />
            </span>
          )}
        </div>
      </div>
      {!notification.read && (
        <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
      )}
    </div>
  );
}

export function NotificationBell() {
  const { notifications, unreadCount, isLoading, markAllRead } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Polling is owned by the workspace page, not by this component. The bell is
  // only rendered on one workspace tab, so starting the interval here meant
  // switching tabs stopped notifications entirely.

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => setOpen((v) => !v);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="relative flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute top-full right-0 mt-2 z-50 w-80 rounded-xl border border-border bg-background shadow-xl overflow-hidden"
          style={{
            animation: 'fadeInDown 180ms cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Body */}
          <div className="max-h-80 overflow-y-auto">
            {isLoading && notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Sync results will appear here
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationItem key={n.notification_id} notification={n} onClose={() => setOpen(false)} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
