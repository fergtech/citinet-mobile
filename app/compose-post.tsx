import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ActionSheet } from '@/components/action-sheet';
import { BrandGradient } from '@/components/brand-gradient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { prepareImageForUpload } from '@/lib/media/prepare-image-upload';
import { useSession } from '@/lib/session/session-context';
import { createPostOrQueue } from '@/lib/api/write-queue';

const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 5;

// Event/Resource stay disabled placeholders — see this screen's own note
// on why Poll isn't one of these anymore.
const PENDING_ATTACHMENTS = [
  { icon: 'calendar', label: 'Event' },
  { icon: 'shippingbox.fill', label: 'Resource' },
] as const;

function defaultMediaName(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName) return asset.fileName;
  return asset.type === 'video' ? `post-video-${Date.now()}.mp4` : `post-photo-${Date.now()}.jpg`;
}

function defaultMediaType(asset: ImagePicker.ImagePickerAsset): string {
  return asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// One form, not two screens — mirrors citinet web's own InlineComposer
// (Feed.tsx): `text` and `mediaAsset` below are shared across post/poll mode
// rather than each mode owning its own copy, which is the entire mechanism
// behind "start typing, then tap Poll, and what you typed is still there" —
// switching `mode` only changes which extra fields render underneath the
// same caption field and the same media attachment, it never resets either.
// Media works for polls too for the same reason: it was never post-only
// state to begin with, and the real server (POST /api/posts, multer
// upload.single('media')) attaches it before it even looks at `category`.
//
// This used to route away to a separate app/poll-editor.tsx screen instead
// (replacing itself via router.replace) — which is exactly what threw the
// typed caption away on the mode switch. That screen's gone now; this is
// the one real implementation, reached both from here and from
// app/modal.tsx's "Create a poll" row (via the `mode` param below).
type ComposeMode = 'post' | 'poll';

export default function ComposePostScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  // Incoming pre-fill, e.g. from Atlas's "Share to hub feed" — a real prop of
  // this screen even though it's the only entry point without `from`.
  // `from === 'compose'` means this was reached via app/modal.tsx's launcher
  // (Tabs → /modal → here, two levels), same convention as event-editor.tsx/
  // marketplace/editor.tsx — direct entries (share-to-feed links) skip that
  // launcher and pop back to wherever they came from instead. `mode=poll` is
  // how modal.tsx's own "Create a poll" row opens straight into poll mode.
  const { text: prefillText, from, mode: initialMode } = useLocalSearchParams<{ text?: string; from?: string; mode?: string }>();
  const fromComposeLauncher = from === 'compose';
  const [mode, setMode] = useState<ComposeMode>(initialMode === 'poll' ? 'poll' : 'post');
  const [text, setText] = useState(prefillText ?? '');
  const [mediaAsset, setMediaAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [showMediaSheet, setShowMediaSheet] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll-only fields — cleared on switchToPost, but text/mediaAsset above
  // deliberately aren't (see this screen's own top comment).
  const [options, setOptions] = useState(['', '']);
  const [closesAt, setClosesAt] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showGovernance, setShowGovernance] = useState(false);
  const [quorumPct, setQuorumPct] = useState(0);
  const [passPct, setPassPct] = useState(50);

  function switchToPoll() {
    setMode('poll');
    setError(null);
  }

  function switchToPost() {
    setMode('post');
    setError(null);
    setOptions(['', '']);
    setClosesAt(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
    setShowGovernance(false);
    setQuorumPct(0);
    setPassPct(50);
  }

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function addOption() {
    setOptions((prev) => (prev.length < MAX_POLL_OPTIONS ? [...prev, ''] : prev));
  }

  function removeOption(index: number) {
    setOptions((prev) => (prev.length > MIN_POLL_OPTIONS ? prev.filter((_, i) => i !== index) : prev));
  }

  function onChangeCloseDate(_event: DateTimePickerEvent, selected?: Date) {
    setShowDatePicker(Platform.OS === 'ios');
    if (!selected) return;
    setClosesAt((prev) => {
      const next = new Date(prev ?? selected);
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      return next;
    });
  }

  function onChangeCloseTime(_event: DateTimePickerEvent, selected?: Date) {
    setShowTimePicker(Platform.OS === 'ios');
    if (!selected) return;
    setClosesAt((prev) => {
      const next = new Date(prev ?? selected);
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      return next;
    });
  }

  function handleAddCloseDate() {
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

  // Downscales+recompresses a picked photo before it ever becomes the
  // preview/upload asset — see prepare-image-upload.ts's own note on why
  // ImagePicker's `quality` option alone (JPEG re-encoding only, no resize)
  // isn't enough. Videos pass through untouched — not in scope here.
  async function applyImagePrep(asset: ImagePicker.ImagePickerAsset): Promise<ImagePicker.ImagePickerAsset> {
    if (asset.type !== 'image') return asset;
    try {
      const prepped = await prepareImageForUpload(asset.uri, asset.width, asset.height);
      return { ...asset, uri: prepped.uri, width: prepped.width, height: prepped.height };
    } catch {
      return asset; // Fall back to the original pick rather than block posting over it.
    }
  }

  async function handleTakeMedia() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera permission is needed to capture a photo or video.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.7 });
    if (result.canceled) return;
    setMediaAsset(await applyImagePrep(result.assets[0]));
    setError(null);
  }

  async function handlePickMedia() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is needed to attach a photo or video.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.7 });
    if (result.canceled) return;
    setMediaAsset(await applyImagePrep(result.assets[0]));
    setError(null);
  }

  function handleRemoveMedia() {
    setMediaAsset(null);
  }

  const validPollOptions = options.map((o) => o.trim()).filter(Boolean);
  const canPost =
    !!session &&
    !posting &&
    (mode === 'poll' ? !!text.trim() && validPollOptions.length >= MIN_POLL_OPTIONS : !!text.trim() || !!mediaAsset);

  async function handlePost() {
    if (!session || !canPost) return;
    setPosting(true);
    setError(null);
    try {
      // POST /api/posts takes the picked asset directly as its own multipart
      // `media` part (unlike Atlas/Marketplace, which upload via POST
      // /api/files first and reference the resulting file_name) — see
      // createPost's own comment in lib/api/hubService.ts. Works identically
      // for either category; the server attaches it before it even branches
      // on category.
      const media = mediaAsset ? { uri: mediaAsset.uri, name: defaultMediaName(mediaAsset), type: defaultMediaType(mediaAsset) } : null;
      const result =
        mode === 'poll'
          ? await createPostOrQueue(session.hub.tunnelUrl, session.token, {
              category: 'POLL',
              title: text.trim(),
              media,
              options: validPollOptions,
              closes_at: closesAt?.toISOString(),
              quorum_pct: quorumPct,
              pass_pct: passPct,
            })
          : await createPostOrQueue(session.hub.tunnelUrl, session.token, {
              category: 'DISCUSSION',
              body: text.trim(),
              media,
            });
      if (result.queued) {
        // Couldn't reach the hub (not a real rejection) — same "will send
        // once it's back" treatment citinet web gives this, adapted to a
        // one-off native Alert since this app has no toast/banner system.
        // No post id to land on yet, so this always just closes the
        // composer rather than trying to navigate to a post that doesn't
        // exist server-side yet.
        Alert.alert(
          'Saved to send later',
          `You're offline or the hub is unreachable — this ${mode === 'poll' ? 'poll' : 'post'} will send automatically once it's back.`,
          [{ text: 'OK', onPress: () => (fromComposeLauncher ? router.dismiss(2) : router.back()) }]
        );
        return;
      }
      if (fromComposeLauncher) {
        // Pop both this composer and app/modal.tsx's launcher in one go,
        // then land on the post just created — same convention as Atlas/
        // Marketplace/Events.
        router.dismiss(2);
        router.push({ pathname: '/post/[id]', params: { id: result.post.id } });
        return;
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Couldn't create that ${mode === 'poll' ? 'poll' : 'post'}.`);
      setPosting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} disabled={posting} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={[styles.cancel, posting && { opacity: 0.3 }]}>Cancel</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          {mode === 'poll' ? 'New poll' : 'New post'}
        </ThemedText>
        <Pressable onPress={handlePost} disabled={!canPost}>
          <BrandGradient style={[styles.postButton, { opacity: canPost ? 1 : 0.4 }]}>
            {posting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <ThemedText style={styles.postButtonLabel} lightColor="#fff" darkColor="#fff">
                Post
              </ThemedText>
            )}
          </BrandGradient>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="automatic">
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {mode === 'poll' && (
          <View style={styles.pollModeBar}>
            <View style={styles.pollModeIcon}>
              <IconSymbol name="list.bullet" size={14} color={Brand} />
            </View>
            <ThemedText style={styles.pollModeLabel}>Creating a poll</ThemedText>
            {/* Switches back to a plain post rather than fully clearing the
                screen — text/media above are left alone, only the poll-only
                fields below (options/close date/governance) get cleared.
                Slight, deliberate departure from web's own equivalent button
                (which clears everything, mode included) since there's no
                real reason to punish someone for tapping the wrong exit. */}
            <Pressable onPress={switchToPost} disabled={posting} hitSlop={8} accessibilityLabel="Switch back to a plain post">
              <IconSymbol name="xmark" size={14} color={Colors[colorScheme].icon} />
            </Pressable>
          </View>
        )}

        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          editable={!posting}
          placeholder={
            mode === 'poll' ? 'Ask your neighbors something…' : session ? `Share something with ${session.hub.name}…` : 'Share something…'
          }
          placeholderTextColor={Colors[colorScheme].icon}
          style={[styles.composer, mode === 'poll' && styles.composerCompact, { color: Colors[colorScheme].text }]}
        />

        {mode === 'poll' && (
          <>
            <ThemedText style={styles.sectionLabel}>
              Options ({MIN_POLL_OPTIONS}-{MAX_POLL_OPTIONS})
            </ThemedText>
            {options.map((opt, i) => (
              <View key={i} style={styles.optionRow}>
                <TextInput
                  value={opt}
                  onChangeText={(v) => updateOption(i, v)}
                  editable={!posting}
                  placeholder={`Option ${i + 1}`}
                  placeholderTextColor={Colors[colorScheme].icon}
                  maxLength={120}
                  style={[styles.optionInput, { color: Colors[colorScheme].text }]}
                />
                {options.length > MIN_POLL_OPTIONS && (
                  <Pressable onPress={() => removeOption(i)} hitSlop={8} style={styles.optionRemove} accessibilityLabel={`Remove option ${i + 1}`}>
                    <IconSymbol name="xmark" size={14} color={Colors[colorScheme].icon} />
                  </Pressable>
                )}
              </View>
            ))}
            {options.length < MAX_POLL_OPTIONS && (
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
                {/* display="spinner" (not "inline") — the inline day-cell
                    text ignores textColor/themeVariant entirely on iOS, same
                    reasoning as event-editor.tsx's own picker. */}
                {(showDatePicker || showTimePicker) && (
                  <View style={styles.pickerCard}>
                    {showDatePicker && (
                      <DateTimePicker
                        value={closesAt}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        themeVariant="dark"
                        onChange={onChangeCloseDate}
                      />
                    )}
                    {showTimePicker && (
                      <DateTimePicker
                        value={closesAt}
                        mode="time"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        themeVariant="dark"
                        onChange={onChangeCloseTime}
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
          </>
        )}

        {mediaAsset && (
          <View style={styles.mediaPreviewWrap}>
            {mediaAsset.type === 'video' ? (
              <View style={[styles.mediaPreview, styles.videoPreview]}>
                <IconSymbol name="video.fill" size={28} color="#fff" />
                <ThemedText style={styles.videoPreviewLabel} lightColor="#fff" darkColor="#fff">
                  Video attached
                </ThemedText>
              </View>
            ) : (
              <Image source={{ uri: mediaAsset.uri }} style={styles.mediaPreview} contentFit="cover" />
            )}
            {!posting && (
              <Pressable onPress={handleRemoveMedia} hitSlop={8} style={styles.removeMediaButton} accessibilityLabel="Remove media">
                <IconSymbol name="xmark" size={14} color="#fff" />
              </Pressable>
            )}
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attachmentRow}>
          <Pressable
            disabled={posting}
            onPress={() => setShowMediaSheet(true)}
            style={[styles.attachmentChip, !!mediaAsset && { borderColor: Colors[colorScheme].tint }]}>
            <IconSymbol name="camera.fill" size={16} color={Colors[colorScheme].tint} />
            <ThemedText style={styles.attachmentLabel}>{mediaAsset ? 'Change media' : 'Media'}</ThemedText>
          </Pressable>
          {mode === 'post' && (
            <Pressable disabled={posting} onPress={switchToPoll} style={styles.attachmentChip}>
              <IconSymbol name="list.bullet" size={16} color={Colors[colorScheme].tint} />
              <ThemedText style={styles.attachmentLabel}>Poll</ThemedText>
            </Pressable>
          )}
          {mode === 'post' &&
            PENDING_ATTACHMENTS.map((attachment) => (
              <Pressable key={attachment.label} disabled style={styles.attachmentChip}>
                <IconSymbol name={attachment.icon} size={16} color={Colors[colorScheme].tint} />
                <ThemedText style={styles.attachmentLabel}>{attachment.label}</ThemedText>
              </Pressable>
            ))}
        </ScrollView>

        {mode === 'poll' && (
          <>
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
          </>
        )}

        {mode === 'post' && (
          <ThemedText style={styles.footnote}>Events and resources aren&apos;t wired up yet — coming in a later pass.</ThemedText>
        )}
      </ScrollView>

      <ActionSheet
        visible={showMediaSheet}
        onClose={() => setShowMediaSheet(false)}
        options={[
          { key: 'camera', label: 'Take Photo or Video', icon: 'camera.fill', onPress: handleTakeMedia },
          { key: 'library', label: 'Choose from Library', icon: 'photo', onPress: handlePickMedia },
        ]}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  cancel: {
    fontSize: 15,
    opacity: 0.7,
  },
  headerTitle: {
    fontSize: 16,
  },
  postButton: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minWidth: 56,
    alignItems: 'center',
  },
  postButtonLabel: {
    fontSize: 13.5,
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
  pollModeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  pollModeIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand + '1a',
  },
  pollModeLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.8,
  },
  composer: {
    fontSize: 17,
    lineHeight: 24,
    minHeight: 140,
    textAlignVertical: 'top',
  },
  composerCompact: {
    fontSize: 16,
    minHeight: 60,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
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
  mediaPreviewWrap: {
    marginTop: 16,
  },
  mediaPreview: {
    width: '100%',
    height: 200,
    borderRadius: 14,
  },
  videoPreview: {
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  videoPreviewLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  removeMediaButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  attachmentRow: {
    flexGrow: 0,
    marginTop: 16,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
    marginRight: 8,
  },
  attachmentLabel: {
    fontSize: 13,
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
  footnote: {
    marginTop: 20,
    opacity: 0.5,
    fontSize: 12,
    textAlign: 'center',
  },
});
