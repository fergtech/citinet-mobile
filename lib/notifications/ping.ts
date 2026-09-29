// Bridges the hub's "you have a new notification" socket event (received in
// CallProvider, which owns the one comms socket) to useNotificationAlerts
// (lives in the tab layout) without either importing the other.
type Listener = () => void;
const listeners = new Set<Listener>();

export function emitNotificationPing(): void {
  listeners.forEach((l) => l());
}

export function onNotificationPing(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
