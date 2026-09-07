import AsyncStorage from '@react-native-async-storage/async-storage';

import { createPost, createReply, votePoll, type CreatePostInput } from './hubService';
import type { HubPost, HubPostReply } from './types';

// Mirrors citinet web's writeQueueService.ts — a durable "couldn't reach the
// hub right now, send it once we can" queue for the three write paths that
// already do optimistic local updates (post/reply/vote), so a hub restart
// or dead connection mid-write doesn't force the user to notice, retype, or
// re-tap by hand. AsyncStorage (JSON array under one key) stands in for
// web's IndexedDB store — there's no equivalent volume of data here (a
// handful of pending writes at most, not an offline dataset), and unlike
// web's File-blob attachments, a picked post's media is already just a
// local file:// URI (see CreatePostInput['media']) that FormData can read
// again later, so nothing here needs to persist raw bytes either.
//
// Known limitation, accepted rather than engineered around: a queued post's
// media URI points at ImagePicker's (or prepare-image-upload.ts's) cache
// directory. iOS/Android can reclaim cache storage under pressure, which
// would make a very-long-pending queued post's photo silently drop on send.
// Short-lived queueing (the actual "hub restarting for a minute" scenario
// this exists for) is well within that risk window; a permanent copy into
// document storage would be needed if this queue ever needed to survive
// hours/days reliably.

type QueuedPost = {
  id: string;
  kind: 'post';
  createdAt: string;
  tunnelUrl: string;
  token: string;
  input: CreatePostInput;
};

type QueuedReply = {
  id: string;
  kind: 'reply';
  createdAt: string;
  tunnelUrl: string;
  token: string;
  postId: string;
  body: string;
  replyToReplyId: string | null;
  replyToUserId: string | null;
};

type QueuedVote = {
  id: string;
  kind: 'vote';
  createdAt: string;
  tunnelUrl: string;
  token: string;
  postId: string;
  optionIndex: number;
};

type QueuedWrite = QueuedPost | QueuedReply | QueuedVote;

const STORAGE_KEY = 'write-queue.v1';

async function readQueue(): Promise<QueuedWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    return [];
  }
}

async function persistQueue(queue: QueuedWrite[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue)).catch(() => {});
}

function genId(): string {
  // Same local-id convention as lib/comms/use-broadcast-actions.ts — no
  // crypto.randomUUID available here (see lib/crypto/random-polyfill.ts's
  // own note; only getRandomValues is shimmed), and a queue item never
  // needs to be globally unique, just distinct within this one device's
  // pending list.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// A plain `fetch` failure (offline, DNS, connection refused, hub mid-
// restart) throws a TypeError in React Native's fetch implementation, same
// as on the web — every other throw out of hubService's write functions is
// a plain Error via readErrorMessage (an HTTP response the hub actually
// sent back, just a non-2xx one). That's a reliable way to tell "never
// reached the hub" apart from "reached it and it said no" — only the
// former is worth queuing; a real validation/auth/permission error should
// surface immediately instead of silently retrying against the same
// rejection forever.
function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError;
}

async function enqueue(item: QueuedWrite): Promise<void> {
  const queue = await readQueue();
  queue.push(item);
  await persistQueue(queue);
}

export async function createPostOrQueue(
  tunnelUrl: string,
  token: string,
  input: CreatePostInput
): Promise<{ post: HubPost; queued: false } | { post: null; queued: true }> {
  try {
    const post = await createPost(tunnelUrl, token, input);
    return { post, queued: false };
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    await enqueue({ id: genId(), kind: 'post', createdAt: new Date().toISOString(), tunnelUrl, token, input });
    return { post: null, queued: true };
  }
}

export async function createReplyOrQueue(
  tunnelUrl: string,
  token: string,
  postId: string,
  body: string,
  replyToReplyId: string | null = null,
  replyToUserId: string | null = null
): Promise<{ reply: HubPostReply; queued: false } | { reply: null; queued: true }> {
  try {
    const reply = await createReply(tunnelUrl, token, postId, body, replyToReplyId, replyToUserId);
    return { reply, queued: false };
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    await enqueue({
      id: genId(),
      kind: 'reply',
      createdAt: new Date().toISOString(),
      tunnelUrl,
      token,
      postId,
      body,
      replyToReplyId,
      replyToUserId,
    });
    return { reply: null, queued: true };
  }
}

// Unlike the two above, callers here already apply the optimistic vote
// locally before calling this — on a network failure this queues and
// resolves (doesn't throw), so the existing `.catch(() => revert())` at
// every call site only ever fires for a genuine error now, and the
// optimistic state is correctly left in place for a queued vote (it's what
// the user actually did; it just hasn't reached the hub yet).
export async function voteOrQueue(tunnelUrl: string, token: string, postId: string, optionIndex: number): Promise<void> {
  try {
    await votePoll(tunnelUrl, token, postId, optionIndex);
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    await enqueue({ id: genId(), kind: 'vote', createdAt: new Date().toISOString(), tunnelUrl, token, postId, optionIndex });
  }
}

// Attempts every queued write in order (oldest first), removing each as it
// succeeds. Stops at the first write that fails again for a network reason
// — still unreachable, no point burning through the rest right now — and
// keeps that one plus everything after it queued for next time. A write
// that fails on retry for a REAL reason (e.g. the post it replied to got
// deleted, or the session's token is no longer valid) is dropped instead of
// kept: an item that can never succeed shouldn't sit there retrying forever
// on every future flush.
export async function flushWriteQueue(): Promise<{ sent: number; remaining: number }> {
  const queue = await readQueue();
  if (queue.length === 0) return { sent: 0, remaining: 0 };

  let sent = 0;
  let stoppedAt = -1;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    try {
      if (item.kind === 'post') await createPost(item.tunnelUrl, item.token, item.input);
      else if (item.kind === 'reply') await createReply(item.tunnelUrl, item.token, item.postId, item.body, item.replyToReplyId, item.replyToUserId);
      else await votePoll(item.tunnelUrl, item.token, item.postId, item.optionIndex);
      sent += 1;
    } catch (err) {
      if (isNetworkFailure(err)) {
        stoppedAt = i;
        break;
      }
      // Real failure on retry — drop this item, keep going with the rest.
    }
  }

  const remaining = stoppedAt === -1 ? [] : queue.slice(stoppedAt);
  await persistQueue(remaining);
  return { sent, remaining: remaining.length };
}

export async function pendingWriteCount(): Promise<number> {
  return (await readQueue()).length;
}
