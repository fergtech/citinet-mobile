export type RegistryHub = {
  id: string;
  name: string;
  slug: string;
  location: string;
  description?: string;
  tunnel_url: string;
  member_count?: number;
  online?: boolean;
};

export type LoginResponse = {
  token: string;
  userId: string;
  username: string;
  email: string | null;
  isAdmin: boolean;
  role: string;
  status: string;
  avatar_url: string | null;
  display_name: string;
  location: string | null;
  bio: string | null;
  tags: string[];
};

// Poll-only mechanics for a POLL-category HubPost — the post's title is its
// question, this carries everything else (options, votes, thresholds).
// Mirrors citinet web's HubPostPoll (types/hub.ts); request_id/request_problem
// (Initiatives linkage) are omitted since Initiatives isn't a mobile feature.
export type HubPostPoll = {
  options: string[];
  closes_at: string | null;
  closed: boolean;
  quorum_pct: number;
  pass_pct: number;
  vote_counts: number[];
  total_votes: number;
  member_count: number;
  my_vote: number | null;
  // null = quorum not met / still open; true = passed; false = failed
  passed: boolean | null;
};

export type HubPost = {
  id: string;
  category: 'ANNOUNCEMENT' | 'DISCUSSION' | 'EVENT' | 'POLL' | 'PROJECT' | 'REQUEST';
  title: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  visibility: string;
  author_id: string | null;
  author_username: string | null;
  media_file_name: string | null;
  like_count: number;
  my_liked: boolean;
  reply_count: number;
  event_date: string | null;
  event_location: string | null;
  // Real for every post (0/false when category !== 'EVENT'), backed by a
  // real hub_event_rsvps table — GET /api/posts, /api/posts/:id, and
  // /api/events/upcoming all include these, same shape as like_count/my_liked.
  rsvp_count: number;
  my_rsvp: boolean;
  // Present only when category === 'POLL'.
  poll?: HubPostPoll;
};

export type FeaturedItem = {
  id: string;
  type: 'post' | 'custom';
  ref_id: string | null;
  title: string;
  caption: string | null;
  category_label: string | null;
  image_url: string | null;
  media_file_name: string | null;
  display_order: number;
  created_at: string;
  author_id: string | null;
  author_username: string | null;
};

export type ConversationMember = {
  user_id: string;
  username: string;
  last_read_at: string | null;
};

export type HubMessage = {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  sender_username: string | null;
  body: string;
  created_at: string;
  attachments: unknown[];
  reactions: unknown[];
};

export type HubConversation = {
  conversation_id: string;
  kind: 'dm' | 'group';
  name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  members: ConversationMember[];
  last_message: HubMessage | null;
};

export type HubMember = {
  user_id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  location: string | null;
  is_admin: boolean;
  role: string | null;
  profile_headline: string | null;
  website: string | null;
  tags: string[];
  profile_visibility: 'public' | 'hub' | 'private';
  location_visible: boolean;
};

export type SearchPostResult = {
  id: string;
  title: string | null;
  body: string;
  category: HubPost['category'];
  author_username: string | null;
  score: number;
  event_date: string | null;
};

export type SearchMemberResult = {
  user_id: string;
  display_name: string | null;
  username: string;
  bio: string | null;
  score: number;
};

export type SearchSpaceResult = {
  id: string;
  name: string;
  member_count: number;
  score: number;
};

export type SearchResults = {
  posts: SearchPostResult[];
  members: SearchMemberResult[];
  spaces: SearchSpaceResult[];
};

// body_plain/body_rich are always the encrypted-at-rest copy (see
// lib/crypto/notes.ts) regardless of visibility — web_body_plain/web_body_rich
// are a separate plaintext copy the client sends only when is_web_public is
// true, mirroring citinet web, so a public note actually renders for viewers
// (including citinet's own web client) who don't hold this account's keys.
export type HubNote = {
  id: string;
  title: string;
  body_plain: string;
  body_rich: object | null;
  web_body_plain?: string | null;
  web_body_rich?: object | null;
  is_pinned: boolean;
  is_archived: boolean;
  is_public: boolean;
  is_web_public: boolean;
  // Admin/mod-only fourth tier, one step beyond is_web_public: flags the note
  // for a hub-server-side sync job (outside this app entirely — blog-sync.js
  // -> citinet-registry -> citinet-info's /blog Astro site) that publishes it
  // to citinet's public blog. That site only ever reads title/web_body_plain/
  // author/updated_at/color, so there's nothing extra to populate here.
  is_blog_published: boolean;
  owner_id: string;
  updated_at: string;
};

// Real citinet categories (src/app/types/atlas.ts) — not the "Alerts/Resources/
// Events/Landmarks" 4-category set from an earlier draft spec, which doesn't
// match the actual server's ATLAS_CATEGORIES allowlist or client type.
export type AtlasPinCategory = 'meetup' | 'safety' | 'avoid' | 'infrastructure' | 'poi' | 'aid' | 'green';

// Matches the server's real SELECT list exactly (GET/POST/PATCH /api/atlas/pins)
// — note there's no author_id in the response, only author_username, so
// "is this my pin" client-side checks compare against session.username. The
// server itself is still the real authority (PATCH/DELETE check author_id
// server-side); this is only a UI convenience for showing edit/delete controls.
export type AtlasPin = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  description: string | null;
  category: AtlasPinCategory;
  image_file_name: string | null;
  created_at: string;
  author_username: string | null;
};

// GET /api/posts/:id/rsvp's real SELECT (hub_event_rsvps joined with hub_users).
export type EventAttendee = {
  user_id: string;
  username: string;
  display_name: string | null;
  created_at: string;
};

export type HubPostReply = {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  author_username: string | null;
  reply_to_reply_id: string | null;
  reply_to_user_id: string | null;
  reply_to_username: string | null;
};

// Real citinet price-type enum (src/app/types/hub.ts HubListing['price_type'])
// — not the "For sale/Free/Services" 3-way split from an earlier draft spec.
// "Services" is actually a *category* (see MARKETPLACE_CATEGORIES below), not
// a price type; a service listing can itself be fixed/negotiable/hourly/etc.
export type ListingPriceType = 'fixed' | 'negotiable' | 'free' | 'hourly' | 'contact';

// Every listing belongs to a vendor page (hub_vendors) — the real server's
// POST /api/marketplace/listings 403s with "You need a vendor page to create
// listings" if the caller has none. There's no "individual seller" concept
// distinct from a vendor; a neighbor selling one used item still creates a
// (possibly minimal) vendor page first. Matches GET /api/marketplace/listings'
// real SELECT (joined with vendor name/logo).
export type MarketplaceListing = {
  id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_logo_file_name: string | null;
  title: string;
  description: string | null;
  price: number | null;
  price_type: ListingPriceType;
  category: string;
  image_file_name: string | null;
  condition: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
};

// Matches hub_vendors' real SELECT (GET /api/vendors, /api/vendors/me,
// /api/vendors/:id) — owner_user_id is the real authority for "is this my
// vendor page" checks (unlike AtlasPin, vendors DO expose an owner id).
export type MarketplaceVendor = {
  id: string;
  owner_user_id: string;
  slug?: string;
  name: string;
  description: string | null;
  category: string;
  logo_file_name: string | null;
  banner_mode?: 'image' | 'solid' | 'gradient' | null;
  banner_image_file_name?: string | null;
  banner_color?: string | null;
  banner_gradient_from?: string | null;
  banner_gradient_to?: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  hours: string | null;
  web_public?: boolean;
  created_at: string;
  updated_at?: string;
  // Only present on GET /api/vendors (server computes it via a join); absent
  // on /api/vendors/me and /api/vendors/:id.
  listing_count?: number;
};

// hub_config-backed, admin-only to write (PATCH /api/marketplace-config
// 403s for non-admins server-side) — the marketplace-wide hero banner, not
// to be confused with a vendor's own banner_mode/color/gradient fields above.
export type MarketplaceBannerConfig = {
  marketplace_banner_image?: string;
  marketplace_banner_position?: string;
  marketplace_banner_title?: string;
  marketplace_banner_subtitle?: string;
};

// Icon/color/label bucket derived client-side from mime_type + extension
// (see lib/files/kind.ts) — the real hub_files table has no kind/category
// column of its own, same as citinet web's own FilesScreen, which does the
// same derivation.
export type FileKind = 'pdf' | 'doc' | 'sheet' | 'slides' | 'image' | 'video' | 'audio' | 'zip' | 'other';

// Matches GET/POST /api/files' real SELECT/RETURNING lists exactly
// (confirmed directly against api/server.js's hub_files table and routes).
// Two real gaps vs. the original pasted spec, both confirmed from the live
// server rather than assumed: there is no description/metadata column at
// all (so this app doesn't show or collect one — search only matches file
// name + uploader), and visibility is two independent booleans, not a
// single enum — is_public (visible to any hub member) / web_public (anyone
// with the share link, no account). private = both false.
export type HubFile = {
  file_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  owner_id: string;
  is_public: boolean;
  web_public: boolean;
  uploaded_at: string;
};

// The three-tier shape this app already uses for Notes (is_public/
// is_web_public) — PATCH /api/files/:filename takes this exact field name
// and derives is_public/web_public server-side itself.
export type FileVisibility = 'private' | 'hub' | 'web';
