import { Image } from 'expo-image';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const CITINET_URL = 'https://info.citinet.cloud/';

// info.citinet.cloud is a client-rendered SPA -- a plain fetch only ever
// surfaces its title/tagline and nav shell ("Citinet - Community-Owned
// Cloud" / "Citizens' Internet Project"), not the body copy the JS renders
// in a real browser -- so this paragraph isn't lifted from the site. It's
// written from this app's own first-hand knowledge of what a hub actually
// is (initiatives, marketplace, atlas, discussions, events -- see the rest
// of this app), grounded in that verified tagline rather than invented
// marketing copy. "Learn more" below is where the real site's own wording
// takes over.
const ABOUT_TEXT =
  "The internet became global and irrelevant. Citinet makes it local and relevant again.";

// Replaces this app's own hub's info (icon/description/QR — see
// HubInfoModal, still reachable by tapping the hub name on Home) as what
// the drawer's About row opens — that's about the hub you're in, this is
// about Citinet itself, so duplicating hub detail here would just be the
// same information twice. The one hub-specific line here is deliberately
// minimal — which hub you're currently in, not how to reach it.
export function CitinetAboutModal({
  visible,
  onClose,
  hubName,
}: {
  visible: boolean;
  onClose: () => void;
  hubName: string;
}) {
  const colorScheme = useColorScheme() ?? 'light';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: Colors[colorScheme].background }]}>
          {/* Same pale-lavender "C" raster as the app's own home-screen icon
              — the real logo, not the hand-traced vector recreation used
              elsewhere for tintable icons — composited on a dark chip since
              it needs real contrast the sheet's own background (white in
              light mode) can't guarantee. */}
          <View style={styles.logoWrap}>
            <Image source={require('@/assets/images/icon-512x512.png')} style={styles.logo} contentFit="contain" />
          </View>
          <ThemedText type="title" style={styles.name}>
            Citinet
          </ThemedText>
          <ThemedText style={styles.body}>{ABOUT_TEXT}</ThemedText>
          <Pressable onPress={() => Linking.openURL(CITINET_URL)} style={styles.learnMoreLink}>
            <ThemedText style={[styles.learnMoreLabel, { color: Brand }]}>Learn more</ThemedText>
          </Pressable>

          <View style={styles.hubLine}>
            <ThemedText style={styles.hubLineText}>
              {"You're in "}
              <ThemedText style={styles.hubLineName}>{hubName}</ThemedText>
              {', a Citinet hub'}
            </ThemedText>
          </View>

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
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: '#151718',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  logo: {
    width: 46,
    height: 46,
  },
  name: {
    fontSize: 20,
    marginBottom: 10,
  },
  body: {
    textAlign: 'center',
    opacity: 0.8,
    fontSize: 14,
    lineHeight: 20,
  },
  learnMoreLink: {
    marginTop: 12,
    paddingVertical: 4,
  },
  learnMoreLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  hubLine: {
    marginTop: 22,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
    width: '100%',
    alignItems: 'center',
  },
  hubLineText: {
    fontSize: 12,
    opacity: 0.55,
  },
  hubLineName: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.75,
  },
  doneButton: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
});
