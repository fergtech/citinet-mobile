import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

// Must run before any import below touches livekit-client — registerGlobals()
// is what polyfills the WebRTC/DOM globals (e.g. DOMException) that
// livekit-client's module-level code needs just to evaluate, not merely to
// run. app/_layout.tsx already imports this first for exactly that reason,
// but Expo Router eagerly scans every route file to build its route tree,
// and this file is now reachable from app/(tabs)/messages.tsx's own import
// graph — that eager scan can reach livekit-client before _layout.tsx's own
// import has actually executed. Re-importing here is a no-op if it already
// ran (module imports are cached by specifier), and guarantees ordering
// either way.
import '@/lib/comms/livekit-init';
import { Track } from 'livekit-client';
import { LiveKitRoom, useTracks, VideoTrack } from '@livekit/react-native';

import { getCommsToken } from '@/lib/api/hubService';
import { useSession } from '@/lib/session/session-context';

// Renders a live camera-preview thumbnail on a "Live now" card (see
// LiveCard in app/(tabs)/messages.tsx) so a viewer can see what they're
// about to walk into before tapping in. This opens its own silent LiveKit
// connection per visible card — never publishes (audio/video false,
// canPublish:false server-side) and is minted with hidden:true, so it never
// shows up as a real viewer: no participant-count inflation, no "X entered
// the broadcast" announcement (see broadcast-data-bridge.tsx's
// permissions.hidden check). Renders nothing (falls back to the card's own
// gradient background) until a token's fetched and the host's camera track
// actually shows up.
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
      .catch(() => {
        // Silent — the card just keeps showing its gradient background.
        // Nothing actionable for the user here (room may have already
        // ended, network hiccup, etc.), same reasoning as every other
        // best-effort background fetch in this file.
      });
    return () => {
      cancelled = true;
    };
  }, [session, roomName]);

  if (!conn) return null;

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <LiveKitRoom serverUrl={conn.livekitUrl} token={conn.token} audio={false} video={false} connect>
        <ThumbnailVideo hostId={hostId} />
      </LiveKitRoom>
    </View>
  );
}

function ThumbnailVideo({ hostId }: { hostId: string }) {
  const tracks = useTracks([Track.Source.Camera]);
  const hostTrack = tracks.find((t) => t.participant.identity === hostId);
  if (!hostTrack) return null;
  return <VideoTrack trackRef={hostTrack} style={styles.video} />;
}

const styles = StyleSheet.create({
  video: {
    width: '100%',
    height: '100%',
  },
});
