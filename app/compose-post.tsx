import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BrandGradient } from '@/components/brand-gradient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/lib/session/session-context';

// Post-specific attachment types — these modify what the post becomes
// (Photos, a Poll, ...), they aren't peers of "Drop a pin" or "Sell or give
// something" anymore. Those two are independent, fully real features with
// their own data models, not flavors of a post, so they moved out to
// app/modal.tsx's top-level launcher list — this screen is reached only via
// its "Write a post" row (or a pre-filled deep link, e.g. Atlas's "Share to
// hub feed"). None of these attachment chips are wired yet, same as before.
const ATTACHMENTS = [
  { icon: 'photo', label: 'Photos' },
  { icon: 'list.bullet', label: 'Poll' },
  { icon: 'calendar', label: 'Event' },
  { icon: 'shippingbox.fill', label: 'Resource' },
] as const;

export default function ComposePostScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  // Incoming pre-fill, e.g. from Atlas's "Share to hub feed" — a real prop of
  // this screen even though posting itself isn't wired up yet.
  const { text: prefillText } = useLocalSearchParams<{ text?: string }>();
  const [text, setText] = useState(prefillText ?? '');

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={styles.cancel}>Cancel</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          New post
        </ThemedText>
        <BrandGradient style={[styles.postButton, { opacity: 0.4 }]}>
          <ThemedText style={styles.postButtonLabel} lightColor="#fff" darkColor="#fff">
            Post
          </ThemedText>
        </BrandGradient>
      </View>

      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder={session ? `Share something with ${session.hub.name}…` : 'Share something…'}
        placeholderTextColor={Colors[colorScheme].icon}
        style={[styles.composer, { color: Colors[colorScheme].text }]}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attachmentRow}>
        {ATTACHMENTS.map((attachment) => (
          <Pressable key={attachment.label} disabled style={styles.attachmentChip}>
            <IconSymbol name={attachment.icon} size={16} color={Colors[colorScheme].tint} />
            <ThemedText style={styles.attachmentLabel}>{attachment.label}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      <ThemedText style={styles.footnote}>
        Composing isn&apos;t wired up yet — coming in a later pass.
      </ThemedText>
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
  },
  postButtonLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  composer: {
    fontSize: 17,
    lineHeight: 24,
    minHeight: 140,
    textAlignVertical: 'top',
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
