import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams, type Href } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listConversations, listFiles, sendMessage, setFileVisibility } from '@/lib/api/hubService';
import { HubConversation, HubFile } from '@/lib/api/types';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { FILE_KIND_META, fileKind, formatBytes } from '@/lib/files/kind';
import { useSession } from '@/lib/session/session-context';

// Real, confirmed pattern — same root-domain portal redirect citinet web
// uses for its own file share links (getPublicShareLink in the real
// hubService.ts: `${base}/share/${hubSlug}/${fileName}`), and the exact
// convention app/notes/[id].tsx already established for Notes' own "Link"
// tier share URL.
function shareUrl(hubSlug: string, fileName: string): string {
  return `https://citinet.cloud/share/${hubSlug}/${encodeURIComponent(fileName)}`;
}

export default function ShareFileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { encryptForConversation } = useE2EKeys();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [file, setFile] = useState<HubFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [neighborsOpen, setNeighborsOpen] = useState(false);
  const [conversations, setConversations] = useState<HubConversation[] | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [changingVisibility, setChangingVisibility] = useState(false);

  useEffect(() => {
    if (!session || !id) return;
    let cancelled = false;
    listFiles(session.hub.tunnelUrl, session.token)
      .then((files) => {
        if (cancelled) return;
        const found = files.find((f) => f.file_id === id) ?? null;
        if (!found) setError('File not found.');
        setFile(found);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load this file.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session, id]);

  const isOwner = !!(session && file && file.owner_id === session.userId);

  function shareText(f: HubFile) {
    return f.web_public
      ? `Check out "${f.file_name}" — ${shareUrl(session!.hub.slug, f.file_name)}`
      : `Shared a file: ${f.file_name} (${formatBytes(f.size_bytes)})`;
  }

  function handleShareToFeed() {
    if (!file) return;
    router.push(`/compose-post?text=${encodeURIComponent(`Check out ${file.file_name}`)}` as Href);
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
    if (!session || !file || sendingTo) return;
    const peer = convo.members.find((m) => m.user_id !== session.userId);
    setSendingTo(convo.conversation_id);
    try {
      const body = await encryptForConversation(convo.conversation_id, peer?.user_id ?? null, shareText(file));
      await sendMessage(session.hub.tunnelUrl, session.token, convo.conversation_id, body);
      router.push({
        pathname: '/conversation/[id]',
        params: { id: convo.conversation_id, title: peer?.username ?? 'Conversation', peerId: peer?.user_id ?? '' },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that file.");
      setSendingTo(null);
    }
  }

  async function handleCopyLink() {
    if (!session || !file) return;
    await Clipboard.setStringAsync(shareUrl(session.hub.slug, file.file_name));
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 1800);
  }

  function handleNativeShare() {
    if (!file) return;
    Share.share({ message: shareText(file) });
  }

  function handleMakePublic() {
    if (!session || !file || changingVisibility) return;
    setChangingVisibility(true);
    setFileVisibility(session.hub.tunnelUrl, session.token, file.file_name, 'web')
      .then(() => setFile({ ...file, is_public: true, web_public: true }))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't update visibility."))
      .finally(() => setChangingVisibility(false));
  }

  if (!session) return null;

  const meta = file ? FILE_KIND_META[fileKind(file.file_name, file.mime_type)] : null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
          <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.title}>
          Share file
        </ThemedText>
        <View style={{ width: 24 }} />
      </View>

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {file && meta && (
        <View style={styles.body}>
          <View style={styles.fileChip}>
            <View style={[styles.fileChipIcon, { backgroundColor: meta.color }]}>
              <IconSymbol name={meta.icon} size={16} color="#fff" />
            </View>
            <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.fileChipTitle}>
              {file.file_name}
            </ThemedText>
          </View>

          {file.web_public ? (
            <View style={styles.linkBlock}>
              <ThemedText style={styles.linkMono} numberOfLines={1}>
                {shareUrl(session.hub.slug, file.file_name).replace('https://', '')}
              </ThemedText>
              <Pressable onPress={handleCopyLink} style={styles.copyButton}>
                <ThemedText style={styles.copyButtonLabel} lightColor="#fff" darkColor="#fff">
                  {copyStatus === 'copied' ? 'Link copied' : 'Copy'}
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.noLinkBlock}>
              <ThemedText style={styles.noLinkText}>
                This file isn&apos;t public yet, so there&apos;s no link to share.
              </ThemedText>
              {isOwner ? (
                <Pressable onPress={handleMakePublic} disabled={changingVisibility} style={styles.changeVisButton}>
                  {changingVisibility ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <ThemedText style={[styles.changeVisLabel, { color: Brand }]}>Change visibility</ThemedText>
                  )}
                </Pressable>
              ) : (
                <ThemedText style={styles.noLinkText}>Only the owner can make it a public link.</ThemedText>
              )}
            </View>
          )}

          <ThemedText style={styles.sectionLabel}>Send inside the hub</ThemedText>

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
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    marginBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  fileChipIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileChipTitle: {
    flex: 1,
    fontSize: 15,
  },
  linkBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#8881',
  },
  linkMono: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  copyButton: {
    backgroundColor: Brand,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  copyButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  noLinkBlock: {
    marginTop: 14,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#8881',
    gap: 8,
  },
  noLinkText: {
    fontSize: 13,
    opacity: 0.7,
    lineHeight: 18,
  },
  changeVisButton: {
    alignSelf: 'flex-start',
  },
  changeVisLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 4,
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
