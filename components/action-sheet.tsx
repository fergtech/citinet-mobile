import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ActionSheetOption = {
  key: string;
  label: string;
  icon?: IconSymbolName;
  destructive?: boolean;
  onPress: () => void;
};

// Generic bottom-sheet action menu — the "..." menu on profile/post/listing
// screens (report, block, etc). Not Alert.alert: multi-button Alert.alert
// silently no-ops on React Native Web (see lib/ui/confirm.ts), and this app
// runs there too.
export function ActionSheet({
  visible,
  onClose,
  options,
}: {
  visible: boolean;
  onClose: () => void;
  options: ActionSheetOption[];
}) {
  const colorScheme = useColorScheme() ?? 'light';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* onPress={() => {}} stops the tap from reaching the backdrop Pressable behind it */}
        <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: Colors[colorScheme].background }]}>
          {options.map((opt) => (
            <Pressable
              key={opt.key}
              onPress={() => {
                onClose();
                opt.onPress();
              }}
              style={styles.row}>
              {opt.icon && (
                <IconSymbol name={opt.icon} size={18} color={opt.destructive ? '#b0392f' : Colors[colorScheme].text} />
              )}
              <ThemedText style={[styles.rowLabel, opt.destructive && styles.destructiveLabel]}>{opt.label}</ThemedText>
            </Pressable>
          ))}
          <View style={[styles.divider, { backgroundColor: Colors[colorScheme].icon + '22' }]} />
          <Pressable onPress={onClose} style={styles.row}>
            <ThemedText style={styles.rowLabel}>Cancel</ThemedText>
          </Pressable>
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
    paddingTop: 8,
    paddingBottom: 36,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  rowLabel: {
    fontSize: 15.5,
  },
  destructiveLabel: {
    color: '#b0392f',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
});
