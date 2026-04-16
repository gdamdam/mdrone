/**
 * NotificationTray — fixed-position toast surface in the top-right.
 *
 * Subscribes to the module-level notifications store and auto-
 * dismisses entries after a duration scaled by kind (info: 4 s,
 * warning: 6 s, error: 8 s). Each entry has a close button for
 * explicit dismissal.
 */

import { useEffect, useState } from "react";
import {
  dismissNotification,
  onNotifications,
  type Notification,
  type NotificationKind,
} from "../notifications";

const AUTO_DISMISS_MS: Record<NotificationKind, number> = {
  info: 4000,
  warning: 6000,
  error: 8000,
};

export function NotificationTray() {
  const [list, setList] = useState<readonly Notification[]>([]);

  useEffect(() => {
    const unsub = onNotifications(setList);
    return unsub;
  }, []);

  // Schedule one dismissal per entry based on its kind. Timers clear
  // on list change so a fresh snapshot supersedes in-flight dismissals
  // (important when an entry is dismissed early by the close button).
  useEffect(() => {
    if (list.length === 0) return;
    const timers = list.map((n) =>
      window.setTimeout(
        () => dismissNotification(n.id),
        AUTO_DISMISS_MS[n.kind],
      ),
    );
    return () => { timers.forEach(window.clearTimeout); };
  }, [list]);

  if (list.length === 0) return null;
  return (
    <div className="notification-tray" role="status" aria-live="polite">
      {list.map((n) => (
        <div key={n.id} className={`notification notification-${n.kind}`}>
          <span className="notification-message">{n.message}</span>
          <button
            type="button"
            className="notification-close"
            onClick={() => dismissNotification(n.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
