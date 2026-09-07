import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createPostOrQueue } from '@/lib/api/write-queue';
import { useSession } from '@/lib/session/session-context';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// A hub-wide vote — like Event, just a flavor of post (category: 'POLL' on
// hub_posts, same POST /api/posts, see real handler in api/server.js) that
// gets its own dedicated screen rather than living as a chip bolted onto the
// generic composer (see app/modal.tsx's own comment on that split, and
// event-editor.tsx for the sibling this mirrors). compose-post.tsx's own
// "Poll" attachment chip routes here too (replacing itself, not pushing —
// a poll IS the whole post, there's no caption underneath it to carry over)
// since a poll and a plain post aren't the same form with an extra field,
// they're two different hub_posts categories with different required shapes.
//
// request_id (mod-only: linking a poll to a governance feature request so it
// can auto-approve one on close) is real on the server but deliberately
// left out here — this app has no Requests feature/list to link one from at
// all, unlike citinet web's own ComposePollModal.
export default function PollEditorScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromComposeLauncher = from === 'compose';

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [closesAt, setClosesAt] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showGovernance, setShowGovernance] = useState(false);
  const [quorumPct, setQuorumPct] = useState(0);
  const [passPct, setPassPct] = useState(50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validOptions = options.map((o) => o.trim()).filter(Boolean);
  const canPost = !!session && !saving && !!question.trim() && validOptions.length >= MIN_OPTIONS;

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function addOption() {
    setOptions((prev) => (prev.length < MAX_OPTIONS ? [...prev, ''] : prev));
  }

  function removeOption(index: number) {
    setOptions((prev) => (prev.length > MIN_OPTIONS ? prev.filter((_, i) => i !== index) : prev));
  }

  function onChangeDate(_event: DateTimePickerEvent, selected?: Date) {
    setShowDatePicker(Platform.OS === 'ios');
    if (!selected) return;
    setClosesAt((prev) => {
      const next = new Date(prev ?? selected);
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      return next;
    });
  }

  function onChangeTime(_event: DateTimePickerEvent, selected?: Date) {
    setShowTimePicker(Platform.OS === 'ios');
    if (!selected) return;
    setClosesAt((prev) => {
      const next = new Date(prev ?? selected);
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      return next;
    });
  }

  function handleAddCloseDate() {
    // Same "tomorrow" default as event-editor.tsx's defaultEventDate — a
    // plausible starting point rather than "closes this instant".
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    setClosesAt(d);
    setShowDatePicker(true);
  }

  function handleClearCloseDate() {
    setClosesAt(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
  }

  async function handlePost() {
    if (!canPost || !session) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createPostOrQueue(session.hub.tunnelUrl, session.token, {
        category: 'POLL',
        title: question.trim(),
        options: validOptions,
        closes_at: closesAt?.toISOString(),
        quorum_pct: quorumPct,
        pass_pct: passPct,
      });
      if (result.queued) {
        // Couldn't reach the hub — same "will send once it's back" treatment
        // as compose-post.tsx/event-editor.tsx's own createPostOrQueue handling.
        Alert.alert('Saved to send later', "You're offline or the hub is unreachable — this poll will post automatically once it's back.", [
          { text: 'OK', onPress: () => (fromComposeLauncher ? router.dismiss(2) : router.back()) },
        ]);
        return;
      }
      if (fromComposeLauncher) {
        // Pop both this editor and app/modal.tsx's launcher in one go, then
        // land on the poll just created — same convention as Event/Atlas/Marketplace.
        router.dismiss(2);
        router.push({ pathname: '/post/[id]', params: { id: result.post.id } });
        return;
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that poll.");
      setSaving(false);
    }
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={styles.cancel}>Cancel</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          New poll
        </ThemedText>
        <Pressable onPress={handlePost} disabled={!canPost} style={[styles.postButton, { opacity: canPost ? 1 : 0.4 }]}>
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <ThemedText style={styles.postLabel} lightColor="#fff" darkColor="#fff">
              Post
            </ThemedText>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic">
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <ThemedText style={styles.sectionLabel}>Question</ThemedText>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="What should the community decide?"
          placeholderTextColor={Colors[colorScheme].icon}
          multiline
          maxLength={300}
          style={[styles.textarea, { color: Colors[colorScheme].text }]}
        />

        <ThemedText style={styles.sectionLabel}>Options ({MIN_OPTIONS}-{MAX_OPTIONS})</ThemedText>
        {options.map((opt, i) => (
          <View key={i} style={styles.optionRow}>
            <TextInput
              value={opt}
              onChangeText={(v) => updateOption(i, v)}
              placeholder={`Option ${i + 1}`}
              placeholderTextColor={Colors[colorScheme].icon}
              maxLength={120}
              style={[styles.optionInput, { color: Colors[colorScheme].text }]}
            />
            {options.length > MIN_OPTIONS && (
              <Pressable onPress={() => removeOption(i)} hitSlop={8} style={styles.optionRemove} accessibilityLabel={`Remove option ${i + 1}`}>
                <IconSymbol name="xmark" size={14} color={Colors[colorScheme].icon} />
              </Pressable>
            )}
          </View>
        ))}
        {options.length < MAX_OPTIONS && (
          <Pressable onPress={addOption} style={styles.addOptionRow}>
            <IconSymbol name="plus" size={14} color={Brand} />
            <ThemedText style={[styles.addOptionLabel, { color: Brand }]}>Add option</ThemedText>
          </Pressable>
        )}

        <ThemedText style={styles.sectionLabel}>Close date</ThemedText>
        {closesAt ? (
          <>
            <View style={styles.dateTimeRow}>
              <Pressable
                onPress={() => setShowDatePicker(true)}
                style={[styles.dateTimeChip, { backgroundColor: colorScheme === 'dark' ? '#2c2c2e' : '#eef0f3' }]}>
                <IconSymbol name="calendar" size={15} color={colorScheme === 'dark' ? '#fff' : '#11181C'} />
                <ThemedText style={styles.dateTimeLabel} lightColor="#11181C" darkColor="#fff">
                  {formatDate(closesAt)}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setShowTimePicker(true)}
                style={[styles.dateTimeChip, { backgroundColor: colorScheme === 'dark' ? '#2c2c2e' : '#eef0f3' }]}>
                <IconSymbol name="clock.fill" size={15} color={colorScheme === 'dark' ? '#fff' : '#11181C'} />
                <ThemedText style={styles.dateTimeLabel} lightColor="#11181C" darkColor="#fff">
                  {formatTime(closesAt)}
                </ThemedText>
              </Pressable>
              <Pressable onPress={handleClearCloseDate} hitSlop={8} style={styles.dateClearButton} accessibilityLabel="Remove close date">
                <IconSymbol name="xmark" size={14} color={Colors[colorScheme].icon} />
              </Pressable>
            </View>
            {/* display="spinner" (not "inline") for the same reason as
                event-editor.tsx's own picker — the inline day-cell text
                ignores textColor/themeVariant entirely on iOS. */}
            {(showDatePicker || showTimePicker) && (
              <View style={styles.pickerCard}>
                {showDatePicker && (
                  <DateTimePicker
                    value={closesAt}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant="dark"
                    onChange={onChangeDate}
                  />
                )}
                {showTimePicker && (
                  <DateTimePicker
                    value={closesAt}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant="dark"
                    onChange={onChangeTime}
                  />
                )}
              </View>
            )}
            {Platform.OS === 'ios' && (showDatePicker || showTimePicker) && (
              <Pressable
                onPress={() => {
                  setShowDatePicker(false);
                  setShowTimePicker(false);
                }}
                style={styles.doneButton}>
                <ThemedText style={[styles.doneLabel, { color: Brand }]}>Done</ThemedText>
              </Pressable>
            )}
          </>
        ) : (
          <Pressable onPress={handleAddCloseDate} style={styles.addCloseDateRow}>
            <IconSymbol name="calendar" size={15} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.addCloseDateLabel}>Set a close date (optional)</ThemedText>
          </Pressable>
        )}

        {/* Governance controls — quorum/pass-threshold are formal
            decision-making knobs, not something a casual poll needs, so
            they stay collapsed by default (same reasoning/UX as citinet
            web's own "Governance options" section). */}
        <Pressable onPress={() => setShowGovernance((v) => !v)} style={styles.governanceToggle}>
          <IconSymbol name={showGovernance ? 'chevron.down' : 'chevron.right'} size={13} color={Colors[colorScheme].icon} />
          <ThemedText style={styles.governanceToggleLabel}>Governance options</ThemedText>
        </Pressable>
        {showGovernance && (
          <View style={styles.governanceRow}>
            <View style={styles.governanceField}>
              <ThemedText style={styles.governanceLabel}>Quorum (%)</ThemedText>
              <TextInput
                value={String(quorumPct)}
                onChangeText={(v) => setQuorumPct(Math.min(100, Math.max(0, parseInt(v, 10) || 0)))}
                keyboardType="number-pad"
                style={[styles.governanceInput, { color: Colors[colorScheme].text }]}
              />
              <ThemedText style={styles.governanceHint}>0 = no quorum</ThemedText>
            </View>
            <View style={styles.governanceField}>
              <ThemedText style={styles.governanceLabel}>Pass threshold (%)</ThemedText>
              <TextInput
                value={String(passPct)}
                onChangeText={(v) => setPassPct(Math.min(100, Math.max(1, parseInt(v, 10) || 50)))}
                keyboardType="number-pad"
                style={[styles.governanceInput, { color: Colors[colorScheme].text }]}
              />
              <ThemedText style={styles.governanceHint}>of votes cast</ThemedText>
            </View>
          </View>
        )}
      </ScrollView>
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
    gap: 10,
  },
  cancel: {
    fontSize: 15,
    opacity: 0.7,
  },
  headerTitle: {
    fontSize: 16,
  },
  postButton: {
    backgroundColor: Brand,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  postLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  error: {
    color: '#b0392f',
    fontSize: 13,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  textarea: {
    fontSize: 16,
    lineHeight: 22,
    minHeight: 64,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  optionInput: {
    flex: 1,
    fontSize: 15,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  optionRemove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8881',
  },
  addOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  addOptionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  dateTimeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  dateTimeLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  dateClearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8881',
  },
  addCloseDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8884',
    borderStyle: 'dashed',
  },
  addCloseDateLabel: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.8,
  },
  // #1c1c1e matches iOS's own system dark grouped-background color, same as
  // event-editor.tsx's own pickerCard.
  pickerCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 4,
  },
  doneButton: {
    alignSelf: 'flex-end',
    paddingVertical: 10,
  },
  doneLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  governanceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
  },
  governanceToggleLabel: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.7,
  },
  governanceRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 12,
  },
  governanceField: {
    flex: 1,
  },
  governanceLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    opacity: 0.6,
    marginBottom: 6,
  },
  governanceInput: {
    fontSize: 15,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  governanceHint: {
    fontSize: 11,
    opacity: 0.5,
    marginTop: 4,
  },
});
