import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { answerCall, declineCall, endCall, ringCall } from '@/lib/api/hubService';
import { CallMode, CallOutcome } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';

import { useCommsSocket } from './socket';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connected' | 'ended';

export type CallState = {
  phase: CallPhase;
  callId: string | null;
  conversationId: string | null;
  peerId: string | null;
  peerName: string | null;
  mode: CallMode;
  roomName: string | null;
  token: string | null;
  livekitUrl: string | null;
  // Wall-clock timestamp (Date.now()), not a tick counter — a counter
  // incremented on an interval drifts under re-render load; every on-screen
  // timer derives from `Date.now() - startedAt` instead (see
  // lib/comms/use-elapsed.ts).
  startedAt: number | null;
  minimized: boolean;
  layout: 'split' | 'focus';
  micOn: boolean;
  camOn: boolean;
  blurOn: boolean;
  speakerOn: boolean;
  sharingOn: boolean;
  // Lives here, not local state in components/comms/in-call-overlay.tsx's
  // RoomContent, because that component unmounts on minimize — local state
  // would silently reset to 'user' on restore while the actual camera
  // stayed wherever it was, desyncing the mirror styling from reality.
  facingMode: 'user' | 'environment';
  // Set the instant a call resolves — the transcript chip (rendered by
  // app/conversation/[id].tsx) reads this once, then the thread's own
  // call-events refetch takes over as the durable record.
  endedOutcome: CallOutcome | null;
};

const idleState: CallState = {
  phase: 'idle',
  callId: null,
  conversationId: null,
  peerId: null,
  peerName: null,
  mode: 'video',
  roomName: null,
  token: null,
  livekitUrl: null,
  startedAt: null,
  minimized: false,
  layout: 'split',
  micOn: true,
  camOn: true,
  blurOn: false,
  speakerOn: true,
  sharingOn: false,
  facingMode: 'user',
  endedOutcome: null,
};

type CallContextValue = {
  call: CallState;
  startOutgoingCall: (args: { conversationId: string; peerId: string; peerName: string; mode: CallMode }) => void;
  answer: () => void;
  decline: () => void;
  end: () => void;
  reset: () => void;
  setMode: (mode: CallMode) => void;
  toggleMic: () => void;
  toggleCam: () => void;
  toggleBlur: () => void;
  toggleSpeaker: () => void;
  toggleSharing: () => void;
  toggleFacingMode: () => void;
  toggleLayout: () => void;
  minimize: () => void;
  restore: () => void;
};

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [call, setCall] = useState<CallState>(idleState);
  // Actions below read `call` synchronously inside async callbacks and the
  // socket handler — a ref sidesteps stale closures without re-subscribing
  // useCommsSocket (and its WS connection) on every state change.
  const callRef = useRef(call);
  callRef.current = call;

  useCommsSocket(session?.hub.tunnelUrl, session?.token, (event) => {
    if (event.type === 'incoming_call') {
      // A second ring arriving mid-call is a real product gap (should
      // busy-signal it) — out of scope here; just don't let it stomp
      // whatever's already happening.
      if (callRef.current.phase !== 'idle') return;
      setCall({
        ...idleState,
        phase: 'incoming',
        callId: event.call_id,
        conversationId: event.conversation_id,
        peerId: event.from_id,
        peerName: event.from_username,
        mode: event.mode,
        roomName: event.room_name,
      });
    } else if (event.type === 'call_answered') {
      // Caller's own token/roomName were already set by startOutgoingCall's
      // ringCall() response — this just flips the phase now that the callee
      // has actually picked up.
      if (callRef.current.callId === event.call_id) {
        setCall((prev) => ({ ...prev, phase: 'connected', startedAt: Date.now() }));
      }
    } else if (event.type === 'call_declined' || event.type === 'call_ended') {
      if (callRef.current.callId === event.call_id && callRef.current.phase !== 'idle' && callRef.current.phase !== 'ended') {
        setCall((prev) => ({
          ...prev,
          phase: 'ended',
          endedOutcome: event.type === 'call_declined' ? 'declined' : prev.startedAt ? 'connected' : 'not_answered',
        }));
      }
    }
  });

  const startOutgoingCall = useCallback<CallContextValue['startOutgoingCall']>(
    ({ conversationId, peerId, peerName, mode }) => {
      if (!session) return;
      // Carry forward mic/cam/speaker from whatever the pre-call setup
      // screen's toggles left them at — same bug class as broadcast-
      // context.tsx's startBroadcast (see its own note): spreading idleState
      // wholesale here discarded a mute set right before placing the call.
      setCall((prev) => ({
        ...idleState,
        phase: 'outgoing',
        conversationId,
        peerId,
        peerName,
        mode,
        micOn: prev.micOn,
        camOn: prev.camOn,
        blurOn: prev.blurOn,
        speakerOn: prev.speakerOn,
      }));
      ringCall(session.hub.tunnelUrl, session.token, conversationId, peerId, mode)
        .then((res) => {
          setCall((prev) =>
            prev.phase === 'outgoing'
              ? { ...prev, callId: res.call_id, roomName: res.room_name, token: res.token, livekitUrl: res.livekit_url }
              : prev
          );
        })
        .catch(() => {
          setCall((prev) => ({ ...prev, phase: 'ended', endedOutcome: 'not_answered' }));
        });
    },
    [session]
  );

  const answer = useCallback(() => {
    if (!session || !callRef.current.callId) return;
    const callId = callRef.current.callId;
    answerCall(session.hub.tunnelUrl, session.token, callId)
      .then((res) => {
        setCall((prev) =>
          prev.callId === callId
            ? { ...prev, phase: 'connected', roomName: res.room_name, mode: res.mode, token: res.token, livekitUrl: res.livekit_url, startedAt: Date.now() }
            : prev
        );
      })
      .catch(() => {
        setCall((prev) => (prev.callId === callId ? { ...prev, phase: 'ended', endedOutcome: 'not_answered' } : prev));
      });
  }, [session]);

  const decline = useCallback(() => {
    if (session && callRef.current.callId) declineCall(session.hub.tunnelUrl, session.token, callRef.current.callId);
    setCall(idleState);
  }, [session]);

  const end = useCallback(() => {
    if (session && callRef.current.callId) endCall(session.hub.tunnelUrl, session.token, callRef.current.callId);
    setCall((prev) => ({ ...prev, phase: 'ended', endedOutcome: prev.startedAt ? 'connected' : 'not_answered' }));
  }, [session]);

  const reset = useCallback(() => setCall(idleState), []);

  // Safety net for phase 'ended': app/call/setup.tsx used to be the only
  // thing that reset back to idle, via its own 900ms timer — but that
  // screen already popped itself the instant phase hit 'connected' (see its
  // own effect), so for any call that actually connected, nothing was still
  // mounted to catch 'ended' when the in-call overlay's End button fired it.
  // Phase stayed stuck at 'ended' until the next call attempt remounted
  // setup.tsx, which then saw the stale 'ended' phase and immediately
  // auto-closed itself — the "opens for a moment then closes" symptom.
  // Living here instead guarantees it fires regardless of which screen (if
  // any) happens to be mounted.
  useEffect(() => {
    if (call.phase !== 'ended') return;
    const timer = setTimeout(() => setCall(idleState), 900);
    return () => clearTimeout(timer);
  }, [call.phase]);
  const setMode = useCallback((mode: CallMode) => setCall((prev) => ({ ...prev, mode })), []);
  const toggleMic = useCallback(() => setCall((prev) => ({ ...prev, micOn: !prev.micOn })), []);
  const toggleCam = useCallback(() => setCall((prev) => ({ ...prev, camOn: !prev.camOn })), []);
  const toggleBlur = useCallback(() => setCall((prev) => ({ ...prev, blurOn: !prev.blurOn })), []);
  const toggleSpeaker = useCallback(() => setCall((prev) => ({ ...prev, speakerOn: !prev.speakerOn })), []);
  const toggleSharing = useCallback(() => setCall((prev) => ({ ...prev, sharingOn: !prev.sharingOn })), []);
  const toggleFacingMode = useCallback(() => setCall((prev) => ({ ...prev, facingMode: prev.facingMode === 'user' ? 'environment' : 'user' })), []);
  const toggleLayout = useCallback(() => setCall((prev) => ({ ...prev, layout: prev.layout === 'split' ? 'focus' : 'split' })), []);
  const minimize = useCallback(() => setCall((prev) => ({ ...prev, minimized: true })), []);
  const restore = useCallback(() => setCall((prev) => ({ ...prev, minimized: false })), []);

  const value = useMemo<CallContextValue>(
    () => ({ call, startOutgoingCall, answer, decline, end, reset, setMode, toggleMic, toggleCam, toggleBlur, toggleSpeaker, toggleSharing, toggleFacingMode, toggleLayout, minimize, restore }),
    [call, startOutgoingCall, answer, decline, end, reset, setMode, toggleMic, toggleCam, toggleBlur, toggleSpeaker, toggleSharing, toggleFacingMode, toggleLayout, minimize, restore]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within CallProvider');
  return ctx;
}
