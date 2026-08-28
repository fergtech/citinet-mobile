import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { HubIcon, HubLetterFallback } from '@/components/hub-icon';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { RegistryHub } from '@/lib/api/types';

/**
 * Tapping the tiny info icon next to a truncated description in
 * hub-select.tsx's rows opens this -- the full, untruncated description for
 * that one hub. All the data it needs (name, icon, description) is already
 * on the RegistryHub row itself (registry/mDNS/manual entry all populate
 * these), so unlike HubInfoModal (used post-login, only has a bare
 * HubSummary) this needs no fetch of its own.
 */
export function HubDescriptionSheet({
  visible,
  onClose,
  hub,
}: {
  visible: boolean;
  onClose: () => void;
  hub: RegistryHub | null;
}) {
  const colorScheme = useColorScheme() ?? 'light';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: Colors[colorScheme].background }]}>
          {hub && (
            <>
              <View style={styles.header}>
                <HubIcon
                  hub={hub}
                  tunnelUrl={hub.tunnel_url}
                  size={40}
                  fallback={<HubLetterFallback letter={hub.name.charAt(0).toUpperCase()} size={40} />}
                />
                <ThemedText type="defaultSemiBold" style={styles.name} numberOfLines={1}>
                  {hub.name}
                </ThemedText>
              </View>
              <ThemedText style={styles.description}>{hub.description}</ThemedText>
            </>
          )}
          <Pressable onPress={onClose} style={styles.doneButton}>
            <ThemedText style={{ color: Brand, fontWeight: '600' }}>Done</ThemedText>
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
    padding: 20,
    paddingBottom: 36,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  name: {
    flex: 1,
    fontSize: 16,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.85,
  },
  doneButton: {
    marginTop: 20,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
});
