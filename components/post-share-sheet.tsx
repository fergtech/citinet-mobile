import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Platform, Share } from 'react-native';

import { ActionSheet, type ActionSheetOption } from '@/components/action-sheet';
import { shareToFeed } from '@/lib/api/hubService';
import { HubPost } from '@/lib/api/types';
import { isMod } from '@/lib/session/is-mod';
import type { StoredSession } from '@/lib/session/types';

type Props = {
  visible: boolean;
  onClose: () => void;
  post: HubPost;
  session: StoredSession;
  // Fires after a successful "Share to Hub" — callers use it to optimistically
  // flip shared_to_feed locally so the option disappears without a refetch.
  onSharedToFeed?: () => void;
};

// The three ways to get a post out of this one screen: rebroadcast it inside
// the hub itself (club post -> main feed, author/mod-only — reuses the
// existing PATCH /api/posts/:id/share-to-feed rather than a new general
// repost concept, which the backend doesn't have), hand out a public web
// link with real preview metadata (citinet-web's share-og.js patches the
// og:/twitter: tags from GET /api/public/posts/:id server-side), or drop
// into the OS share sheet for contacts/other apps — same shareUrl either way.
export function PostShareSheet({ visible, onClose, post, session, onSharedToFeed }: Props) {
  const [sharing, setSharing] = useState(false);

  // citinet.cloud is the static share-link portal every hub's links resolve
  // through (see citinet-web's api/share-og.js) — not this hub's own tunnel
  // URL. No ?src= override needed: that function already falls back to the
  // public hub registry by slug, same as app/notes/[id].tsx's own share link.
  const shareUrl = `https://citinet.cloud/share-post/${session.hub.slug}/${post.id}`;

  const canShareToFeed =
    !!post.space_id && !post.shared_to_feed && (post.author_id === session.userId || isMod(session));

  async function handleShareToFeed() {
    if (sharing) return;
    setSharing(true);
    try {
      await shareToFeed(session.hub.tunnelUrl, session.token, post.id);
      onSharedToFeed?.();
      Alert.alert('Shared to the hub', 'This post now also appears in the main feed.');
    } catch (err) {
      Alert.alert('Could not share', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSharing(false);
    }
  }

  async function handleCopyLink() {
    await Clipboard.setStringAsync(shareUrl);
  }

  function handleNativeShare() {
    Share.share(Platform.OS === 'ios' ? { url: shareUrl } : { message: shareUrl });
  }

  const options: ActionSheetOption[] = [
    ...(canShareToFeed
      ? [{ key: 'share-to-feed', label: 'Share to Hub', icon: 'newspaper.fill', onPress: handleShareToFeed } as const]
      : []),
    { key: 'copy-link', label: 'Copy public link', icon: 'link', onPress: handleCopyLink },
    { key: 'native-share', label: 'Share via…', icon: 'square.and.arrow.up', onPress: handleNativeShare },
  ];

  return <ActionSheet visible={visible} onClose={onClose} options={options} />;
}
