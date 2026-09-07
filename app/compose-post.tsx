import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ActionSheet } from '@/components/action-sheet';
import { BrandGradient } from '@/components/brand-gradient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { prepareImageForUpload } from '@/lib/media/prepare-image-upload';
import { useSession } from '@/lib/session/session-context';
import { createPostOrQueue } from '@/lib/api/write-queue';

// Post-specific attachment types — these modify what the post becomes
// (Media, a Poll, ...), they aren't peers of "Drop a pin" or "Sell or give
// something" anymore. Those two are independent, fully real features with
// their own data models, not flavors of a post, so they moved out to
// app/modal.tsx's top-level launcher list — this screen is reached only via
// its "Write a post" row (or a pre-filled deep link, e.g. Atlas's "Share to
// hub feed"). Event/Resource stay disabled placeholders for now.
//
// Poll used to be a third disabled placeholder here too, but a poll isn't
// actually an *attachment* to whatever's typed above (there's no "add a
// poll to this caption" on the real server — it's a wholly separate
// hub_posts category with its own required shape, question instead of
// body, 2-5 options, no media). Tapping it now replaces this screen with
// app/poll-editor.tsx (the same screen app/modal.tsx's own "Create a poll"
// row opens) rather than living inline, for that reason — see
// poll-editor.tsx's own comment.
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

export default function ComposePostScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  // Incoming pre-fill, e.g. from Atlas's "Share to hub feed" — a real prop of
  // this screen even though it's the only entry point without `from`.
  // `from === 'compose'` means this was reached via app/modal.tsx's launcher
  // (Tabs → /modal → here, two levels), same convention as event-editor.tsx/
  // marketplace/editor.tsx — direct entries (share-to-feed links) skip that
  // launcher and pop back to wherever they came from instead.
  const { text: prefillText, from } = useLocalSearchParams<{ text?: string; from?: string }>();
  const fromComposeLauncher = from === 'compose';
  const [text, setText] = useState(prefillText ?? '');
  const [mediaAsset, setMediaAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [showMediaSheet, setShowMediaSheet] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handlePost() {
    if (!session || posting || (!text.trim() && !mediaAsset)) return;
    setPosting(true);
    setError(null);
    try {
      // POST /api/posts takes the picked asset directly as its own multipart
      // `media` part (unlike Atlas/Marketplace, which upload via POST
      // /api/files first and reference the resulting file_name) — see
      // createPost's own comment in lib/api/hubService.ts.
      const result = await createPostOrQueue(session.hub.tunnelUrl, session.token, {
        category: 'DISCUSSION',
        body: text.trim(),
        media: mediaAsset ? { uri: mediaAsset.uri, name: defaultMediaName(mediaAsset), type: defaultMediaType(mediaAsset) } : null,
      });
      if (result.queued) {
        // Couldn't reach the hub (not a real rejection) — same "will send
        // once it's back" treatment citinet web gives this, adapted to a
        // one-off native Alert since this app has no toast/banner system.
        // No post id to land on yet, so this always just closes the
        // composer rather than trying to navigate to a post that doesn't
        // exist server-side yet.
        Alert.alert('Saved to send later', "You're offline or the hub is unreachable — this will post automatically once it's back.", [
          { text: 'OK', onPress: () => (fromComposeLauncher ? router.dismiss(2) : router.back()) },
        ]);
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
      setError(err instanceof Error ? err.message : "Couldn't create that post.");
      setPosting(false);
    }
  }

  const canPost = !!session && !posting && (!!text.trim() || !!mediaAsset);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} disabled={posting} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={[styles.cancel, posting && { opacity: 0.3 }]}>Cancel</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          New post
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

      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        editable={!posting}
        placeholder={session ? `Share something with ${session.hub.name}…` : 'Share something…'}
        placeholderTextColor={Colors[colorScheme].icon}
        style={[styles.composer, { color: Colors[colorScheme].text }]}
      />

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
        <Pressable
          disabled={posting}
          // replace, not push — a poll isn't an addition to whatever's typed
          // above, it's a different post entirely, so this composer's own
          // (abandoned) draft shouldn't linger in the stack behind it. Passes
          // `from` straight through so poll-editor's own dismiss-count logic
          // (fromComposeLauncher) is correct whether this screen was reached
          // via app/modal.tsx's launcher or a direct deep link.
          onPress={() => router.replace({ pathname: '/poll-editor', params: { from } })}
          style={styles.attachmentChip}>
          <IconSymbol name="list.bullet" size={16} color={Colors[colorScheme].tint} />
          <ThemedText style={styles.attachmentLabel}>Poll</ThemedText>
        </Pressable>
        {PENDING_ATTACHMENTS.map((attachment) => (
          <Pressable key={attachment.label} disabled style={styles.attachmentChip}>
            <IconSymbol name={attachment.icon} size={16} color={Colors[colorScheme].tint} />
            <ThemedText style={styles.attachmentLabel}>{attachment.label}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      <ThemedText style={styles.footnote}>
        Events and resources aren&apos;t wired up yet — coming in a later pass.
      </ThemedText>

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
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  error: {
    color: '#b0392f',
    fontSize: 13,
    marginBottom: 12,
  },
  composer: {
    fontSize: 17,
    lineHeight: 24,
    minHeight: 140,
    textAlignVertical: 'top',
  },
  mediaPreviewWrap: {
    marginTop: 4,
    marginBottom: 4,
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
  footnote: {
    marginTop: 20,
    opacity: 0.5,
    fontSize: 12,
    textAlign: 'center',
  },
});
