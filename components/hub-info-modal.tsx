import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { HubIcon, HubLetterFallback } from '@/components/hub-icon';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getHubInfo, type HubInfo } from '@/lib/api/hubService';
import type { HubSummary } from '@/lib/session/types';

/**
 * Tapping the hub name anywhere it's shown as a header opens this -- icon,
 * description, and a QR code carrying whatever address this session is
 * actually using to reach the hub (hub.tunnelUrl, already either a plain
 * http://LAN-address for a local connection or the https://public tunnel
 * for a web one -- see isLocalConnection in app/(tabs)/index.tsx). Lets
 * another member scan it to join over the same path, instead of reading a
 * URL off screen or typing it manually.
 */
export function HubInfoModal({
  visible,
  onClose,
  hub,
  isLocalConnection,
}: {
  visible: boolean;
  onClose: () => void;
  hub: HubSummary;
  isLocalConnection: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const [info, setInfo] = useState<HubInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError(null);
    getHubInfo(hub.tunnelUrl)
      .then((result) => {
        if (!cancelled) setInfo(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load hub info.");
      });
    return () => {
      cancelled = true;
    };
  }, [visible, hub.tunnelUrl]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: Colors[colorScheme].background }]}>
          <HubIcon
            hub={info}
            tunnelUrl={hub.tunnelUrl}
            size={72}
            style={styles.icon}
            fallback={<HubLetterFallback letter={hub.name.charAt(0).toUpperCase()} size={72} />}
          />
          <ThemedText type="title" style={styles.name} numberOfLines={1}>
            {hub.name}
          </ThemedText>
          {info?.description ? <ThemedText style={styles.description}>{info.description}</ThemedText> : null}
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <View style={styles.qrWrap}>
            {info || error ? (
              <QRCode value={hub.tunnelUrl} size={180} backgroundColor="#fff" color="#000" />
            ) : (
              <ActivityIndicator style={{ height: 180 }} />
            )}
          </View>
          <ThemedText style={styles.qrCaption}>
            {isLocalConnection ? 'Local network address — scan on the same WiFi' : 'Web address'}
          </ThemedText>
          <ThemedText style={styles.qrUrl} numberOfLines={1}>
            {hub.tunnelUrl}
          </ThemedText>

          {/* citinet.cloud/?hub=<slug> -- the web portal (citinet-web's
              subdomain.ts getHubUrl()). Just a different client than this
              app, not a different path to the hub -- it makes the exact
              same direct fetch to hub.tunnelUrl under the hood, so it's
              only actually reachable under the same conditions this app's
              own connection is (see isLocalConnection's doc comment). */}
          <Pressable onPress={() => Linking.openURL(`https://citinet.cloud/?hub=${encodeURIComponent(hub.slug)}`)} style={styles.openBrowserLink}>
            <ThemedText style={[styles.openBrowserLabel, { color: Brand }]}>Open in browser</ThemedText>
          </Pressable>

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
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  icon: {
    marginBottom: 12,
  },
  name: {
    fontSize: 20,
    marginBottom: 6,
  },
  description: {
    textAlign: 'center',
    opacity: 0.7,
    fontSize: 14,
    marginBottom: 16,
  },
  error: {
    color: '#b0392f',
    fontSize: 13,
    marginBottom: 12,
  },
  qrWrap: {
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    marginTop: 4,
  },
  qrCaption: {
    marginTop: 14,
    fontSize: 12,
    opacity: 0.6,
    textAlign: 'center',
  },
  qrUrl: {
    marginTop: 2,
    fontSize: 12,
    opacity: 0.5,
    maxWidth: '100%',
  },
  openBrowserLink: {
    marginTop: 16,
    paddingVertical: 4,
  },
  openBrowserLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  doneButton: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
});
