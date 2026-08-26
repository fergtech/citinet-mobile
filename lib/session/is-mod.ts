import type { StoredSession } from '@/lib/session/types';

/** True for admins and moderators — gates admin-only UI, mirrors the server's own isMod(). */
export function isMod(session: StoredSession): boolean {
  return session.isAdmin || session.role === 'moderator' || session.role === 'admin';
}
