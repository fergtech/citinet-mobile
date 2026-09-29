import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { listUnreadNotifications, markNotificationsForRef } from '@/lib/api/hubService';
import { getActiveConversation } from '@/lib/notifications/active-conversation';
import { onNotificationPing } from '@/lib/notifications/ping';
import { playNotificationAlert, preloadAlertSounds } from '@/lib/notifications/alert';

// The hub has no notification push channel (its one WebSocket only carries
// call events), so "new notification" is detected by polling the same
// unread endpoint the tab-bar dot already uses, and diffing ids. 20s is a
// compromise between feeling live and not hammering a hub that may be
// reached over a DERP-relayed tunnel.
const POLL_MS = 20_000;

// Returns whether any unread notifications exist (for the tab-bar dot) and
// plays a chime + haptic whenever an unread id shows up that the previous
// poll hadn't seen. The first successful fetch only seeds the baseline, so
// opening the app with old unread items stays silent.
export function useNotificationAlerts(tunnelUrl: string | undefined, token: string | undefined) {
  const [hasUnread, setHasUnread] = useState(false);
  const seenIds = useRef<Set<number> | null>(null);
  const inFlight = useRef(false);

  const check = useCallback(() => {
    if (!tunnelUrl || !token || inFlight.current) return;
    inFlight.current = true;
    listUnreadNotifications(tunnelUrl, token)
      .then((fetched) => {
        // Messages in the thread the user is looking at right now are already
        // seen: clear them server-side and keep them out of the dot count and
        // the chime, so neither reacts to the conversation they're in.
        const active = getActiveConversation();
        const inActive = (n: (typeof fetched)[number]) =>
          active !== null && n.type === 'message' && n.ref_id === active;
        if (active !== null && fetched.some(inActive)) {
          markNotificationsForRef(tunnelUrl, token, active, 'message').catch(() => {});
        }
        const list = fetched.filter((n) => !inActive(n));

        setHasUnread(list.length > 0);
        const prev = seenIds.current;
        seenIds.current = new Set(list.map((n) => n.id));
        if (prev && list.some((n) => !prev.has(n.id))) playNotificationAlert();
      })
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
      });
  }, [tunnelUrl, token]);

  useEffect(() => {
    preloadAlertSounds();
  }, []);

  // Switching hub/account must not diff against the previous one's ids.
  useEffect(() => {
    seenIds.current = null;
  }, [tunnelUrl, token]);

  // Re-check whenever this screen regains focus (e.g. popping back from
  // /notifications), like every other stale-prone screen here.
  useFocusEffect(check);

  useEffect(() => onNotificationPing(check), [check]);

  // Foreground-only polling: stop when backgrounded, catch up on return.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(check, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        check();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [check]);

  return hasUnread;
}
