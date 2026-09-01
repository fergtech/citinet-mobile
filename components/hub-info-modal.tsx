import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { HubIcon, HubLetterFallback } from '@/components/hub-icon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getHubInfo, type HubInfo } from '@/lib/api/hubService';
import type { HubSummary, StoredSession } from '@/lib/session/types';

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
  otherSessions,
  onSwitchHub,
}: {
  visible: boolean;
  onClose: () => void;
  hub: HubSummary;
  isLocalConnection: boolean;
  /** Other hubs this device is already signed into (excludes `hub` itself) —
   *  renders as a "You're also signed into" switcher when non-empty. */
  otherSessions: StoredSession[];
  onSwitchHub: (slug: string) => void;
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

          {/* Every other hub this device already has a saved, valid session
              for — tapping one swaps the active hub instantly (session-
              context.tsx's switchToHub), no re-authentication, no network
              call. Mirrors citinet-web's HubLayout "You're also signed
              into" list. */}
          {otherSessions.length > 0 && (
            <View style={styles.switcherSection}>
              <ThemedText style={[styles.switcherLabel, { color: Colors[colorScheme].icon }]}>
                You&apos;re also signed into
              </ThemedText>
              {otherSessions.map((other) => (
                <Pressable
                  key={other.hub.slug}
                  onPress={() => {
                    onSwitchHub(other.hub.slug);
                    onClose();
                  }}
                  style={styles.switcherRow}>
                  <HubIcon
                    hub={null}
                    tunnelUrl={other.hub.tunnelUrl}
                    size={32}
                    fallback={<HubLetterFallback letter={other.hub.name.charAt(0).toUpperCase()} size={32} />}
                  />
                  <ThemedText style={styles.switcherName} numberOfLines={1}>
                    {other.hub.name}
                  </ThemedText>
                  <IconSymbol name="arrow.left.arrow.right" size={16} color={Colors[colorScheme].icon} />
                </Pressable>
              ))}
            </View>
          )}

          <Pressable
            onPress={() => {
              onClose();
              router.push('/switch-hub');
            }}
            style={styles.switchHubLink}>
            <ThemedText style={[styles.openBrowserLabel, { color: Brand }]}>
              {otherSessions.length > 0 ? 'Sign into another hub' : 'Switch hub'}
            </ThemedText>
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
  switcherSection: {
    width: '100%',
    marginTop: 20,
  },
  switcherLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  switcherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  switcherName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  switchHubLink: {
    marginTop: 8,
    paddingVertical: 4,
  },
  doneButton: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
});
