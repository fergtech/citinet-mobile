// Shared by PostRow, app/post/[id].tsx, app/events.tsx, and the Home/Discover
// Events preview rows — nothing in this app rendered an EVENT post's actual
// date/time anywhere until now (only event_location, in the two compact
// preview rows), which made "when is this happening" invisible everywhere
// except the raw API response.
export function formatEventWhen(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

export function isPastEvent(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}
