import type { Href } from 'expo-router';

import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Brand } from '@/constants/theme';
import { HubNotification, NotificationType } from '@/lib/api/types';

// Same icon-tile-with-colored-background convention as every other list row
// in this app (Home's atlasLatestIcon, Discover's hubIcon, etc.) — colors
// are just visually distinct per type, not meaningful beyond that.
const NOTIFICATION_ICON: Record<NotificationType, { icon: IconSymbolName; color: string }> = {
  message: { icon: 'paperplane.fill', color: Brand },
  reply: { icon: 'message.fill', color: '#7c3aed' },
  space_invite: { icon: 'building.2.fill', color: '#0d9488' },
  initiative_invite: { icon: 'target', color: '#d97706' },
  join_request: { icon: 'person.badge.plus', color: '#dc2626' },
  account_approved: { icon: 'checkmark.circle.fill', color: '#059669' },
};

export function notificationIcon(type: NotificationType): { icon: IconSymbolName; color: string } {
  return NOTIFICATION_ICON[type] ?? { icon: 'bell.fill', color: Brand };
}

// Copy mirrors api/server.js's own emailCopyForNotification (same 6 types,
// same substance) but trimmed for a compact list row — that function's
// output is a full email subject+line, this is a title + optional subtitle.
// Subtitle is genuinely optional: omitted wherever showing one would need an
// extra per-row fetch (the space/initiative/post's own name/title isn't on
// the notification row itself, only its id) rather than faked.
export function notificationCopy(n: HubNotification, hubName: string): { title: string; subtitle?: string } {
  const actor = n.actor_username ? `@${n.actor_username}` : 'Someone';
  switch (n.type) {
    case 'message':
      return { title: `${actor} sent you a message` };
    case 'reply':
      return { title: `${actor} replied to your post` };
    case 'space_invite':
      return { title: `${actor} invited you to a Space` };
    case 'initiative_invite':
      return { title: `${actor} invited you to a project` };
    case 'join_request':
      return { title: `${actor} wants to join ${hubName}`, subtitle: 'Review in Hub Management → Members' };
    case 'account_approved':
      return { title: `You're in — welcome to ${hubName}`, subtitle: 'You can log in and use the hub now.' };
    default:
      // hub_notifications.type is a plain VARCHAR(50), not a DB-enforced
      // enum — a value outside the 6 this app knows about is a real
      // possibility, not just a type-checker formality. Never crash on it.
      return { title: 'New notification' };
  }
}

// null means "nothing to navigate to" — tapping the row still dismisses it
// (see app/notifications.tsx), it just doesn't push a route.
export function notificationHref(n: HubNotification): Href | null {
  switch (n.type) {
    case 'message':
      // title/peerId are optional on app/conversation/[id].tsx (both
      // rendered with a `?? fallback` there) — fine to omit rather than
      // fetch the conversation just to know its display name.
      return n.ref_id ? ({ pathname: '/conversation/[id]', params: { id: n.ref_id } } as Href) : null;
    case 'reply':
      return n.ref_id ? ({ pathname: '/post/[id]', params: { id: n.ref_id } } as Href) : null;
    case 'space_invite':
      // ref_id is the space's slug, not an id — see HubNotification's own note.
      return n.ref_id ? ({ pathname: '/spaces/[slug]', params: { slug: n.ref_id } } as Href) : null;
    case 'initiative_invite':
      return n.ref_id ? ({ pathname: '/initiatives/[id]', params: { id: n.ref_id } } as Href) : null;
    case 'join_request':
      // ref_id is the requesting user's own id, not a screen this app has —
      // routes to the real place to act on it instead (matches the email
      // copy's own "Approve or decline it from Hub Management → Members").
      return '/admin/pending' as Href;
    case 'account_approved':
    default:
      return null;
  }
}
