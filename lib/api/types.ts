// Admin-customizable hub identity, synced from a hub's own settings into the
// public registry (see citinet web's hubIconRegistryFields) — mirrored here so
// the hub directory/login flow can render the same custom icon the web portal
// does, before ever talking to the hub itself. `hub_icon_mode: 'image'` means
// a real uploaded file (hub_icon_image_file_name, served from the hub's own
// tunnel_url); any other value (or these fields being absent entirely, for a
// hub whose admin never touched the customizer) falls back to the
// symbol+color badge — see components/hub-icon.tsx.
export type HubIconFields = {
  hub_icon_mode?: string;
  hub_icon_symbol?: string;
  hub_icon_bg_mode?: string;
  hub_icon_gradient_from?: string;
  hub_icon_gradient_to?: string;
  hub_icon_solid_color?: string;
  hub_icon_image_file_name?: string;
};

export type RegistryHub = HubIconFields & {
  id: string;
  name: string;
  slug: string;
  location: string;
  description?: string;
  tunnel_url: string;
  member_count?: number;
  online?: boolean;
  /** Heartbeat signal (GET /api/status) — how many members are active right
   * now, distinct from member_count's all-time total. Populated live for
   * mDNS-discovered "Nearby" hubs; absent for registry-sourced entries. */
  online_now?: number;
  /** Human-readable uptime string from GET /api/status (e.g. "2d 4h"). */
  uptime?: string;
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

// Matches POST /api/messages/:id/reactions' response and GET .../messages'
// own per-message reactionsAgg subquery (both confirmed against
// api/server.js) — one row per distinct emoji on a message, pre-aggregated
// server-side, not one row per individual reaction.
export type MessageReaction = {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
};

export type HubMessage = {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  sender_username: string | null;
  body: string;
  created_at: string;
  attachments: unknown[];
  reactions: MessageReaction[];
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

// ── Comms (calls, broadcasts, rooms) ────────────────────────────────
// Matches api/comms.js's real routes/shapes directly — LiveKit's own room
// list is the source of truth for "what's live now" (no separate table),
// hub_call_events is the one thing that's actually persisted.
export type CallMode = 'audio' | 'video';
export type CallOutcome = 'ringing' | 'connected' | 'declined' | 'not_answered';

// POST /api/comms/call/ring's response — caller's own token to join/publish
// immediately, before the callee has answered.
export type RingResponse = {
  call_id: string;
  room_name: string;
  token: string;
  livekit_url: string;
};

// POST /api/comms/call/:id/answer's response.
export type AnswerResponse = {
  room_name: string;
  mode: CallMode;
  token: string;
  livekit_url: string;
};

// The WS payload pushed to a callee the moment someone rings them (see
// lib/comms/socket.ts) — same shape server-side, in api/comms.js's sendTo().
export type IncomingCallPayload = {
  type: 'incoming_call';
  call_id: string;
  conversation_id: string;
  room_name: string;
  mode: CallMode;
  from_id: string;
  from_username: string;
};

// GET /api/conversations/:id/call-events — history for the transcript's
// "Video call · 1:12" chip.
export type CallEvent = {
  id: string;
  mode: CallMode;
  outcome: CallOutcome;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  caller_id: string;
  callee_id: string;
};

// GET /api/comms/live — one entry per active broadcast/room, read back from
// LiveKit room metadata (see POST /api/comms/token's own metadata write).
export type LiveCommsItem = {
  kind: 'broadcast' | 'room';
  room_name: string;
  title: string;
  host_id: string;
  host_username: string;
  participant_count: number;
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

// The real GET /api/search spaces SQL selects a lot more than this (slug,
// description, visibility, banner fields, my_role/my_status) via `...r` —
// only slug is added here, the minimum needed to navigate a result to
// app/spaces/[slug].tsx now that it exists. Was previously a dead-end
// non-interactive row in Discover's search results for exactly that reason.
export type SearchSpaceResult = {
  id: string;
  slug: string;
  name: string;
  member_count: number;
  score: number;
};

// ── Spaces ────────────────────────────────────────────────────────
// Confirmed directly against api/server.js's real hub_spaces/hub_space_members
// SQL (the POST/GET/PATCH/join/leave/members/posts/files routes under
// /api/spaces), not guessed from the design handoff. A few things worth
// flagging for callers:
// - visibility 'invite-only' exists on the server (POST .../join 403s for it
//   unless already invited) but has no dedicated UI treatment specified yet
//   — spaceVisibilityMeta falls back to 'private' styling for it.
// - my_role/my_status are null (not 'member'/undefined) when the caller has
//   never interacted with the space at all — a LEFT JOIN, not a default.
// - member_count comes back as a numeric STRING, not a number: every one of
//   these SELECTs does `COUNT(DISTINCT ...) AS member_count` with no ::int
//   cast (unlike open_roles_count elsewhere in this codebase, which does
//   cast), and node-pg parses bigint/count aggregates as strings by default.
//   Confirmed against api/server.js directly, not assumed — Number(...) it
//   before use.
export type SpaceVisibility = 'public' | 'private' | 'invite-only';
export type SpaceBannerMode = 'image' | 'solid' | 'gradient' | null;
export type SpaceMemberRole = 'owner' | 'admin' | 'moderator' | 'member';
export type SpaceMemberStatus = 'active' | 'pending' | 'invited';

export type Space = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: SpaceVisibility;
  created_by: string;
  created_at: string;
  updated_at: string;
  banner_mode: SpaceBannerMode;
  banner_color: string | null;
  banner_gradient_from: string | null;
  banner_gradient_to: string | null;
  banner_image_file_name: string | null;
  // Present on GET (list/mine/detail) responses; absent from the bare POST
  // create response — optional rather than assumed present everywhere.
  web_public?: boolean;
  member_count: string;
  // Unlike member_count, this one *is* ::int-cast in SQL (added alongside
  // this type, so it started right) — a real number, not a string. Exists
  // so the space detail screen's "N posts" meta stat can show for a public
  // space the viewer hasn't joined yet, since GET .../posts itself 403s for
  // non-members.
  post_count: number;
  my_role: SpaceMemberRole | null;
  my_status: SpaceMemberStatus | null;
};

// Matches GET /api/spaces/:slug/members' real SELECT — active AND pending
// (and invited) rows come back in one list; filter by `status` client-side
// for anything that needs just the active roster.
export type SpaceMember = {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_headline: string | null;
  role: SpaceMemberRole;
  status: SpaceMemberStatus;
  joined_at: string;
};

// Matches GET /api/spaces/:slug/files' real SELECT — note the bare `id`
// (not `file_id`, unlike HubFile elsewhere in this app) since that route
// aliases f.id directly with no rename.
export type SpaceFile = {
  id: string;
  file_name: string;
  file_key: string;
  mime_type: string | null;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by: string | null;
  post_id: string | null;
  post_title: string | null;
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
  // Folder this file lives in — null/undefined means the dashboard root.
  folder_id?: string | null;
};

// The three-tier shape this app already uses for Notes (is_public/
// is_web_public) — PATCH /api/files/:filename takes this exact field name
// and derives is_public/web_public server-side itself.
export type FileVisibility = 'private' | 'hub' | 'web';

// A folder in the Files dashboard's folder hierarchy. Matches GET/POST
// /api/folders' real SELECT/RETURNING lists (hub_folders table) — folders
// are hub-wide (visible to every member), one level of drill-down today via
// parent_folder_id, with deeper nesting already supported server-side.
export type HubFolder = {
  id: string;
  name: string;
  color: string;
  parent_folder_id: string | null;
  owner_id?: string;
  file_count: number;
  created_at?: string;
  updated_at?: string;
};

// ── Initiatives ──────────────────────────────────────────────────────
// Field shapes below started as inferences from the mobile design handoff
// (design_handoff_initiatives/README.md — a port spec for citinet web's
// already-built InitiativesScreen/initiativesService), then a real GET
// /api/initiatives/:id response captured live from a hub (2026-08-25). As of
// 2026-08-26, the task-meta/checklist/notes/resources/roles shapes below are
// also confirmed — read directly against citinet-web's api/server.js routes
// and its own src/app/services/initiativesService.ts, the client already
// exercising them (not everything in that repo is itself bug-free — see
// hubService.ts's per-route notes — but the request/response *shapes* used
// here are read straight from server.js's SQL, not guessed).
//
// Real shape vs. the original guess, for the record:
// - No member_count/task_count/tasks_done_count/organizer_id/organizer_username
//   /latest_update/joined fields exist — derive those from the embedded
//   tasks/members/updates arrays and viewerIsMember/viewerIsCreator/created_by
//   instead (see lib/initiatives/meta.ts's deriveInitiativeStats).
// - `category` is a lowercase free-form string ("infrastructure"), not the
//   capitalized four-value enum assumed before.
// - `color` is a real field — a named color ("blue"), independent of
//   category, not something derived from it.
// - Task status is `'todo' | 'in-progress' | 'done'` (hyphenated), not the
//   four-value not_started/in_progress/blocked/complete set assumed before.
//   `blocked` is real, but lives on TaskMeta (hub_initiative_task_meta), not
//   on the task itself — see TaskMeta below.
// - Same banner_mode/banner_color/banner_gradient_from/banner_gradient_to/
//   banner_image_file_name shape as MarketplaceVendor's banner, not the
//   generic category-color gradient the design handoff described.
export type InitiativeTaskStatus = 'todo' | 'in-progress' | 'done';

// Embedded in GET /api/initiatives/:id's `tasks` array — confirmed shape.
// There is no separate "get one task" or "list tasks" endpoint on the real
// server (no `/api/initiatives/:id/tasks` route exists at all) — a task's
// fuller detail is this summary plus its TaskMeta row (assignee/due-date/
// blocked/checklist counts), checklist, and notes, each fetched separately.
export type InitiativeTaskSummary = {
  id: string;
  title: string;
  status: InitiativeTaskStatus;
  created_by: string;
};

// Embedded in GET /api/initiatives/:id's `members` array — confirmed shape.
// `role` is a free-text label ("Project lead", "Member"), not a link to an
// InitiativeRole record — that's a separate open/filled volunteer-role
// system (see InitiativeRole below), unrelated to this field.
export type InitiativeMemberSummary = {
  id: string;
  name: string;
  role: string | null;
  joinedAt: string;
};

// Shape unconfirmed — the sample response's `updates` array was empty, so
// nothing here is verified. Kept loose/optional on purpose; read
// defensively (see lib/initiatives/meta.ts) rather than trusting any of
// these fields to be present.
export type InitiativeUpdate = {
  id: string;
  body?: string;
  text?: string;
  author_id?: string | null;
  author_username?: string | null;
  createdBy?: string | null;
  created_at?: string;
  createdAt?: string;
  reply_count?: number;
};

export type InitiativeBannerMode = 'image' | 'solid' | 'gradient' | null;

// Confirmed against a live GET /api/initiatives/:id response — see the note
// above for exactly how this differs from the original design-handoff guess.
export type Initiative = {
  id: string;
  initiative_id: string;
  title: string;
  goal: string;
  description: string | null;
  category: string;
  status: string;
  color: string;
  progress: number;
  space_id: string | null;
  space_slug: string | null;
  space_name: string | null;
  created_by: string;
  createdBy: string;
  created_at: string;
  createdAt: string;
  updated_at: string;
  viewerIsMember: boolean;
  viewerIsCreator: boolean;
  open_roles_count: number;
  banner_mode: InitiativeBannerMode;
  banner_color: string | null;
  banner_gradient_from: string | null;
  banner_gradient_to: string | null;
  banner_image_file_name: string | null;
  tasks: InitiativeTaskSummary[];
  members: InitiativeMemberSummary[];
  updates: InitiativeUpdate[];
};

// The viewer's own row must read "You" as soon as they hold a named role —
// derive that client-side by comparing user_id to session.userId (same
// pattern this app already uses for AtlasPin/goToProfile), not by trusting a
// server-provided flag, per the handoff's explicit note that this was a real
// bug in the prototype.
export type InitiativeTeamMember = {
  user_id: string;
  username: string;
  display_name: string | null;
  role: string | null;
  task_count: number;
  tasks_done_count: number;
};

// Confirmed against api/server.js's real hub_initiative_roles row (RETURNING *
// off the POST /:id/roles insert) — `name`/`skills`/`holder_*` from the
// original design-handoff guess don't exist on the live table at all.
export type InitiativeRole = {
  id: string;
  initiative_id: string;
  role: string;
  skill: string | null;
  filled: boolean;
  filled_by_user_id: string | null;
  filled_by_name: string | null;
  created_by: string | null;
  created_at: string;
};

// There is no standalone "get one task" endpoint on the real server — a task
// is always either the embedded InitiativeTaskSummary (from GET
// /api/initiatives/:id) or, for the fuller detail view, that summary plus
// this initiative-wide meta row (GET /api/initiatives/:id/task-meta returns
// `{ taskMeta: TaskMeta[] }`, one entry per task that has either an
// assignee/due-date or a checklist item — a task with neither has no row at
// all, not a row with nulls). Confirmed against hub_initiative_task_meta +
// the checklist COUNT join in that route.
export type TaskMeta = {
  task_id: string;
  initiative_id: string;
  assignee_user_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  blocked: boolean;
  checklist_total: number;
  checklist_done: number;
};

// Matches hub_initiative_task_checklist's real columns (RETURNING * off every
// insert/update route) — the field is `text`, not `label` as originally
// guessed.
export type ChecklistItem = {
  id: string;
  task_id: string;
  initiative_id: string;
  text: string;
  done: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// Matches hub_initiative_task_note_replies' real columns — `content`, not
// `body`; `author_name`, not `author_username` (the server writes the acting
// username straight into author_name, there's no separate display-name join).
export type TaskNoteReply = {
  id: string;
  note_id: string;
  author_id: string | null;
  author_name: string;
  content: string;
  created_at: string;
};

// Matches hub_initiative_task_notes' real columns, same content/author_name
// correction as TaskNoteReply above.
export type TaskNote = {
  id: string;
  task_id: string;
  initiative_id: string;
  author_id: string | null;
  author_name: string;
  content: string;
  created_at: string;
  replies: TaskNoteReply[];
};

export type InitiativeResourceKind = 'material' | 'file' | 'link';

// Confirmed against hub_initiative_resources' real columns (api/server.js) —
// the original guess's name/quantity_note/provider_*/file_name/link_* fields
// don't exist. A material's label lives in `item` (also doubles as a link's
// display label — POST .../resources falls back to the raw url when no item
// is given); its pledge is the single `provided` boolean +
// `provided_by_user_id`/`provided_by_name`. `file_display_name`/
// `file_mime_type`/`file_size_bytes` are only present on the LEFT JOIN in
// GET .../resources, not on the bare row a provide/unprovide PATCH returns.
export type InitiativeResource = {
  id: string;
  initiative_id: string;
  kind: InitiativeResourceKind;
  item: string;
  qty: string | null;
  provided: boolean;
  provided_by_user_id: string | null;
  provided_by_name: string | null;
  created_by: string | null;
  file_id: string | null;
  file_display_name: string | null;
  file_mime_type: string | null;
  file_size_bytes: number | null;
  url: string | null;
  created_at: string;
  updated_at: string;
};

// kind is really a closed set ('task' | 'resource' | 'team' | 'update' |
// 'member' — see hub_initiative_activity's CHECK constraint in api/server.js)
// but only 'task'/'resource'/'team' are actually ever inserted today
// ('update' — a general wall post — and 'member' aren't emitted by any real
// route yet); kept loose as `string` rather than narrowed, so a future kind
// doesn't silently fail to type-check here.
// actor_username was a guess that didn't match the live column — the real
// table (and every INSERT into it) uses actor_name, confirmed directly
// against api/server.js's CREATE TABLE hub_initiative_activity.
export type InitiativeActivityEntry = {
  id: string;
  initiative_id: string;
  kind: string;
  actor_name: string | null;
  text: string;
  created_at: string;
};

// ── Notifications ────────────────────────────────────────────────────
// Matches GET /api/notifications/unread's real SELECT (hub_notifications
// joined to hub_users for actor_username) — confirmed against api/server.js,
// not guessed. `id` is a plain SERIAL (int4), not the bigint/COUNT string
// footgun noted elsewhere in this file for space member_count — safe as a
// real number here.
//
// Only 6 types are ever actually inserted anywhere in the server (every
// notifyUser(...) call site) — kept as a union rather than widened to
// `string`, since a 7th appearing would mean a real server change worth
// knowing about at compile time, not something to quietly swallow:
//   - message: ref_id = conversation id
//   - reply: ref_id = post id
//   - space_invite: ref_id = the space's SLUG, not its id
//   - initiative_invite: ref_id = initiative id
//   - join_request: ref_id = the requesting user's own id (an admin-facing
//     notice, not something the requester sees)
//   - account_approved: ref_id is always null — there's no single "item" to
//     deep-link to, see lib/notifications/meta.ts's own handling of this.
// citinet-web's own FEATURE_TYPES only wires 3 of these 6 into a per-icon
// badge dot (feed/messages/hub_management) — the other 3 are otherwise only
// ever surfaced by email. The mobile notifications screen is what actually
// surfaces all 6 in one place.
export type NotificationType = 'message' | 'reply' | 'space_invite' | 'initiative_invite' | 'account_approved' | 'join_request';

export type HubNotification = {
  id: number;
  type: NotificationType;
  actor_id: string | null;
  actor_username: string | null;
  ref_id: string | null;
  created_at: string;
};

// ── Trust & safety ──────────────────────────────────────────────────
export type ReportTargetType = 'post' | 'reply' | 'message' | 'listing' | 'member';
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'scam' | 'other';

export type BlockedMember = {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type PendingUser = {
  user_id: string;
  username: string;
  email: string | null;
  created_at: string;
};

export type MemberRole = 'member' | 'moderator' | 'admin';

export type ReportEntry = {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  details: string | null;
  status: 'open' | 'reviewed' | 'dismissed';
  created_at: string;
  reviewed_at: string | null;
  reporter_id: string | null;
  reporter_username: string | null;
  reviewed_by_username: string | null;
};

export type ModLogEntry = {
  id: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_avatar_url: string | null;
};
