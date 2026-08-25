import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams, type Href } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listAtlasPins, listConversations, sendMessage } from '@/lib/api/hubService';
import { AtlasPin, HubConversation } from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { useSession } from '@/lib/session/session-context';

// Atlas pins have no public, no-auth endpoint the way Notes' "Link" tier does
// (confirmed from api/server.js — GET /api/atlas/pins requires `authenticate`,
// there's no /api/public/atlas/pins/:id at all). So "Copy link"/native share
// can't produce an anyone-can-view web URL — it copies an in-app deep link
// (this app's own citinet:// scheme, already declared in app.json) that jumps
// a signed-in hub member straight to this pin if they have the app installed.
function pinDeepLink(pinId: string): string {
  return `citinet://atlas/${pinId}`;
}

function shareText(pin: AtlasPin): string {
  return `Check out "${pin.title}" on the Atlas — ${pinDeepLink(pin.id)}`;
}

export default function SharePinScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { encryptForConversation } = useE2EKeys();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [pin, setPin] = useState<AtlasPin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [neighborsOpen, setNeighborsOpen] = useState(false);
  const [conversations, setConversations] = useState<HubConversation[] | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    listAtlasPins(session.hub.tunnelUrl, session.token)
      .then((pins) => {
        if (cancelled) return;
        const found = pins.find((p) => p.id === id) ?? null;
        if (!found) setError('Pin not found.');
        setPin(found);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load this pin.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session, id]);

  function handleShareToFeed() {
    if (!pin) return;
    router.push(`/compose-post?text=${encodeURIComponent(`Check out ${pin.title} on the Atlas`)}` as Href);
  }

  function toggleNeighbors() {
    if (!session) return;
    setNeighborsOpen((v) => !v);
    if (!conversations) {
      listConversations(session.hub.tunnelUrl, session.token)
        .then((all) => setConversations(all.filter((c) => c.kind === 'dm')))
        .catch(() => setConversations([]));
    }
  }

  async function handleSendToNeighbor(convo: HubConversation) {
    if (!session || !pin || sendingTo) return;
    const peer = convo.members.find((m) => m.user_id !== session.userId);
    setSendingTo(convo.conversation_id);
    try {
      const body = await encryptForConversation(convo.conversation_id, peer?.user_id ?? null, shareText(pin));
      await sendMessage(session.hub.tunnelUrl, session.token, convo.conversation_id, body);
      router.push({
        pathname: '/conversation/[id]',
        params: { id: convo.conversation_id, title: peer?.username ?? 'Conversation', peerId: peer?.user_id ?? '' },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that pin.");
      setSendingTo(null);
    }
  }

  async function handleCopyLink() {
    if (!pin) return;
    await Clipboard.setStringAsync(pinDeepLink(pin.id));
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 2500);
  }

  function handleNativeShare() {
    if (!pin) return;
    Share.share({ message: shareText(pin) });
  }

  if (!session) return null;

  const meta = pin ? ATLAS_CATEGORIES[pin.category] : null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
          <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.title}>
          Share pin
        </ThemedText>
        <View style={{ width: 24 }} />
      </View>

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {pin && meta && (
        <View style={styles.body}>
          <View style={styles.pinChip}>
            <View style={[styles.pinChipIcon, { backgroundColor: meta.color }]}>
              <IconSymbol name={meta.icon} size={16} color="#fff" />
            </View>
            <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.pinChipTitle}>
              {pin.title}
            </ThemedText>
          </View>

          <Pressable onPress={handleShareToFeed} style={styles.row}>
            <IconSymbol name="house.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Share to hub feed</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>

          <Pressable onPress={toggleNeighbors} style={styles.row}>
            <IconSymbol name="person.fill" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Send to a neighbor</ThemedText>
            <IconSymbol name={neighborsOpen ? 'chevron.down' : 'chevron.right'} size={16} color={Colors[colorScheme].icon} />
          </Pressable>

          {neighborsOpen && (
            <View style={styles.neighborList}>
              {conversations === null && <ActivityIndicator style={styles.neighborSpinner} />}
              {conversations?.length === 0 && <ThemedText style={styles.neighborEmpty}>No conversations yet.</ThemedText>}
              {conversations?.map((convo) => {
                const peer = convo.members.find((m) => m.user_id !== session.userId);
                if (!peer) return null;
                return (
                  <Pressable
                    key={convo.conversation_id}
                    onPress={() => handleSendToNeighbor(convo)}
                    disabled={!!sendingTo}
                    style={styles.neighborRow}>
                    <HubAvatar userId={peer.user_id} displayName={peer.username} tunnelUrl={session.hub.tunnelUrl} size={32} />
                    <ThemedText style={styles.neighborLabel}>{peer.username}</ThemedText>
                    {sendingTo === convo.conversation_id && <ActivityIndicator size="small" />}
                  </Pressable>
                );
              })}
            </View>
          )}

          <Pressable onPress={handleNativeShare} style={styles.row}>
            <IconSymbol name="square.and.arrow.up" size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>Share via…</ThemedText>
          </Pressable>

          <Pressable onPress={handleCopyLink} style={styles.row}>
            <IconSymbol name={copyStatus === 'copied' ? 'checkmark.circle' : 'doc.on.doc'} size={20} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.rowLabel}>{copyStatus === 'copied' ? 'Link copied' : 'Copy link'}</ThemedText>
          </Pressable>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  title: {
    fontSize: 17,
  },
  spinner: {
    marginTop: 40,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginTop: 12,
  },
  body: {
    paddingHorizontal: 20,
  },
  pinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    marginBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  pinChipIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinChipTitle: {
    flex: 1,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
  },
  neighborList: {
    paddingLeft: 12,
    paddingBottom: 4,
  },
  neighborSpinner: {
    marginVertical: 12,
  },
  neighborEmpty: {
    opacity: 0.6,
    fontSize: 13,
    paddingVertical: 12,
  },
  neighborRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  neighborLabel: {
    flex: 1,
    fontSize: 14.5,
  },
});
