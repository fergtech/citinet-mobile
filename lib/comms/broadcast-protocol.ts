// JSON-over-LiveKit-data-channel protocol for a broadcast's comments,
// hearts, and join requests. No server involvement — every client already
// has a LiveKit data channel open the moment it's in the room (see
// components/comms/broadcast-data-bridge.tsx), so this rides that instead
// of adding new hub WebSocket message types.
export type BroadcastMessage =
  | { type: 'comment'; text: string; senderId: string; senderName: string }
  // delta lets a per-viewer like/unlike toggle keep the shared tally
  // symmetric (+1 on like, -1 on unlike) without a separate message type.
  | { type: 'heart'; delta: 1 | -1 }
  | { type: 'join_request'; requesterId: string; requesterName: string }
  | { type: 'join_response'; requesterId: string; requesterName: string; accepted: boolean }
  // Room-wide, sent right before the host disconnects — there's no server
  // route to force-close a LiveKit room (see api/comms.js's own comment on
  // minimal persistence), so this is what lets every other client react
  // immediately instead of being silently stranded until they notice the
  // host's tile go dark, or until LiveKit's emptyTimeout (5 min) elapses.
  | { type: 'broadcast_ended' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeBroadcastMessage(message: BroadcastMessage): Uint8Array {
  return encoder.encode(JSON.stringify(message));
}

export function decodeBroadcastMessage(payload: Uint8Array): BroadcastMessage | null {
  try {
    const parsed = JSON.parse(decoder.decode(payload));
    if (parsed && typeof parsed.type === 'string') return parsed as BroadcastMessage;
  } catch {
    // malformed payload — ignore rather than crash the room connection
  }
  return null;
}

// Everything but 'heart' must actually arrive — a dropped comment or join
// request is a real gap, a dropped heart is just one less flying number.
export function isReliable(message: BroadcastMessage): boolean {
  return message.type !== 'heart';
}

// Only the host needs to see a join request, and only the requester needs
// to see their own decline (a room-wide "declined" would just be noise for
// everyone else) — every other message is room-wide. `accepted: true` stays
// room-wide on purpose: that's what lets every other client derive its own
// "<name> joined the live" comment-feed line from this same message.
export function destinationFor(message: BroadcastMessage, hostIdentity: string): string[] | undefined {
  if (message.type === 'join_request') return [hostIdentity];
  if (message.type === 'join_response' && !message.accepted) return [message.requesterId];
  return undefined;
}
