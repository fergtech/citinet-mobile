export type HubSummary = {
  id: string;
  slug: string;
  name: string;
  tunnelUrl: string;
  // Optional: sessions persisted before this field existed won't have it.
  // Used to geocode a stable "hub center" for Atlas distance calculations,
  // matching citinet web's own hubGeoCenter (a fixed point, not live per-user
  // GPS — see lib/atlas/geocoding.ts).
  location?: string;
};

export type StoredSession = {
  hub: HubSummary;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  // 'member' | 'moderator' | 'admin' — optional for the same reason as
  // HubSummary.location above: sessions persisted before this field existed
  // won't have it. See lib/session/is-mod.ts for the isAdmin-or-role-based
  // "can moderate" check used to gate admin UI; a missing role safely reads
  // as "not a mod" rather than throwing.
  role?: string;
  token: string;
};

// What login/register returns for an account that isn't approved yet — kept
// in memory only (not persisted; see session-context.tsx), just enough to
// poll GET /api/auth/session-status and, once approved, build a real
// StoredSession without asking the user to log in again.
export type PendingAccount = {
  hub: HubSummary;
  token: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  role?: string;
  accountStatus: 'pending' | 'rejected';
};
