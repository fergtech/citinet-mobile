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
  token: string;
};
