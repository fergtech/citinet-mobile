import { useEffect, useRef } from 'react';

import { IncomingCallPayload } from '@/lib/api/types';

export type CommsSocketEvent =
  | IncomingCallPayload
  | { type: 'call_answered'; call_id: string }
  | { type: 'call_declined'; call_id: string }
  | { type: 'call_ended'; call_id: string };

// tunnelUrl is http(s):// — swap the scheme for ws(s):// and keep the rest.
// The session token rides as a query param (not a header) since RN's
// WebSocket constructor has no way to set custom request headers.
function commsSocketUrl(tunnelUrl: string, token: string): string {
  const wsUrl = tunnelUrl.replace(/^http/, 'ws');
  return `${wsUrl}/ws/comms?token=${encodeURIComponent(token)}`;
}

// One always-on connection purely for "someone is calling you right now" —
// see api/comms.js's own note on why this exists at all (nothing else in
// this app has a push channel; everything else polls on focus). Reconnects
// on drop with a flat 3s retry — this isn't a channel anything else depends
// on staying open moment-to-moment, so simple retry beats exponential-
// backoff bookkeeping for what it's worth here.
export function useCommsSocket(
  tunnelUrl: string | undefined,
  token: string | undefined,
  onEvent: (event: CommsSocketEvent) => void
) {
  // Ref, not a dependency — onEvent is typically a fresh closure every
  // render (it reads live component state), and this effect must not
  // reconnect the socket just because that closure identity changed.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!tunnelUrl || !token) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(commsSocketUrl(tunnelUrl!, token!));
      ws.onmessage = (e) => {
        try {
          onEventRef.current(JSON.parse(e.data));
        } catch {
          // malformed payload — ignore rather than crash the socket
        }
      };
      ws.onclose = () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        ws?.close();
      };
    }
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [tunnelUrl, token]);
}
