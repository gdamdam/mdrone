/**
 * notifications — tiny global toast store.
 *
 * Replaces silent `console.error` and jarring `window.alert` with a
 * visible, non-blocking toast tray that survives across components.
 * Used for: worklet load failures, recording errors, Link Bridge
 * disconnects (when explicitly enabled), and any other failure mode
 * that the user actually needs to know about but shouldn't stop them
 * from working.
 *
 * API is intentionally tiny — one `showNotification()` emit, one
 * listener subscription. Consumers render whatever UI they want;
 * mdrone ships `<NotificationTray />` as the default surface.
 */

export type NotificationKind = "info" | "warning" | "error";

export interface Notification {
  id: number;
  message: string;
  kind: NotificationKind;
  timestamp: number;
}

let nextId = 1;
let notifications: Notification[] = [];
const listeners = new Set<(n: readonly Notification[]) => void>();

/** Cap to keep the tray sane during unexpected spam (e.g. a retry
 *  loop hammering the console). Older entries are dropped. */
const MAX_NOTIFICATIONS = 4;

function emit(): void {
  const snapshot = [...notifications];
  listeners.forEach((fn) => fn(snapshot));
}

/** Emit a notification. Returns its id so the caller can dismiss it
 *  early (e.g. once the underlying condition clears). */
export function showNotification(
  message: string,
  kind: NotificationKind = "info",
): number {
  const entry: Notification = {
    id: nextId++,
    message,
    kind,
    timestamp: Date.now(),
  };
  notifications.push(entry);
  while (notifications.length > MAX_NOTIFICATIONS) notifications.shift();
  emit();
  return entry.id;
}

export function dismissNotification(id: number): void {
  const next = notifications.filter((n) => n.id !== id);
  if (next.length !== notifications.length) {
    notifications = next;
    emit();
  }
}

export function onNotifications(fn: (n: readonly Notification[]) => void): () => void {
  listeners.add(fn);
  fn(notifications);
  return () => { listeners.delete(fn); };
}
