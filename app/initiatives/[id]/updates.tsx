import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteInitiativeUpdate,
  deleteUpdateComment,
  getInitiative,
  getInitiativeUpdates,
  postInitiativeUpdate,
  postUpdateComment,
} from '@/lib/api/hubService';
import { InitiativeUpdateEntry } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';
import { timeAgo } from '@/lib/ui/time-ago';

// A real, live "post an update" wall + threaded comments — mirrors citinet
// web's own UpdatesPane (InitiativesScreen.tsx), reachable here as its own
// nested screen rather than a tab, matching how Team/Tasks/Roles/Resources
// already work on this app. Distinct from the dead `Initiative.updates`
// field embedded on GET /:id (see InitiativeUpdateEntry's own note) — this
// hits the real GET /:id/updates endpoint instead.
//
// No creator gate anywhere here, server-side — posting an update or a reply
// is gated in this UI to viewerIsMember only, a deliberate product choice
// matching web's own canPost={!!current.viewerIsMember}; deleting your own
// update/comment has no membership requirement at all, same as the server.
export default function InitiativeUpdatesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [updates, setUpdates] = useState<InitiativeUpdateEntry[] | null>(null);
  const [viewerIsMember, setViewerIsMember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [openReplyFor, setOpenReplyFor] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session || !id) return;
    setError(null);
    Promise.all([getInitiativeUpdates(session.hub.tunnelUrl, session.token, id), getInitiative(session.hub.tunnelUrl, session.token, id)])
      .then(([nextUpdates, initiative]) => {
        setUpdates(nextUpdates);
        setViewerIsMember(initiative.viewerIsMember);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load updates."));
  }, [session, id]);

  useFocusEffect(load);

  async function postUpdate() {
    if (!session || !id || !draft.trim()) return;
    setPosting(true);
    try {
      await postInitiativeUpdate(session.hub.tunnelUrl, session.token, id, draft.trim());
      setDraft('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that update.");
    } finally {
      setPosting(false);
    }
  }

  async function removeUpdate(updateId: string) {
    if (!session) return;
    setDeletingId(updateId);
    try {
      await deleteInitiativeUpdate(session.hub.tunnelUrl, session.token, updateId);
      load();
    } catch {
      // non-critical
    } finally {
      setDeletingId(null);
    }
  }

  async function postReply(updateId: string) {
    if (!session) return;
    const text = replyDrafts[updateId]?.trim();
    if (!text) return;
    try {
      await postUpdateComment(session.hub.tunnelUrl, session.token, updateId, text);
      setReplyDrafts((prev) => ({ ...prev, [updateId]: '' }));
      setOpenReplyFor(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that reply.");
    }
  }

  async function removeComment(commentId: string) {
    if (!session) return;
    setDeletingId(commentId);
    try {
      await deleteUpdateComment(session.hub.tunnelUrl, session.token, commentId);
      load();
    } catch {
      // non-critical
    } finally {
      setDeletingId(null);
    }
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Updates" />

      {updates === null && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {updates !== null && (
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic">
          {viewerIsMember && (
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Share a progress update with the team…"
                placeholderTextColor="#8888"
                multiline
                style={[styles.composerInput, { color: Colors[colorScheme].text }]}
              />
              <Pressable
                style={[styles.postButton, (posting || !draft.trim()) && { opacity: 0.5 }]}
                disabled={posting || !draft.trim()}
                onPress={postUpdate}>
                <ThemedText style={styles.postButtonLabel} lightColor="#fff" darkColor="#fff">
                  {posting ? 'Posting…' : 'Post update'}
                </ThemedText>
              </Pressable>
            </View>
          )}

          {updates.length === 0 && <ThemedText style={styles.empty}>No updates yet — be the first to post one.</ThemedText>}

          {updates.map((update) => (
            <View key={update.id} style={styles.updateBlock}>
              <View style={styles.updateHeaderRow}>
                <View style={styles.updateTextWrap}>
                  <ThemedText style={styles.updateAuthor}>
                    {update.author_name} <ThemedText style={styles.rowMeta}>{timeAgo(update.created_at)}</ThemedText>
                  </ThemedText>
                  <ThemedText style={styles.updateBody}>{update.content}</ThemedText>
                  <Pressable onPress={() => setOpenReplyFor(openReplyFor === update.id ? null : update.id)}>
                    <ThemedText style={styles.replyLink}>Reply</ThemedText>
                  </Pressable>
                </View>
                {update.author_id === session.userId && (
                  <Pressable hitSlop={8} disabled={deletingId === update.id} onPress={() => removeUpdate(update.id)}>
                    <IconSymbol name="trash.fill" size={14} color={Colors[colorScheme].icon} />
                  </Pressable>
                )}
              </View>

              {update.comments.length > 0 && (
                <View style={styles.repliesList}>
                  {update.comments.map((comment) => (
                    <View key={comment.id} style={styles.replyRow}>
                      <View style={styles.updateTextWrap}>
                        <ThemedText style={styles.replyAuthor}>
                          {comment.author_name} <ThemedText style={styles.rowMeta}>{timeAgo(comment.created_at)}</ThemedText>
                        </ThemedText>
                        <ThemedText style={styles.replyBody}>{comment.content}</ThemedText>
                      </View>
                      {comment.author_id === session.userId && (
                        <Pressable hitSlop={8} disabled={deletingId === comment.id} onPress={() => removeComment(comment.id)}>
                          <IconSymbol name="trash.fill" size={12} color={Colors[colorScheme].icon} />
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {openReplyFor === update.id && viewerIsMember && (
                <View style={styles.replyInputRow}>
                  <TextInput
                    autoFocus
                    value={replyDrafts[update.id] ?? ''}
                    onChangeText={(t) => setReplyDrafts((prev) => ({ ...prev, [update.id]: t }))}
                    onSubmitEditing={() => postReply(update.id)}
                    placeholder="Reply..."
                    placeholderTextColor="#8888"
                    style={[styles.replyInput, { color: Colors[colorScheme].text }]}
                  />
                  <Pressable onPress={() => postReply(update.id)}>
                    <ThemedText style={styles.sendLink}>Send</ThemedText>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  spinner: {
    marginTop: 40,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginVertical: 8,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  composer: {
    gap: 8,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  composerInput: {
    fontSize: 14,
    lineHeight: 20,
    minHeight: 60,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#8882',
    textAlignVertical: 'top',
  },
  postButton: {
    height: 40,
    borderRadius: 10,
    backgroundColor: Brand,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    paddingHorizontal: 18,
  },
  postButtonLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  empty: {
    opacity: 0.6,
    fontSize: 13.5,
    marginTop: 32,
    textAlign: 'center',
  },
  updateBlock: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  updateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  updateTextWrap: {
    flex: 1,
    gap: 2,
  },
  updateAuthor: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 11.5,
    opacity: 0.55,
    fontWeight: '400',
  },
  updateBody: {
    fontSize: 14.5,
    lineHeight: 20,
    marginTop: 2,
  },
  replyLink: {
    fontSize: 11.5,
    fontWeight: '600',
    opacity: 0.65,
    marginTop: 4,
  },
  repliesList: {
    marginTop: 10,
    marginLeft: 4,
    paddingLeft: 10,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#8884',
    gap: 8,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  replyAuthor: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  replyBody: {
    fontSize: 12.5,
  },
  replyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginLeft: 4,
  },
  replyInput: {
    flex: 1,
    fontSize: 12.5,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#8882',
  },
  sendLink: {
    fontSize: 11.5,
    fontWeight: '600',
  },
});
