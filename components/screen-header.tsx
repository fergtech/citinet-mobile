import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function ScreenHeader({
  title,
  onTitlePress,
  rightIcon,
  onRightPress,
  rightAccessibilityLabel,
  rightIcon2,
  onRightPress2,
  rightAccessibilityLabel2,
}: {
  title: string;
  onTitlePress?: () => void;
  // Optional right-side action button (e.g. a "+" to create something on
  // this screen) — omitted entirely by every existing caller, so this stays
  // a plain back+title header everywhere it isn't explicitly asked for.
  rightIcon?: IconSymbolName;
  onRightPress?: () => void;
  rightAccessibilityLabel?: string;
  // A second right-side action, further from the edge (e.g. Files' storage
  // icon alongside its "+" upload) — only app/files/index.tsx passes this;
  // every other caller is unaffected.
  rightIcon2?: IconSymbolName;
  onRightPress2?: () => void;
  rightAccessibilityLabel2?: string;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
        <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
      </Pressable>
      <Pressable
        disabled={!onTitlePress}
        onPress={onTitlePress}
        accessibilityLabel={onTitlePress ? `View members of ${title}` : undefined}
        accessibilityRole={onTitlePress ? 'button' : undefined}
        style={styles.titleButton}>
        <ThemedText type="defaultSemiBold" style={styles.title} numberOfLines={1}>
          {title}
        </ThemedText>
      </Pressable>
      <View style={styles.rightActions}>
        {rightIcon2 && onRightPress2 && (
          <Pressable onPress={onRightPress2} hitSlop={12} accessibilityLabel={rightAccessibilityLabel2} accessibilityRole="button">
            <IconSymbol name={rightIcon2} size={22} color={Colors[colorScheme].text} />
          </Pressable>
        )}
        {rightIcon && onRightPress ? (
          <Pressable onPress={onRightPress} hitSlop={12} accessibilityLabel={rightAccessibilityLabel} accessibilityRole="button">
            <IconSymbol name={rightIcon} size={24} color={Colors[colorScheme].text} />
          </Pressable>
        ) : (
          <View style={styles.rightSpacer} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  title: {
    fontSize: 17,
  },
  titleButton: {
    flex: 1,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  // Reserves the same width a right-side action icon would take, so the
  // title's available space (and thus where it truncates/wraps) doesn't
  // shift between screens that have a right action and ones that don't —
  // same "reserve the space either way" convention used elsewhere in this
  // app (e.g. app/marketplace/vendor/[id].tsx's header).
  rightSpacer: {
    width: 24,
  },
});
