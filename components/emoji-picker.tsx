import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Same curated, dependency-free set as citinet-web's EmojiPicker.tsx — kept
// in sync deliberately so the picker offers the same emoji on both clients.
const EMOJI_GROUPS: { label: string; emoji: string[] }[] = [
  {
    label: 'Smileys',
    emoji: ['😀', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '😘', '😋', '😛', '🤪', '🤨', '🧐', '😎', '🥳', '😴', '🤔', '🤗', '🙄', '😬', '😳', '🥺', '😢', '😭', '😡', '🤯', '🥶', '🤒', '🤕', '😷'],
  },
  {
    label: 'Gestures',
    emoji: ['👍', '👎', '👏', '🙌', '🙏', '🤝', '👋', '✌️', '🤞', '💪', '🫡', '🤙', '👌', '🫶', '✋', '🖐️', '👊', '🫰'],
  },
  {
    label: 'Hearts',
    emoji: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💕', '💞', '💗', '💖', '💝', '💔'],
  },
  {
    label: 'Nature',
    emoji: ['🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🦁', '🐸', '🐢', '🦋', '🌸', '🌻', '🌳', '🌿', '☀️', '🌙', '⭐', '⚡', '🔥', '🌈', '☔', '❄️'],
  },
  {
    label: 'Food',
    emoji: ['🍕', '🍔', '🌮', '🍜', '🍣', '🍩', '🍪', '🎂', '🍎', '🍓', '🥑', '☕', '🍺', '🍷', '🧉'],
  },
  {
    label: 'Objects',
    emoji: ['🎉', '🎈', '🎁', '🏡', '🚗', '🚲', '🛠️', '📦', '📍', '📅', '💡', '🔔', '📢', '✅', '❌', '⚠️', '💯', '✨'],
  },
];

// A bottom sheet (not a popover — there's no hover on touch, and screen
// space is tight) that stays open across multiple picks, same as a native
// emoji keyboard; the caller closes it explicitly (backdrop tap or the X).
export function EmojiPickerSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const [activeGroup, setActiveGroup] = useState(0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: Colors[colorScheme].background }]}>
          <View style={styles.header}>
            <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
              Emoji
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close" accessibilityRole="button">
              <IconSymbol name="xmark" size={18} color={Colors[colorScheme].icon} />
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {EMOJI_GROUPS.map((g, i) => {
              const active = activeGroup === i;
              return (
                <Pressable
                  key={g.label}
                  onPress={() => setActiveGroup(i)}
                  style={[styles.tab, active && { backgroundColor: Brand + '1f' }]}>
                  <ThemedText style={[styles.tabLabel, active && { color: Brand, fontWeight: '600' }]}>{g.label}</ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.grid}>
            {EMOJI_GROUPS[activeGroup].emoji.map((emoji) => (
              <Pressable key={emoji} onPress={() => onSelect(emoji)} style={styles.emojiButton} hitSlop={2}>
                <ThemedText style={styles.emoji}>{emoji}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 14,
    paddingBottom: 24,
    maxHeight: '62%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 15.5,
  },
  tabs: {
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  tabLabel: {
    fontSize: 12.5,
    opacity: 0.75,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  emojiButton: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 24,
  },
});
