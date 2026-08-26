import { AtlasPin, AtlasPinCategory, ChecklistItem, EventAttendee, FeaturedItem, FileVisibility, HubConversation, HubFile, HubMember, HubMessage, HubNote, HubPost, HubPostReply, Initiative, InitiativeActivityEntry, InitiativeResource, InitiativeRole, InitiativeTaskSummary, InitiativeTeamMember, ListingPriceType, LoginResponse, MarketplaceBannerConfig, MarketplaceListing, MarketplaceVendor, SearchResults, TaskMeta, TaskNote, TaskNoteReply } from './types';

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string') return body.error;
  } catch {
    // response wasn't JSON — fall through to the generic message
  }
  return fallback;
}

export async function loginUser(
  tunnelUrl: string,
  username: string,
  password: string
): Promise<LoginResponse> {
  let res: Response;
  try {
    res = await fetch(`${tunnelUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error("Couldn't reach this hub. Check that it's online and try again.");
  }
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Login failed. Check your username and password.'));
  }
  return res.json();
}

export type HubInfo = {
  hub_name: string;
  hub_slug: string;
  member_count: number;
  location: string;
  description: string;
};

/**
 * Unauthenticated probe against a hub's real GET /api/info — confirms a
 * given address is actually a reachable Citinet hub (not just "something
 * answered") and returns its real name/slug (DB-config-aware, not a guess
 * from the URL). Used to validate a manually-entered local address before
 * letting the user continue, and to confirm/enrich an mDNS-discovered
 * result before listing it as connectable.
 */
export async function getHubInfo(tunnelUrl: string): Promise<HubInfo> {
  let res: Response;
  try {
    res = await fetch(`${tunnelUrl}/api/info`);
  } catch {
    throw new Error("Couldn't reach a hub at that address. Check it's correct and try again.");
  }
  if (!res.ok) {
    throw new Error("That doesn't look like a Citinet hub.");
  }
  return res.json();
}

export type HubStatus = {
  online: boolean;
  uptime: string;
  user_count: number;
  online_now: number;
  node_name: string;
};

/**
 * Unauthenticated probe against GET /api/status — the hub's live "heartbeat"
 * (uptime, currently-active member count), separate from getHubInfo()'s
 * mostly-static identity data since this is meant to be re-polled
 * periodically while a hub is visible on screen, not fetched once.
 */
export async function getHubStatus(tunnelUrl: string): Promise<HubStatus> {
  const res = await fetch(`${tunnelUrl}/api/status`);
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json();
}

export async function getPosts(tunnelUrl: string, token: string): Promise<HubPost[]> {
  const res = await fetch(`${tunnelUrl}/api/posts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load posts for this hub."));
  }
  const data = await res.json();
  return Array.isArray(data.posts) ? data.posts : [];
}

export async function getUpcomingEvents(tunnelUrl: string, token: string): Promise<HubPost[]> {
  const res = await fetch(`${tunnelUrl}/api/events/upcoming`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load upcoming events."));
  }
  const data = await res.json();
  return Array.isArray(data.events) ? data.events : [];
}

// Every EVENT post, not just upcoming ones — GET /api/events/upcoming only
// ever returns future events (WHERE event_date >= NOW() - 2h, confirmed in
// api/server.js), and there's no separate "past events" or "all events"
// route. GET /api/posts does support a real ?category= filter though, so
// this is the only way to see a past event again once its date has gone by
// — app/events.tsx uses it to derive "Past" by excluding whatever
// getUpcomingEvents() already returned, rather than reimplementing the
// server's own upcoming/past boundary (including its 2-hour grace window)
// client-side.
export async function listEventPosts(tunnelUrl: string, token: string): Promise<HubPost[]> {
  const res = await fetch(`${tunnelUrl}/api/posts?category=EVENT&limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load events."));
  }
  const data = await res.json();
  return Array.isArray(data.posts) ? data.posts : [];
}

export type CreatePostInput = {
  category: HubPost['category'];
  title?: string;
  body?: string;
  // Required by the real server when category is 'EVENT' — an ISO string.
  event_date?: string;
  event_location?: string;
  visibility?: 'inherit' | 'hub' | 'private';
  media?: { uri: string; name: string; type: string } | null;
};

// POST /api/posts — the app's first real post-creation call (everything
// else under app/modal.tsx/compose-post.tsx is still a UI mockup). Unlike
// every other POST in this file, the real route is multer-based
// (`upload.single('media')`), so it only ever parses a multipart body, never
// JSON — even when there's no photo attached, this has to be sent as
// FormData or the server sees an empty req.body and 400s on "add a title or
// some text." Response shape is hand-assembled server-side and is missing
// like_count/my_liked (a freshly created post can't have either yet), so
// those are defaulted here to keep the return value a real HubPost.
export async function createPost(tunnelUrl: string, token: string, input: CreatePostInput): Promise<HubPost> {
  const form = new FormData();
  form.append('category', input.category);
  if (input.title) form.append('title', input.title);
  if (input.body) form.append('body', input.body);
  if (input.event_date) form.append('event_date', input.event_date);
  if (input.event_location) form.append('event_location', input.event_location);
  if (input.visibility) form.append('visibility', input.visibility);
  if (input.media) {
    form.append('media', { uri: input.media.uri, name: input.media.name, type: input.media.type } as unknown as Blob);
  }

  const res = await fetch(`${tunnelUrl}/api/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't create that post."));
  }
  const post = await res.json();
  return { like_count: 0, my_liked: false, rsvp_count: 0, my_rsvp: false, ...post };
}

// Featured content is a supplementary highlight, not core feed data — mirrors
// citinet's own web client here: fail quietly to an empty list rather than
// surfacing an error banner over the main feed.
export async function getFeatured(tunnelUrl: string, token: string): Promise<FeaturedItem[]> {
  try {
    const res = await fetch(`${tunnelUrl}/api/featured`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

export async function getPost(tunnelUrl: string, token: string, postId: string): Promise<HubPost> {
  const res = await fetch(`${tunnelUrl}/api/posts/${encodeURIComponent(postId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load this post."));
  }
  return res.json();
}

export async function listReplies(
  tunnelUrl: string,
  token: string,
  postId: string
): Promise<HubPostReply[]> {
  const res = await fetch(`${tunnelUrl}/api/posts/${encodeURIComponent(postId)}/replies`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load comments."));
  }
  const data = await res.json();
  return Array.isArray(data.replies) ? data.replies : [];
}

export async function createReply(
  tunnelUrl: string,
  token: string,
  postId: string,
  body: string,
  replyToReplyId: string | null = null,
  replyToUserId: string | null = null
): Promise<HubPostReply> {
  const res = await fetch(`${tunnelUrl}/api/posts/${encodeURIComponent(postId)}/replies`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body,
      reply_to_reply_id: replyToReplyId,
      reply_to_user_id: replyToUserId,
    }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't post your reply."));
  }
  return res.json();
}

export async function toggleLike(
  tunnelUrl: string,
  token: string,
  postId: string
): Promise<{ liked: boolean; count: number }> {
  const res = await fetch(`${tunnelUrl}/api/posts/${encodeURIComponent(postId)}/like`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't update like."));
  }
  return res.json();
}

// Cast (or change) a vote on a POLL-category post.
export async function votePoll(
  tunnelUrl: string,
  token: string,
  postId: string,
  optionIndex: number
): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/posts/${encodeURIComponent(postId)}/vote`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ option_index: optionIndex }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't cast your vote."));
  }
}

// Toggle the caller's RSVP ("going") on an EVENT-category post — same
// toggle-and-return-the-new-state shape as toggleLike above.
export async function toggleRsvp(
  tunnelUrl: string,
  token: string,
  postId: string
): Promise<{ going: boolean; count: number }> {
  const res = await fetch(`${tunnelUrl}/api/posts/${encodeURIComponent(postId)}/rsvp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't update your RSVP."));
  }
  return res.json();
}

export async function listAttendees(tunnelUrl: string, token: string, postId: string): Promise<EventAttendee[]> {
  const res = await fetch(`${tunnelUrl}/api/posts/${encodeURIComponent(postId)}/rsvp`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load attendees."));
  }
  const data = await res.json();
  return Array.isArray(data.attendees) ? data.attendees : [];
}

export async function listConversations(tunnelUrl: string, token: string): Promise<HubConversation[]> {
  const res = await fetch(`${tunnelUrl}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load messages."));
  }
  const data = await res.json();
  return Array.isArray(data.conversations) ? data.conversations : [];
}

export async function getMessages(
  tunnelUrl: string,
  token: string,
  conversationId: string
): Promise<HubMessage[]> {
  const res = await fetch(`${tunnelUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load this conversation."));
  }
  const data = await res.json();
  return Array.isArray(data.messages) ? data.messages : [];
}

export async function sendMessage(
  tunnelUrl: string,
  token: string,
  conversationId: string,
  body: string
): Promise<HubMessage> {
  const res = await fetch(`${tunnelUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't send that message."));
  }
  return res.json();
}

export async function search(tunnelUrl: string, token: string, query: string, limit = 20): Promise<SearchResults> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${tunnelUrl}/api/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't search this hub."));
  }
  const data = await res.json();
  return {
    posts: Array.isArray(data.results?.posts) ? data.results.posts : [],
    members: Array.isArray(data.results?.members) ? data.results.members : [],
    spaces: Array.isArray(data.results?.spaces) ? data.results.spaces : [],
  };
}

function readString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// Field names vary across server versions (node_id/id, name/username, etc.) —
// this mirrors citinet's own web client, which normalizes the same way rather
// than trusting one fixed shape.
function normalizeMember(m: Record<string, unknown>): HubMember {
  const visibility = readString(m.profile_visibility);
  return {
    user_id: readString(m.user_id) ?? readString(m.id) ?? readString(m.node_id) ?? '',
    username: readString(m.username) ?? readString(m.name) ?? '',
    display_name: readString(m.display_name) ?? readString(m.displayName),
    bio: readString(m.bio),
    location: readString(m.location),
    is_admin: m.is_admin === true || m.isAdmin === true,
    role: readString(m.role),
    profile_headline: readString(m.profile_headline),
    website: readString(m.website),
    tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string') : [],
    profile_visibility: visibility === 'public' || visibility === 'private' ? visibility : 'hub',
    location_visible: m.location_visible !== false,
  };
}

export async function listMembers(tunnelUrl: string, token: string): Promise<HubMember[]> {
  const res = await fetch(`${tunnelUrl}/api/members`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load members."));
  }
  const data = await res.json();
  const raw: Record<string, unknown>[] = Array.isArray(data) ? data : Array.isArray(data.members) ? data.members : [];
  return raw.map(normalizeMember);
}

export async function getMember(tunnelUrl: string, token: string, userId: string): Promise<HubMember> {
  const res = await fetch(`${tunnelUrl}/api/members/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load this profile."));
  }
  return normalizeMember(await res.json());
}

// Starts (or resolves the existing) DM with a peer — mirrors citinet web's
// POST /api/conversations with kind:'dm', which the server treats as
// get-or-create rather than always minting a new conversation.
export async function createConversation(
  tunnelUrl: string,
  token: string,
  peerUserId: string
): Promise<HubConversation> {
  const res = await fetch(`${tunnelUrl}/api/conversations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'dm', peer_user_id: peerUserId }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't start a conversation."));
  }
  return res.json();
}

// Mirrors citinet web's PATCH /api/auth/profile — only the fields this app
// actually edits (see app/account/settings.tsx and app/account/privacy.tsx).
// Web also supports tags/banner fields; not surfaced on mobile yet.
export async function updateProfile(
  tunnelUrl: string,
  token: string,
  updates: {
    displayName?: string;
    bio?: string;
    profileHeadline?: string;
    website?: string;
    profileVisibility?: 'public' | 'hub' | 'private';
    locationVisible?: boolean;
  }
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (updates.displayName !== undefined) body.display_name = updates.displayName;
  if (updates.bio !== undefined) body.bio = updates.bio;
  if (updates.profileHeadline !== undefined) body.profile_headline = updates.profileHeadline;
  if (updates.website !== undefined) body.website = updates.website;
  if (updates.profileVisibility !== undefined) body.profile_visibility = updates.profileVisibility;
  if (updates.locationVisible !== undefined) body.location_visible = updates.locationVisible;

  const res = await fetch(`${tunnelUrl}/api/auth/profile`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't save your profile."));
  }
}

export async function changePassword(
  tunnelUrl: string,
  token: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't change your password."));
  }
}

export async function deleteAccount(tunnelUrl: string, token: string, password: string): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/auth/account`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "Couldn't delete your account."));
  }
}

// ── E2E key management ──────────────────────────────────────────────
// getPeerPublicKey/getKeyBackup return null ONLY on a server-confirmed 404 —
// "no key registered" / "no backup yet" is a legitimate, permanent state.
// Any other failure (network error, non-404 status) retries with backoff and
// then throws — it must NOT be treated the same as a confirmed absence.
// citinet-web had this exact bug (collapsing "couldn't check" into "doesn't
// exist"): callers used a false "no backup" to justify minting a fresh
// keypair and overwriting the server's public key + backup (both are
// upserts), permanently orphaning every message already encrypted to the old
// key — no recovery phrase, old or new, could ever restore it afterward
// (citinet-web's e2e_encryption memory has the full incident writeup, fixed
// 2026-08-26). Same mechanism applies here since mobile and web share the
// same hub account/key state on the server.
async function fetchWithConfirmedAbsence<T>(
  url: string,
  token: string,
  parse: (res: Response) => Promise<T>
): Promise<T | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 404) return null; // confirmed absence
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      return await parse(res);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function registerPublicKey(tunnelUrl: string, token: string, publicKeyJwk: string): Promise<void> {
  await fetch(`${tunnelUrl}/api/keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKeyJwk }),
  });
}

/** Throws if the lookup itself couldn't be completed — see fetchWithConfirmedAbsence. */
export async function getPeerPublicKey(tunnelUrl: string, token: string, userId: string): Promise<string | null> {
  return fetchWithConfirmedAbsence(`${tunnelUrl}/api/keys/${encodeURIComponent(userId)}`, token, async (res) => {
    const { publicKeyJwk } = await res.json();
    return publicKeyJwk ?? null;
  });
}

export type KeyBackupPayload = { encrypted_payload: string; salt: string; iv: string };

export async function storeKeyBackup(tunnelUrl: string, token: string, backup: KeyBackupPayload): Promise<boolean> {
  const res = await fetch(`${tunnelUrl}/api/keys/backup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(backup),
  });
  return res.ok;
}

/** Throws if the check itself couldn't be completed — see fetchWithConfirmedAbsence. */
export async function getKeyBackup(tunnelUrl: string, token: string): Promise<KeyBackupPayload | null> {
  return fetchWithConfirmedAbsence(`${tunnelUrl}/api/keys/backup`, token, (res) => res.json() as Promise<KeyBackupPayload>);
}

// ── Notes ────────────────────────────────────────────────────────────
// Plain REST here, same as messages: this file never touches crypto.
// body_plain in/out of these calls is already ciphertext by the time it
// gets here (or gets there) — see lib/crypto/e2e-context.tsx's
// encryptNote/decryptNote, the layer that wraps these for screens.

export async function listNotes(tunnelUrl: string, token: string, archived = false): Promise<HubNote[]> {
  const res = await fetch(`${tunnelUrl}/api/notes${archived ? '?archived=true' : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load notes."));
  }
  const data = await res.json();
  return Array.isArray(data.notes) ? data.notes : [];
}

export async function getNote(tunnelUrl: string, token: string, noteId: string): Promise<HubNote> {
  const res = await fetch(`${tunnelUrl}/api/notes/${encodeURIComponent(noteId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load this note."));
  }
  return res.json();
}

export async function createNote(
  tunnelUrl: string,
  token: string,
  data: { title?: string; body_plain?: string; body_rich?: object | null }
): Promise<HubNote> {
  const res = await fetch(`${tunnelUrl}/api/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't create that note."));
  }
  return res.json();
}

export async function updateNote(
  tunnelUrl: string,
  token: string,
  noteId: string,
  patch: Partial<
    Pick<
      HubNote,
      | 'title'
      | 'body_plain'
      | 'body_rich'
      | 'web_body_plain'
      | 'web_body_rich'
      | 'is_pinned'
      | 'is_archived'
      | 'is_public'
      | 'is_web_public'
      | 'is_blog_published'
    >
  >
): Promise<HubNote> {
  const res = await fetch(`${tunnelUrl}/api/notes/${encodeURIComponent(noteId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't save that note."));
  }
  return res.json();
}

export async function deleteNote(tunnelUrl: string, token: string, noteId: string): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "Couldn't delete that note."));
  }
}

// ── Atlas pins ───────────────────────────────────────────────────────

export async function listAtlasPins(tunnelUrl: string, token: string): Promise<AtlasPin[]> {
  const res = await fetch(`${tunnelUrl}/api/atlas/pins`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load the atlas."));
  }
  const data = await res.json();
  return Array.isArray(data.pins) ? data.pins : [];
}

export async function createAtlasPin(
  tunnelUrl: string,
  token: string,
  data: {
    latitude: number;
    longitude: number;
    title: string;
    description?: string;
    category: AtlasPinCategory;
    image_file_name?: string | null;
  }
): Promise<AtlasPin> {
  const res = await fetch(`${tunnelUrl}/api/atlas/pins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't drop that pin."));
  }
  return res.json();
}

// latitude/longitude are deliberately not editable — the real server route
// doesn't accept them either (moving a pin isn't supported, only its content).
export async function updateAtlasPin(
  tunnelUrl: string,
  token: string,
  pinId: string,
  data: { title: string; description?: string; category: AtlasPinCategory; image_file_name?: string | null }
): Promise<AtlasPin> {
  const res = await fetch(`${tunnelUrl}/api/atlas/pins/${encodeURIComponent(pinId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't update that pin."));
  }
  return res.json();
}

export async function deleteAtlasPin(tunnelUrl: string, token: string, pinId: string): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/atlas/pins/${encodeURIComponent(pinId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "Couldn't remove that pin."));
  }
}

export type UploadedFile = { file_id: string; file_name: string; size_bytes: number; mime_type: string };

// POST /api/files — the one general-purpose upload route in citinet's real
// server (streams to MinIO via busboy on their end; a plain multipart
// FormData body here is all fetch needs, RN sets the boundary/Content-Type
// itself from a { uri, name, type } part). `isPublic` gates whether the file
// is downloadable without a token at all — false here, since Atlas has no
// public/no-auth surface to justify that (unlike, say, an avatar).
export async function uploadFile(
  tunnelUrl: string,
  token: string,
  file: { uri: string; name: string; type: string },
  isPublic = false
): Promise<UploadedFile> {
  const form = new FormData();
  // RN's FormData accepts this { uri, name, type } shape directly; it isn't
  // a real Blob/File, but fetch on RN knows how to stream it from the uri.
  form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);

  const res = await fetch(`${tunnelUrl}/api/files?is_public=${isPublic}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't upload that photo."));
  }
  const uploaded = await res.json();
  // size_bytes comes back as a string (Postgres BIGINT) — see listFiles()'s
  // comment for why this needs normalizing rather than trusted as a number.
  return { ...uploaded, size_bytes: Number(uploaded.size_bytes) || 0 };
}

// Same POST /api/files?is_public=<bool> route as uploadFile() above, but via
// XMLHttpRequest instead of fetch — RN's fetch has no upload-progress event,
// while XHR's upload.onprogress does, and citinet web's own uploadFile() takes
// a progressCallback for exactly this reason (its upload UI shows a real
// percentage, not a spinner). Only app/files/upload.tsx needs this; every
// other uploader in this app (Atlas/Marketplace/event photos) keeps using the
// simpler uploadFile() above since none of them show a progress bar.
export function uploadFileWithProgress(
  tunnelUrl: string,
  token: string,
  file: { uri: string; name: string; type: string },
  isPublic: boolean,
  onProgress: (percent: number) => void
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${tunnelUrl}/api/files?is_public=${isPublic}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const uploaded = JSON.parse(xhr.responseText);
          // size_bytes comes back as a string (Postgres BIGINT) — see
          // listFiles()'s comment for why this needs normalizing.
          resolve({ ...uploaded, size_bytes: Number(uploaded.size_bytes) || 0 });
        } catch {
          reject(new Error("Couldn't upload that file."));
        }
      } else {
        let message = "Couldn't upload that file.";
        try {
          const body = JSON.parse(xhr.responseText);
          if (typeof body?.error === 'string') message = body.error;
        } catch {
          // response wasn't JSON — fall through to the generic message
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error("Couldn't reach this hub. Check that it's online and try again."));
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
    xhr.send(form);
  });
}

// Public endpoint, no auth header needed — safe to use directly as an <Image> uri.
export function getAvatarUrl(tunnelUrl: string, userId: string): string {
  return `${tunnelUrl}/api/auth/avatar/${encodeURIComponent(userId)}`;
}

// fileName -> in-flight/resolved download URL, so simultaneous requests for the
// same file (e.g. shown in both the feed and post detail) share one token request.
const mediaUrlCache = new Map<string, Promise<string>>();

export function getMediaUrl(tunnelUrl: string, token: string, fileName: string): Promise<string> {
  const cacheKey = `${tunnelUrl}::${fileName}`;
  const cached = mediaUrlCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const res = await fetch(`${tunnelUrl}/api/files/${encodeURIComponent(fileName)}/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, "Couldn't load media."));
    }
    const { token: dlToken } = await res.json();
    return `${tunnelUrl}/api/files/${encodeURIComponent(fileName)}/download?token=${dlToken}`;
  })();

  mediaUrlCache.set(cacheKey, promise);
  promise.catch(() => mediaUrlCache.delete(cacheKey));
  return promise;
}

// ── Files ────────────────────────────────────────────────────────────────
// Own files plus every other member's is_public files — GET /api/files'
// real WHERE clause is `owner_id = $1 OR is_public = true` (confirmed
// directly against api/server.js), so there's no separate "browse the whole
// hub's private files" mode to build; the server already scopes this
// correctly and app/files/index.tsx's "All files" filter is just this list
// unfiltered.

export async function listFiles(tunnelUrl: string, token: string): Promise<HubFile[]> {
  const res = await fetch(`${tunnelUrl}/api/files`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load files."));
  }
  const data = await res.json();
  const raw: HubFile[] = Array.isArray(data.files) ? data.files : [];
  // hub_files.size_bytes is a Postgres BIGINT, which node-postgres deserializes
  // as a JS string (not a number) to avoid precision loss — the real wire
  // value here is "442912", not 442912. Left as-is, `reduce((sum, f) => sum +
  // f.size_bytes)` silently does string concatenation instead of addition
  // (0 + "442912" coerces to string), producing one huge digit-string across
  // every file that overflows to Infinity the moment anything divides it —
  // exactly what showed up as "∞ TB" on the Storage screen. Normalized once
  // here, at the API boundary, same as normalizeMember() does for member
  // fields, so every downstream consumer can trust size_bytes is a real number.
  return raw.map((f) => ({ ...f, size_bytes: Number(f.size_bytes) || 0 }));
}

export async function deleteFile(tunnelUrl: string, token: string, fileName: string): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/files/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "Couldn't delete that file."));
  }
}

// The real route only accepts is_public at upload time (POST /api/files'
// own INSERT always writes web_public: false) — reaching the "web" tier
// from the Upload screen means uploading private-or-hub, then calling this
// once more with 'web'. Server returns { success: true }, not the updated
// file, so callers recompute is_public/web_public locally from the tier.
export async function setFileVisibility(
  tunnelUrl: string,
  token: string,
  fileName: string,
  visibility: FileVisibility
): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/files/${encodeURIComponent(fileName)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't update that file's visibility."));
  }
}

// ── Marketplace ─────────────────────────────────────────────────────────

export async function listMarketplaceListings(
  tunnelUrl: string,
  token: string,
  category?: string
): Promise<MarketplaceListing[]> {
  const q = category && category !== 'All' ? `?category=${encodeURIComponent(category)}` : '';
  const res = await fetch(`${tunnelUrl}/api/marketplace/listings${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load the marketplace."));
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// All vendors, each with a server-computed listing_count — used for the
// "Community vendors" strip (top 3 by count) and the admin stats panel.
export async function listVendors(tunnelUrl: string, token: string): Promise<MarketplaceVendor[]> {
  const res = await fetch(`${tunnelUrl}/api/vendors`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load vendors."));
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// 404 means "no vendor page yet," not an error — every caller treats null as
// "you need to create one before you can post a listing," matching the real
// server's own gate on POST /api/marketplace/listings.
export async function getMyVendor(tunnelUrl: string, token: string): Promise<MarketplaceVendor | null> {
  const res = await fetch(`${tunnelUrl}/api/vendors/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load your vendor page."));
  }
  return res.json();
}

export async function getVendor(
  tunnelUrl: string,
  token: string,
  vendorId: string
): Promise<{ vendor: MarketplaceVendor; listings: MarketplaceListing[] }> {
  const res = await fetch(`${tunnelUrl}/api/vendors/${encodeURIComponent(vendorId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load this vendor."));
  }
  return res.json();
}

export type VendorInput = {
  name: string;
  description?: string;
  category?: string;
  logo_file_name?: string | null;
  banner_mode?: 'image' | 'solid' | 'gradient' | null;
  banner_image_file_name?: string | null;
  banner_color?: string | null;
  banner_gradient_from?: string | null;
  banner_gradient_to?: string | null;
  contact_email?: string;
  contact_phone?: string;
  website?: string;
  hours?: string;
};

export async function createVendor(tunnelUrl: string, token: string, data: VendorInput): Promise<MarketplaceVendor> {
  const res = await fetch(`${tunnelUrl}/api/vendors`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't create your vendor page."));
  }
  return res.json();
}

export async function updateVendor(
  tunnelUrl: string,
  token: string,
  data: Partial<VendorInput> & { web_public?: boolean }
): Promise<MarketplaceVendor> {
  const res = await fetch(`${tunnelUrl}/api/vendors/me`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't update your vendor page."));
  }
  return res.json();
}

export type ListingInput = {
  title: string;
  description?: string;
  price?: number | null;
  price_type?: ListingPriceType;
  category?: string;
  image_file_name?: string | null;
  condition?: string | null;
  is_active?: boolean;
};

// 403s server-side if the caller has no vendor page yet — callers should
// check getMyVendor() first and route to vendor creation instead of relying
// on this to fail (see app/marketplace/editor.tsx).
export async function createListing(tunnelUrl: string, token: string, data: ListingInput): Promise<MarketplaceListing> {
  const res = await fetch(`${tunnelUrl}/api/marketplace/listings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't post that listing."));
  }
  return res.json();
}

export async function updateListing(
  tunnelUrl: string,
  token: string,
  listingId: string,
  data: Partial<ListingInput>
): Promise<MarketplaceListing> {
  const res = await fetch(`${tunnelUrl}/api/marketplace/listings/${encodeURIComponent(listingId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't update that listing."));
  }
  return res.json();
}

export async function deleteListing(tunnelUrl: string, token: string, listingId: string): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/marketplace/listings/${encodeURIComponent(listingId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "Couldn't remove that listing."));
  }
}

export async function getMarketplaceBannerConfig(tunnelUrl: string, token: string): Promise<MarketplaceBannerConfig> {
  const res = await fetch(`${tunnelUrl}/api/marketplace-config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load the marketplace banner."));
  }
  return res.json();
}

// Admin-only server-side (403 for non-admins) — gate the UI entry point on
// session.isAdmin too, same convention as app/(tabs)/profile.tsx's admin row.
export async function updateMarketplaceBannerConfig(
  tunnelUrl: string,
  token: string,
  config: Partial<MarketplaceBannerConfig>
): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/marketplace-config`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't save the banner."));
  }
}

// ── Initiatives ──────────────────────────────────────────────────────
// listInitiatives/getInitiative/joinInitiative/getInitiativeTeam/
// getInitiativeActivity/getInitiativeShareLink/inviteToInitiative below
// follow this file's existing REST conventions and haven't individually been
// re-checked against api/server.js beyond the confirmed GET /:id shape (see
// types.ts) — treat those as best-effort. Everything from the Tasks section
// onward (tasks, checklist, notes, roles, resources) has been corrected
// against api/server.js's real routes directly, since the original guesses
// there were wrong on several endpoint paths, HTTP methods, and body/response
// field names — see each function's own note for what changed.

export async function listInitiatives(tunnelUrl: string, token: string, spaceId?: string): Promise<Initiative[]> {
  const params = spaceId ? `?space_id=${encodeURIComponent(spaceId)}` : '';
  const res = await fetch(`${tunnelUrl}/api/initiatives${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load initiatives."));
  }
  const data = await res.json();
  return Array.isArray(data.initiatives) ? data.initiatives : [];
}

export async function getInitiative(tunnelUrl: string, token: string, initiativeId: string): Promise<Initiative> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/${encodeURIComponent(initiativeId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load this initiative."));
  }
  return res.json();
}

export async function joinInitiative(tunnelUrl: string, token: string, initiativeId: string): Promise<Initiative> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/${encodeURIComponent(initiativeId)}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't join this initiative."));
  }
  return res.json();
}

export async function getInitiativeTeam(
  tunnelUrl: string,
  token: string,
  initiativeId: string
): Promise<InitiativeTeamMember[]> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/${encodeURIComponent(initiativeId)}/team`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load contributors."));
  }
  const data = await res.json();
  return Array.isArray(data.team) ? data.team : [];
}

export async function getInitiativeActivity(
  tunnelUrl: string,
  token: string,
  initiativeId: string,
  limit = 5
): Promise<InitiativeActivityEntry[]> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/${encodeURIComponent(initiativeId)}/activity?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load recent activity."));
  }
  const data = await res.json();
  return Array.isArray(data.activity) ? data.activity : [];
}

export async function getInitiativeShareLink(tunnelUrl: string, token: string, initiativeId: string): Promise<string> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/${encodeURIComponent(initiativeId)}/share-link`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't get a share link."));
  }
  const data = await res.json();
  return data.url ?? data.link ?? '';
}

export async function inviteToInitiative(
  tunnelUrl: string,
  token: string,
  initiativeId: string,
  userId: string
): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/${encodeURIComponent(initiativeId)}/invite`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't send that invite."));
  }
}

// Tasks
//
// There is no `/api/initiatives/:id/tasks` route on the real server at all —
// tasks only ever come back embedded in GET /api/initiatives/:id (see
// InitiativeTaskSummary). The real create/update/delete routes are addressed
// as "goals" (POST /:id/goals, PATCH and DELETE /goals/:goalId) — a legacy
// name from the external-provider proxy this hub was originally built
// against — even though everywhere else (checklist, notes, blocked, meta)
// uses "tasks"/taskId. Both address the same hub_initiative_local_tasks row.

export async function addTask(
  tunnelUrl: string,
  token: string,
  initiativeId: string,
  data: { title: string; assignee_user_id?: string; due_date?: string }
): Promise<InitiativeTaskSummary> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/${encodeURIComponent(initiativeId)}/goals`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't add that task."));
  }
  return res.json();
}

// One call for every task in the initiative — GET /:id/task-meta, not a
// per-task endpoint (there isn't one). A task with no assignee/due-date and
// no checklist items has no row in the response at all; callers should treat
// a missing entry the same as an all-null/zero one, not as an error.
export async function getInitiativeTaskMeta(tunnelUrl: string, token: string, initiativeId: string): Promise<TaskMeta[]> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/${encodeURIComponent(initiativeId)}/task-meta`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load task details."));
  }
  const data = await res.json();
  return Array.isArray(data.taskMeta) ? data.taskMeta : [];
}

// initiativeId/title are only used to log a real activity-feed entry
// ("completed <title>") when status flips to 'done' — the server has no way
// to look up a goal's parent initiative or title on its own (no "get one
// goal" route), so the caller supplies both; they're stripped before this
// ever reaches an external provider. Returns 409 if the task has checklist
// items — its status follows checklist completion instead (see
// recomputeTaskStatusFromChecklist server-side); callers should only offer
// manual status changes when a task has no checklist.
export async function updateTaskStatus(
  tunnelUrl: string,
  token: string,
  taskId: string,
  status: InitiativeTaskSummary['status'],
  initiativeId: string,
  title: string
): Promise<InitiativeTaskSummary> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/goals/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, _initiativeId: initiativeId, _title: title }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't update that task's status."));
  }
  return res.json();
}

// `blocked` is the one manual override a checklist can't infer — gated
// server-side to the task's creator/assignee, same as checklist writes.
export async function setTaskBlocked(
  tunnelUrl: string,
  token: string,
  taskId: string,
  blocked: boolean,
  initiativeId: string
): Promise<TaskMeta> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/tasks/${encodeURIComponent(taskId)}/blocked`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocked, initiative_id: initiativeId }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't update that task."));
  }
  return res.json();
}

// Assignment lives on the same "goal meta" route as due_date, addressed by
// PATCH .../goals/:taskId/meta (not a dedicated /assign endpoint). Passing
// assignSelf=false with no explicit user clears the assignment — used by
// unassignTask below.
export async function assignTask(
  tunnelUrl: string,
  token: string,
  taskId: string,
  initiativeId: string,
  assignSelf: boolean
): Promise<TaskMeta> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/goals/${encodeURIComponent(taskId)}/meta`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ initiative_id: initiativeId, assign_self: assignSelf }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't assign that task."));
  }
  return res.json();
}

/** Self-service "not for me" — also usable by the task creator to clear someone else's assignment. */
export async function unassignTask(tunnelUrl: string, token: string, taskId: string, initiativeId: string): Promise<TaskMeta> {
  return assignTask(tunnelUrl, token, taskId, initiativeId, false);
}

export async function deleteTask(tunnelUrl: string, token: string, taskId: string): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/goals/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "Couldn't delete that task."));
  }
}

// Checklist

export async function getChecklist(tunnelUrl: string, token: string, taskId: string): Promise<ChecklistItem[]> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/tasks/${encodeURIComponent(taskId)}/checklist`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load the checklist."));
  }
  const data = await res.json();
  return Array.isArray(data.checklist) ? data.checklist : [];
}

// Gated server-side to the task's creator/assignee (assertTaskOwner) — a 403
// here means the caller isn't either.
export async function addChecklistItem(
  tunnelUrl: string,
  token: string,
  taskId: string,
  initiativeId: string,
  text: string
): Promise<ChecklistItem> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/tasks/${encodeURIComponent(taskId)}/checklist`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, initiative_id: initiativeId }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't add that step."));
  }
  return res.json();
}

export async function updateChecklistItem(
  tunnelUrl: string,
  token: string,
  itemId: string,
  patch: { text?: string; done?: boolean }
): Promise<ChecklistItem> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/checklist/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't update that step."));
  }
  return res.json();
}

export async function deleteChecklistItem(tunnelUrl: string, token: string, itemId: string): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/checklist/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "Couldn't remove that step."));
  }
}

// Task notes (progress notes + discussion — the handoff describes these as
// two visual sections of the task workspace, both backed by the same
// getTaskNotes/postTaskNote/replyToNote list rather than a separate endpoint
// each, per the reference implementation's function list).

export async function getTaskNotes(tunnelUrl: string, token: string, taskId: string): Promise<TaskNote[]> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/tasks/${encodeURIComponent(taskId)}/notes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load notes."));
  }
  const data = await res.json();
  return Array.isArray(data.notes) ? data.notes : [];
}

export async function postTaskNote(tunnelUrl: string, token: string, taskId: string, initiativeId: string, content: string): Promise<TaskNote> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/tasks/${encodeURIComponent(taskId)}/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, initiative_id: initiativeId }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't post that note."));
  }
  return res.json();
}

export async function replyToNote(tunnelUrl: string, token: string, noteId: string, content: string): Promise<TaskNoteReply> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/notes/${encodeURIComponent(noteId)}/replies`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't post that reply."));
  }
  return res.json();
}

export async function deleteTaskNote(tunnelUrl: string, token: string, noteId: string): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "Couldn't delete that note."));
  }
}

export async function deleteNoteReply(tunnelUrl: string, token: string, replyId: string): Promise<void> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/note-replies/${encodeURIComponent(replyId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "Couldn't delete that reply."));
  }
}

// Roles

export async function listInitiativeRoles(tunnelUrl: string, token: string, initiativeId: string): Promise<InitiativeRole[]> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/${encodeURIComponent(initiativeId)}/roles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load open roles."));
  }
  const data = await res.json();
  return Array.isArray(data.roles) ? data.roles : [];
}

// Claiming a role also joins the caller to the initiative (member count +
// Contributors update immediately) — the server does this atomically
// server-side, so this doesn't make a second joinInitiative call. The real
// route is /claim, not /volunteer as originally guessed.
export async function volunteerForRole(tunnelUrl: string, token: string, roleId: string): Promise<InitiativeRole> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/roles/${encodeURIComponent(roleId)}/claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't claim that role."));
  }
  return res.json();
}

// Real route is /unclaim, not /step-down as originally guessed.
export async function stepDownFromRole(tunnelUrl: string, token: string, roleId: string): Promise<InitiativeRole> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/roles/${encodeURIComponent(roleId)}/unclaim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't step down from that role."));
  }
  return res.json();
}

// Resources

export async function listInitiativeResources(
  tunnelUrl: string,
  token: string,
  initiativeId: string
): Promise<InitiativeResource[]> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/${encodeURIComponent(initiativeId)}/resources`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't load resources."));
  }
  const data = await res.json();
  return Array.isArray(data.resources) ? data.resources : [];
}

// Real route is PATCH, not POST as originally guessed. The server itself
// places no membership check on this route — any authenticated member of the
// hub can call it — so gating "I can provide this" to initiative members is
// purely a client-side UI decision, not something the API enforces.
export async function provideResource(tunnelUrl: string, token: string, resourceId: string): Promise<InitiativeResource> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/resources/${encodeURIComponent(resourceId)}/provide`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't mark that as provided."));
  }
  return res.json();
}

// Real route is PATCH, not POST as originally guessed. Self-service only —
// the server 403s unless the caller is the one who pledged it.
export async function unprovideResource(tunnelUrl: string, token: string, resourceId: string): Promise<InitiativeResource> {
  const res = await fetch(`${tunnelUrl}/api/initiatives/resources/${encodeURIComponent(resourceId)}/unprovide`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Couldn't undo that."));
  }
  return res.json();
}
