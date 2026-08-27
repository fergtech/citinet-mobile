import { useEffect } from 'react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';

import { useBroadcast } from '@/lib/comms/broadcast-context';
import { decodeBroadcastMessage } from '@/lib/comms/broadcast-protocol';

// No UI — this exists purely to keep the RoomEvent.DataReceived listener
// alive regardless of whether the visible overlay content is mounted, since
// that's conditionally unmounted on minimize (see broadcast-overlay.tsx /
// .web.tsx) but comments/hearts/join-requests must keep accumulating in the
// background. Render this as a direct, unconditional child of <LiveKitRoom>
// on both platforms — @livekit/components-react's RoomContext (which
// useRoomContext reads) is the same object @livekit/react-native's own
// LiveKitRoom provides, so this one file works unmodified on both.
export function BroadcastDataBridge() {
  const room = useRoomContext();
  const { broadcast, addComment, addHeart, setPendingRequest, approvePublish, setJoinRequestPending, end } = useBroadcast();

  useEffect(() => {
    function handleData(payload: Uint8Array, participant?: { identity: string }) {
      const message = decodeBroadcastMessage(payload);
      const myIdentity = room.localParticipant.identity;
      console.log('[broadcast] data received', { type: message?.type, from: participant?.identity, myIdentity, myRole: broadcast.role, roomName: room.name });
      if (!message) return;

      if (message.type === 'comment') {
        addComment({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, senderId: message.senderId, senderName: message.senderName, text: message.text });
      } else if (message.type === 'heart') {
        addHeart(message.delta);
      } else if (message.type === 'join_request') {
        console.log('[broadcast] join_request received, amIHost=', broadcast.role === 'host');
        if (broadcast.role === 'host') setPendingRequest({ requesterId: message.requesterId, requesterName: message.requesterName });
      } else if (message.type === 'join_response') {
        if (message.requesterId !== myIdentity) return; // not addressed to me (only reaches me if it is, but be explicit)
        if (message.accepted) {
          approvePublish();
          addComment({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            senderId: 'system',
            senderName: '',
            text: `${message.requesterName} joined the live`,
            system: true,
          });
        } else {
          // Resets the Join in button back to tappable rather than leaving
          // it stuck showing "Requested" forever.
          setJoinRequestPending(false);
        }
      } else if (message.type === 'broadcast_ended') {
        // I'm never the one who sent this (see use-broadcast-actions.ts's
        // endBroadcast — the host doesn't receive its own room-wide data
        // back), so this only ever reaches viewers/guests: end their own
        // session too instead of leaving them stranded in a hostless room.
        end();
      }
    }

    // Every viewer who opens a live card actually joins the LiveKit room as
    // a participant even before requesting to publish, so these two fire
    // for anyone entering/leaving the broadcast at all — not just promoted
    // guests. Doubles as a diagnostic: if a device that's genuinely
    // connecting doesn't produce one of these on the other clients, the
    // connection itself never actually established (see the join-request
    // investigation — same class of failure).
    function handleParticipantJoined(participant: RemoteParticipant) {
      addComment({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        senderId: 'system',
        senderName: '',
        text: `${participant.name || 'Someone'} entered the broadcast`,
        system: true,
      });
    }

    function handleParticipantLeft(participant: RemoteParticipant) {
      addComment({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        senderId: 'system',
        senderName: '',
        text: `${participant.name || 'Someone'} left the broadcast`,
        system: true,
      });
    }

    // Catch-all for however the room actually goes away — the host's own
    // deleteRoom() call (see use-broadcast-actions.ts's endBroadcast) force-
    // disconnects everyone still in it at the protocol level, independent of
    // whether the room-wide 'broadcast_ended' data message above happened to
    // reach this client first. Also the backstop for any other reason the
    // connection drops (network loss, server restart) — better than a
    // frozen live screen nobody explicitly told to close.
    function handleDisconnected() {
      end();
    }

    room.on(RoomEvent.DataReceived, handleData);
    room.on(RoomEvent.ParticipantConnected, handleParticipantJoined);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantLeft);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
      room.off(RoomEvent.ParticipantConnected, handleParticipantJoined);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantLeft);
      room.off(RoomEvent.Disconnected, handleDisconnected);
    };
  }, [room, broadcast.role, addComment, addHeart, setPendingRequest, approvePublish, setJoinRequestPending, end]);

  return null;
}
