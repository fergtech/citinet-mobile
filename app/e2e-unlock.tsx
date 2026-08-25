import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { BrandGradient } from '@/components/brand-gradient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useE2EKeys } from '@/lib/crypto/e2e-context';

// Unlocking derives a key via Argon2id — memory-hard by design (that's what
// makes the passphrase resistant to brute-forcing), which in pure JS with no
// native/SIMD acceleration can genuinely take anywhere from several seconds
// to over a minute on a phone. Real progress + honest copy here so that
// looks like "working" rather than "hung" — a bare spinner was getting
// reported as a hang even though the derivation does complete.
const SLOW_DEVICE_HINT_MS = 15_000;

export default function E2EUnlockScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { restore } = useE2EKeys();
  const [passphrase, setPassphrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showSlowHint, setShowSlowHint] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlock() {
    if (!passphrase.trim()) return;
    setSubmitting(true);
    setProgress(0);
    setShowSlowHint(false);
    setError(null);
    // Let the "submitting" state (disabled input, spinner) actually paint
    // before the heavy synchronous-ish derivation work below begins —
    // otherwise the UI can freeze mid-frame, before ever showing it started.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const slowHintTimer = setTimeout(() => setShowSlowHint(true), SLOW_DEVICE_HINT_MS);
    try {
      const ok = await restore(passphrase.trim(), setProgress);
      if (ok) {
        router.back();
      } else {
        setError("That passphrase didn't work. Check it and try again.");
      }
    } finally {
      clearTimeout(slowHintTimer);
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>
          Unlock your messages
        </ThemedText>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close" accessibilityRole="button">
          <IconSymbol name="xmark" size={22} color={Colors[colorScheme].text} />
        </Pressable>
      </View>

      <ThemedText style={styles.body}>
        Your encrypted messages are protected by a recovery phrase set up elsewhere (like the web portal) — enter it
        here to read and send them on this device too.
      </ThemedText>

      <TextInput
        value={passphrase}
        onChangeText={setPassphrase}
        placeholder="word-word-word-word-word-word-word"
        placeholderTextColor={Colors[colorScheme].icon}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: Colors[colorScheme].text, borderColor: Colors[colorScheme].icon }]}
      />

      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {submitting && (
        <ThemedText style={styles.progressHint}>
          {showSlowHint
            ? "Still working — this step is CPU-intensive and can take up to a minute or two on some phones. Keep this screen open."
            : 'Deriving your key…'}
          {progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}
        </ThemedText>
      )}

      <Pressable
        onPress={handleUnlock}
        disabled={submitting || !passphrase.trim()}
        style={[styles.button, { opacity: submitting || !passphrase.trim() ? 0.5 : 1 }]}>
        <BrandGradient style={styles.buttonFill}>
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.buttonLabel} lightColor="#fff" darkColor="#fff">
              Unlock
            </ThemedText>
          )}
        </BrandGradient>
      </Pressable>
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
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
  },
  body: {
    opacity: 0.7,
    lineHeight: 21,
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  error: {
    color: '#b0392f',
    marginBottom: 12,
  },
  progressHint: {
    opacity: 0.6,
    fontSize: 12.5,
    lineHeight: 17,
    marginBottom: 12,
  },
  button: {
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
  },
  buttonFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
