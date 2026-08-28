// Shared by PostRow, app/post/[id].tsx, app/events.tsx, and the Home/Discover
// Events preview rows — nothing in this app rendered an EVENT post's actual
// date/time anywhere until now (only event_location, in the two compact
// preview rows), which made "when is this happening" invisible everywhere
// except the raw API response.
// `compact` drops the weekday (only the Home preview row asks for this --
// every other call site keeps it, since a full events list or a post's own
// detail view benefits from "when is this happening" including the day of
// week, while the small Home card is optimizing for the shortest line
// that's still legible).
export function formatEventWhen(iso: string, compact = false): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(
    undefined,
    compact ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' }
  );
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

export function isPastEvent(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}
