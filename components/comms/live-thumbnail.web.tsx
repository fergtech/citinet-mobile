import { useEffect, useState } from 'react';

// Resolves to livekit-init.web.ts (a no-op on web) — kept for import-order
// symmetry with live-thumbnail.tsx's own note; browsers have a native
// DOMException so this specific crash is RN/Hermes-only, but there's no
// reason for the two platform files to diverge in import order.
import '@/lib/comms/livekit-init';
import { Track } from 'livekit-client';
import { LiveKitRoom, useTracks, VideoTrack } from '@livekit/components-react';

import { getCommsToken } from '@/lib/api/hubService';
import { useSession } from '@/lib/session/session-context';

// Web counterpart of live-thumbnail.tsx — same split/reasoning as
// broadcast-overlay.web.tsx: @livekit/components-react's real <video>
// instead of RTCView, everything else identical. See that native file for
// the full explanation of why this connection is silent/hidden/never-
// publishes.
export function LiveThumbnail({ roomName, hostId }: { roomName: string; hostId: string }) {
  const { session } = useSession();
  const [conn, setConn] = useState<{ token: string; livekitUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!session) return;
    getCommsToken(session.hub.tunnelUrl, session.token, 'broadcast', roomName, undefined, true)
      .then((res) => {
        if (!cancelled) setConn({ token: res.token, livekitUrl: res.livekit_url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, roomName]);

  if (!conn) return null;

  return (
    <LiveKitRoom serverUrl={conn.livekitUrl} token={conn.token} audio={false} video={false} connect style={{ position: 'absolute', inset: 0 }}>
      <ThumbnailVideo hostId={hostId} />
    </LiveKitRoom>
  );
}

function ThumbnailVideo({ hostId }: { hostId: string }) {
  const tracks = useTracks([Track.Source.Camera]);
  const hostTrack = tracks.find((t) => t.participant.identity === hostId);
  if (!hostTrack) return null;
  return <VideoTrack trackRef={hostTrack} style={webVideoStyle} />;
}

// Plain CSSProperties, not RN style objects — VideoTrack here is
// @livekit/components-react's real <video>, same reasoning as every other
// webVideoStyle constant in this codebase (see broadcast-overlay.web.tsx).
const webVideoStyle = { width: '100%', height: '100%', objectFit: 'cover' } as const;
