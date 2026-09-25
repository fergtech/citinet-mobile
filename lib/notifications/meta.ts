import type { Href } from 'expo-router';

import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Brand } from '@/constants/theme';
import { HubNotification, NotificationType } from '@/lib/api/types';

// Same icon-tile-with-colored-background convention as every other list row
// in this app (Home's atlasLatestIcon, Discover's hubIcon, etc.) — colors
// are just visually distinct per type, not meaningful beyond that.
const NOTIFICATION_ICON: Record<NotificationType, { icon: IconSymbolName; color: string }> = {
  message: { icon: 'paperplane.fill', color: Brand },
  message_reaction: { icon: 'face.smiling', color: '#d97706' },
  reply: { icon: 'message.fill', color: '#7c3aed' },
  like: { icon: 'heart.fill', color: '#e11d48' },
  pin_reply: { icon: 'mappin.and.ellipse', color: '#0891b2' },
  note_reply: { icon: 'message.fill', color: '#7c3aed' },
  update_comment: { icon: 'message.fill', color: '#7c3aed' },
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
// extra per-row fetch (the club/initiative/post's own name/title isn't on
// the notification row itself, only its id) rather than faked.
//
// `count` is for app/notifications.tsx's own grouping — several notifications
// for the same conversation/post collapse into one row, and `n` there is
// just the newest of the group (so its actor_username is whichever member
// sent last, not necessarily every message's sender in a group DM — an
// accepted edge case; the overwhelmingly common case is a 1:1 DM, where
// every grouped message really is from the same person).
export function notificationCopy(n: HubNotification, hubName: string, count = 1): { title: string; subtitle?: string } {
  const actor = n.actor_username ? `@${n.actor_username}` : 'Someone';
  switch (n.type) {
    case 'message':
      return { title: count > 1 ? `${actor} sent you ${count} messages` : `${actor} sent you a message` };
    case 'message_reaction':
      return { title: count > 1 ? `${actor} reacted to ${count} of your messages` : `${actor} reacted to your message` };
    case 'reply':
      return { title: count > 1 ? `${actor} replied to your post ${count} times` : `${actor} replied to your post` };
    case 'like':
      // Unlike message/reply groups (almost always the same person, just
      // several times), a like group is one row per *post*, so its members
      // are typically several different people — "X and N others," not
      // "X liked it N times."
      return { title: count > 1 ? `${actor} and ${count - 1} other${count - 1 === 1 ? '' : 's'} liked your post` : `${actor} liked your post` };
    case 'pin_reply':
      return { title: count > 1 ? `${actor} commented on your pin ${count} times` : `${actor} commented on your pin` };
    case 'note_reply':
      return { title: count > 1 ? `${actor} replied to your note ${count} times` : `${actor} replied to your note` };
    case 'update_comment':
      return { title: count > 1 ? `${actor} commented on your update ${count} times` : `${actor} commented on your update` };
    case 'space_invite':
      return { title: `${actor} invited you to a Club` };
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
    case 'message_reaction':
      // ref_id is the conversation id too — see HubNotification's own note.
      return n.ref_id ? ({ pathname: '/conversation/[id]', params: { id: n.ref_id } } as Href) : null;
    case 'reply':
    case 'like':
      return n.ref_id ? ({ pathname: '/post/[id]', params: { id: n.ref_id } } as Href) : null;
    case 'pin_reply':
      return n.ref_id ? ({ pathname: '/atlas/[id]', params: { id: n.ref_id } } as Href) : null;
    case 'note_reply':
    case 'update_comment':
      // ref_id is the initiative id, not the specific note/update — see
      // HubNotification's own note on why (no mobile route takes just a
      // note/task/update id on its own).
      return n.ref_id ? ({ pathname: '/initiatives/[id]', params: { id: n.ref_id } } as Href) : null;
    case 'space_invite':
      // ref_id is the club's slug, not an id — see HubNotification's own note.
      return n.ref_id ? ({ pathname: '/clubs/[slug]', params: { slug: n.ref_id } } as Href) : null;
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
