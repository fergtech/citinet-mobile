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
  addChecklistItem,
  assignTask,
  deleteChecklistItem,
  deleteNoteReply,
  deleteTaskNote,
  getChecklist,
  getInitiative,
  getInitiativeTaskMeta,
  getTaskNotes,
  postTaskNote,
  replyToNote,
  setTaskBlocked,
  unassignTask,
  updateChecklistItem,
  updateTaskStatus,
} from '@/lib/api/hubService';
import { ChecklistItem, Initiative, InitiativeTaskSummary, TaskMeta, TaskNote } from '@/lib/api/types';
import { effectiveTaskStatus, nextTaskStatus, TASK_DISPLAY_STATUS_META } from '@/lib/initiatives/meta';
import { useSession } from '@/lib/session/session-context';
import { timeAgo } from '@/lib/ui/time-ago';

// Status/checklist/notes for a single task. Redesigned (2026-08-26) around
// this app's actual visual language — flat rows + hairline dividers + pill
// buttons, the pattern every other initiatives screen already uses (see
// resources.tsx/roles.tsx) — rather than the boxed "card" sections this
// screen first shipped with, which were an outlier here.
//
// Interactions, all backed by real routes (see hubService.ts):
// - The status pill cycles todo → in-progress → done on tap, but only for a
//   checklist-less task the viewer owns (creator or assignee) and isn't
//   blocked — once a checklist exists the server derives status from it and
//   409s a manual change; blocking is a separate overlay flag, not a status
//   value, so it's its own toggle rather than a 4th pill state.
// - Claim/Release is a single pill that flips between the two: unclaimed
//   shows "Claim this task" (self-assign), and once the viewer is the
//   assignee it becomes "Release this task" (self-unassign). A task claimed
//   by someone else shows neither — matching the server's self-service-only
//   unassign rule.
// - Checklist add/toggle/edit/delete are gated to the task's creator or
//   assignee (assertTaskOwner server-side) — read-only for anyone else, and
//   the "add a step" row only renders for an owner at all.
// - Progress notes are open to any member to post; only your own note or
//   reply can be deleted.
export default function TaskDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();

  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [meta, setMeta] = useState<TaskMeta | undefined>(undefined);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [notes, setNotes] = useState<TaskNote[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newItemText, setNewItemText] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [busyBlocked, setBusyBlocked] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [openReplyFor, setOpenReplyFor] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session || !id || !taskId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getInitiative(session.hub.tunnelUrl, session.token, id),
      getInitiativeTaskMeta(session.hub.tunnelUrl, session.token, id).catch(() => []),
      getChecklist(session.hub.tunnelUrl, session.token, taskId),
      getTaskNotes(session.hub.tunnelUrl, session.token, taskId),
    ])
      .then(([nextInitiative, metaList, nextChecklist, nextNotes]) => {
        setInitiative(nextInitiative);
        setMeta(metaList.find((m) => m.task_id === taskId));
        setChecklist(nextChecklist);
        setNotes(nextNotes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this task."))
      .finally(() => setLoading(false));
  }, [session, id, taskId]);

  useFocusEffect(load);

  if (!session) return null;

  const task: InitiativeTaskSummary | undefined = initiative?.tasks.find((t) => t.id === taskId);
  const ownsTask = !!task && (task.created_by === session.userId || meta?.assignee_user_id === session.userId);
  const total = checklist?.length ?? 0;
  const done = checklist?.filter((i) => i.done).length ?? 0;
  const disp = task ? effectiveTaskStatus(task, meta, checklist) : null;
  const dispMeta = disp ? TASK_DISPLAY_STATUS_META[disp] : null;
  const isAssignedToMe = !!meta?.assignee_user_id && meta.assignee_user_id === session.userId;
  const isUnclaimed = !meta?.assignee_user_id && task?.created_by !== session.userId;
  const canCyclePill = ownsTask && total === 0 && !meta?.blocked;

  async function cyclePill() {
    if (!session || !id || !taskId || !task || !canCyclePill) return;
    setChangingStatus(true);
    try {
      await updateTaskStatus(session.hub.tunnelUrl, session.token, taskId, nextTaskStatus(task.status), id, task.title);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that task's status.");
    } finally {
      setChangingStatus(false);
    }
  }

  async function toggleBlocked() {
    // meta can legitimately be undefined here — GET /:id/task-meta only
    // returns a row once a task has an assignee, due date, blocked flag, or
    // checklist item; a fresh task has none of those yet. Treat a missing
    // row as blocked: false, same as the server's own COALESCE default.
    if (!session || !id || !taskId) return;
    setBusyBlocked(true);
    try {
      await setTaskBlocked(session.hub.tunnelUrl, session.token, taskId, !meta?.blocked, id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that task.");
    } finally {
      setBusyBlocked(false);
    }
  }

  async function claimTask() {
    if (!session || !id || !taskId) return;
    setClaiming(true);
    try {
      await assignTask(session.hub.tunnelUrl, session.token, taskId, id, true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't claim that task.");
    } finally {
      setClaiming(false);
    }
  }

  async function releaseTask() {
    if (!session || !id || !taskId) return;
    setReleasing(true);
    try {
      await unassignTask(session.hub.tunnelUrl, session.token, taskId, id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't release that task.");
    } finally {
      setReleasing(false);
    }
  }

  async function addItem() {
    if (!session || !id || !taskId || !newItemText.trim()) return;
    setAddingItem(true);
    try {
      await addChecklistItem(session.hub.tunnelUrl, session.token, taskId, id, newItemText.trim());
      setNewItemText('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that step.");
    } finally {
      setAddingItem(false);
    }
  }

  async function toggleItem(item: ChecklistItem) {
    if (!session) return;
    setChecklist((prev) => prev?.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) ?? null);
    try {
      await updateChecklistItem(session.hub.tunnelUrl, session.token, item.id, { done: !item.done });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that step.");
      load();
    }
  }

  async function saveItemText(item: ChecklistItem) {
    const text = editingText.trim();
    setEditingItemId(null);
    if (!session || !text || text === item.text) return;
    setChecklist((prev) => prev?.map((i) => (i.id === item.id ? { ...i, text } : i)) ?? null);
    try {
      await updateChecklistItem(session.hub.tunnelUrl, session.token, item.id, { text });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that step.");
      load();
    }
  }

  async function removeItem(item: ChecklistItem) {
    if (!session) return;
    setChecklist((prev) => prev?.filter((i) => i.id !== item.id) ?? null);
    try {
      await deleteChecklistItem(session.hub.tunnelUrl, session.token, item.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that step.");
      load();
    }
  }

  async function postNote() {
    if (!session || !id || !taskId || !draft.trim()) return;
    setPosting(true);
    try {
      await postTaskNote(session.hub.tunnelUrl, session.token, taskId, id, draft.trim());
      setDraft('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that note.");
    } finally {
      setPosting(false);
    }
  }

  async function removeNote(noteId: string) {
    if (!session) return;
    try {
      await deleteTaskNote(session.hub.tunnelUrl, session.token, noteId);
      load();
    } catch {
      // non-critical
    }
  }

  async function postReply(noteId: string) {
    if (!session) return;
    const text = replyDrafts[noteId]?.trim();
    if (!text) return;
    try {
      await replyToNote(session.hub.tunnelUrl, session.token, noteId, text);
      setReplyDrafts((prev) => ({ ...prev, [noteId]: '' }));
      setOpenReplyFor(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that reply.");
    }
  }

  async function removeReply(replyId: string) {
    if (!session) return;
    try {
      await deleteNoteReply(session.hub.tunnelUrl, session.token, replyId);
      load();
    } catch {
      // non-critical
    }
  }

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Task" />

      {loading && !task && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {task && dispMeta && (
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic">
          <ThemedText style={styles.taskTitle}>{task.title}</ThemedText>

          <View style={styles.pillsRow}>
            <Pressable
              disabled={!canCyclePill || changingStatus}
              onPress={cyclePill}
              style={[styles.statusPill, { backgroundColor: dispMeta.color }, !canCyclePill && styles.pillStatic]}>
              <ThemedText style={styles.statusPillLabel} lightColor="#fff" darkColor="#fff">
                {dispMeta.label}
              </ThemedText>
            </Pressable>

            {isAssignedToMe && (
              <Pressable style={[styles.actionPill, releasing && { opacity: 0.6 }]} disabled={releasing} onPress={releaseTask}>
                <IconSymbol name="person.badge.plus" size={13} color={Colors[colorScheme].text} />
                <ThemedText style={styles.actionPillLabel}>{releasing ? 'Releasing…' : 'Release this task'}</ThemedText>
              </Pressable>
            )}
            {isUnclaimed && (
              <Pressable style={[styles.actionPill, claiming && { opacity: 0.6 }]} disabled={claiming} onPress={claimTask}>
                <IconSymbol name="person.badge.plus" size={13} color={Colors[colorScheme].text} />
                <ThemedText style={styles.actionPillLabel}>{claiming ? 'Claiming…' : 'Claim this task'}</ThemedText>
              </Pressable>
            )}

            {ownsTask && (
              <Pressable
                hitSlop={8}
                disabled={busyBlocked}
                onPress={toggleBlocked}
                style={[styles.flagButton, meta?.blocked && styles.flagButtonActive]}
                accessibilityLabel={meta?.blocked ? 'Unblock this task' : 'Flag this task as blocked'}>
                <IconSymbol name="flag.fill" size={13} color={meta?.blocked ? '#fff' : Colors[colorScheme].icon} />
              </Pressable>
            )}
          </View>

          {total > 0 && !meta?.blocked && (
            <ThemedText style={styles.hint}>Status updates automatically as checklist steps are completed.</ThemedText>
          )}

          {!!meta?.assignee_name && (
            <View style={styles.metaRow}>
              <IconSymbol name="person.fill" size={15} color={Colors[colorScheme].icon} />
              <ThemedText style={styles.metaRowLabel}>Assigned to</ThemedText>
              <ThemedText style={styles.metaRowValue}>{meta.assignee_name}</ThemedText>
            </View>
          )}

          {(total > 0 || ownsTask) && (
            <View style={styles.section}>
              <ThemedText style={styles.sectionLabel}>{total > 0 ? `Checklist (${done}/${total})` : 'Checklist'}</ThemedText>
              {checklist === null ? (
                <ActivityIndicator style={styles.inlineSpinner} />
              ) : (
                <>
                  {checklist.map((item) => (
                    <View key={item.id} style={styles.checklistRow}>
                      <Pressable disabled={!ownsTask} onPress={() => toggleItem(item)} hitSlop={8}>
                        <IconSymbol
                          name={item.done ? 'checkmark.square.fill' : 'square'}
                          size={20}
                          color={item.done ? '#059669' : Colors[colorScheme].icon}
                        />
                      </Pressable>
                      {editingItemId === item.id ? (
                        <TextInput
                          autoFocus
                          value={editingText}
                          onChangeText={setEditingText}
                          onBlur={() => saveItemText(item)}
                          onSubmitEditing={() => saveItemText(item)}
                          style={[styles.editInput, { color: Colors[colorScheme].text }]}
                        />
                      ) : (
                        <Pressable
                          style={styles.checklistTextWrap}
                          disabled={!ownsTask}
                          onPress={() => {
                            setEditingItemId(item.id);
                            setEditingText(item.text);
                          }}>
                          <ThemedText style={[styles.checklistText, item.done && styles.checklistTextDone]}>{item.text}</ThemedText>
                        </Pressable>
                      )}
                      {ownsTask && (
                        <Pressable hitSlop={8} onPress={() => removeItem(item)}>
                          <IconSymbol name="trash.fill" size={15} color={Colors[colorScheme].icon} />
                        </Pressable>
                      )}
                    </View>
                  ))}
                  {checklist.length === 0 && <ThemedText style={styles.emptyInline}>No checklist steps yet.</ThemedText>}
                </>
              )}
              {ownsTask && (
                <View style={styles.addRow}>
                  <TextInput
                    value={newItemText}
                    onChangeText={setNewItemText}
                    onSubmitEditing={addItem}
                    placeholder="Add a checklist step..."
                    placeholderTextColor="#8888"
                    style={[styles.addInput, { color: Colors[colorScheme].text }]}
                  />
                  <Pressable
                    style={[styles.addButton, (addingItem || !newItemText.trim()) && { opacity: 0.5 }]}
                    disabled={addingItem || !newItemText.trim()}
                    onPress={addItem}>
                    <ThemedText style={styles.addButtonLabel} lightColor="#fff" darkColor="#fff">
                      Add
                    </ThemedText>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.composer}>
              <IconSymbol name="message.fill" size={15} color={Colors[colorScheme].icon} />
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={postNote}
                returnKeyType="send"
                blurOnSubmit
                placeholder="Post a note or reply..."
                placeholderTextColor="#8888"
                style={[styles.composerInput, { color: Colors[colorScheme].text }]}
              />
              {!!draft.trim() && (
                <Pressable onPress={postNote} disabled={posting} hitSlop={8}>
                  <ThemedText style={styles.composerSend}>{posting ? '…' : 'Post'}</ThemedText>
                </Pressable>
              )}
            </View>

            {notes === null ? (
              <ActivityIndicator style={styles.inlineSpinner} />
            ) : (
              notes.length > 0 && (
                <View style={styles.notesList}>
                  {notes.map((note) => (
                    <View key={note.id} style={styles.noteBlock}>
                      <View style={styles.noteHeaderRow}>
                        <View style={styles.noteTextWrap}>
                          <ThemedText style={styles.noteAuthor}>
                            {note.author_name} <ThemedText style={styles.rowMeta}>{timeAgo(note.created_at)}</ThemedText>
                          </ThemedText>
                          <ThemedText style={styles.noteBody}>{note.content}</ThemedText>
                          <Pressable onPress={() => setOpenReplyFor(openReplyFor === note.id ? null : note.id)}>
                            <ThemedText style={styles.replyLink}>Reply</ThemedText>
                          </Pressable>
                        </View>
                        {note.author_id === session.userId && (
                          <Pressable hitSlop={8} onPress={() => removeNote(note.id)}>
                            <IconSymbol name="trash.fill" size={14} color={Colors[colorScheme].icon} />
                          </Pressable>
                        )}
                      </View>

                      {note.replies.length > 0 && (
                        <View style={styles.repliesList}>
                          {note.replies.map((reply) => (
                            <View key={reply.id} style={styles.replyRow}>
                              <View style={styles.noteTextWrap}>
                                <ThemedText style={styles.replyAuthor}>
                                  {reply.author_name} <ThemedText style={styles.rowMeta}>{timeAgo(reply.created_at)}</ThemedText>
                                </ThemedText>
                                <ThemedText style={styles.replyBody}>{reply.content}</ThemedText>
                              </View>
                              {reply.author_id === session.userId && (
                                <Pressable hitSlop={8} onPress={() => removeReply(reply.id)}>
                                  <IconSymbol name="trash.fill" size={12} color={Colors[colorScheme].icon} />
                                </Pressable>
                              )}
                            </View>
                          ))}
                        </View>
                      )}

                      {openReplyFor === note.id && (
                        <View style={styles.replyInputRow}>
                          <TextInput
                            autoFocus
                            value={replyDrafts[note.id] ?? ''}
                            onChangeText={(t) => setReplyDrafts((prev) => ({ ...prev, [note.id]: t }))}
                            onSubmitEditing={() => postReply(note.id)}
                            placeholder="Reply..."
                            placeholderTextColor="#8888"
                            style={[styles.replyInput, { color: Colors[colorScheme].text }]}
                          />
                          <Pressable onPress={() => postReply(note.id)}>
                            <ThemedText style={styles.sendLink}>Send</ThemedText>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )
            )}
          </View>
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
  inlineSpinner: {
    marginVertical: 12,
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
  taskTitle: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 25,
  },
  pillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  statusPillLabel: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  actionPillLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  pillStatic: {
    opacity: 0.65,
  },
  flagButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8881',
  },
  flagButtonActive: {
    backgroundColor: '#dc2626',
  },
  hint: {
    fontSize: 11,
    opacity: 0.55,
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  metaRowLabel: {
    fontSize: 14,
    flex: 1,
  },
  metaRowValue: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  section: {
    marginTop: 22,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  checklistTextWrap: {
    flex: 1,
  },
  checklistText: {
    fontSize: 14,
  },
  checklistTextDone: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  editInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#8882',
  },
  emptyInline: {
    fontSize: 12.5,
    opacity: 0.55,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  addInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#8882',
  },
  addButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Brand,
  },
  addButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  composerInput: {
    flex: 1,
    fontSize: 14,
  },
  composerSend: {
    fontSize: 13,
    fontWeight: '700',
    color: Brand,
  },
  notesList: {
    marginTop: 16,
    gap: 14,
  },
  noteBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
    paddingTop: 12,
  },
  noteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  noteTextWrap: {
    flex: 1,
    gap: 2,
  },
  noteAuthor: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 11.5,
    opacity: 0.55,
    fontWeight: '400',
  },
  noteBody: {
    fontSize: 14,
    lineHeight: 19,
  },
  replyLink: {
    fontSize: 11.5,
    fontWeight: '600',
    opacity: 0.65,
    marginTop: 2,
  },
  repliesList: {
    marginTop: 8,
    marginLeft: 12,
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
    marginLeft: 12,
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
