import { useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { AuthBackground } from '@/components/auth-background';
import { BrandGradient } from '@/components/brand-gradient';
import { HubIcon, HubLetterFallback } from '@/components/hub-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/lib/session/session-context';

export default function LoginScreen() {
  const {
    hubId,
    hubSlug,
    hubName,
    tunnelUrl,
    location,
    hubIconMode,
    hubIconSymbol,
    hubIconBgMode,
    hubIconGradientFrom,
    hubIconGradientTo,
    hubIconSolidColor,
    hubIconImageFileName,
  } = useLocalSearchParams<{
    hubId: string;
    hubSlug: string;
    hubName: string;
    tunnelUrl: string;
    location: string;
    hubIconMode: string;
    hubIconSymbol: string;
    hubIconBgMode: string;
    hubIconGradientFrom: string;
    hubIconGradientTo: string;
    hubIconSolidColor: string;
    hubIconImageFileName: string;
  }>();
  const colorScheme = useColorScheme() ?? 'light';
  const { signIn } = useSession();

  const hubIcon = {
    hub_icon_mode: hubIconMode,
    hub_icon_symbol: hubIconSymbol,
    hub_icon_bg_mode: hubIconBgMode,
    hub_icon_gradient_from: hubIconGradientFrom,
    hub_icon_gradient_to: hubIconGradientTo,
    hub_icon_solid_color: hubIconSolidColor,
    hub_icon_image_file_name: hubIconImageFileName,
  };

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!username || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await signIn({ id: hubId, slug: hubSlug, name: hubName, tunnelUrl, location: location || undefined }, { username, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedView style={[styles.container, styles.transparentBg]}>
        <AuthBackground />
        {/* Dismisses the keyboard on any tap that isn't itself a touchable
            (the fields, the button) — there's no ScrollView here to get this
            for free the way most other screens' default keyboardShouldPersistTaps
            behavior does. */}
        <Pressable style={styles.tapToDismiss} onPress={Keyboard.dismiss}>
      {/* A card, not edge-to-edge, because the content underneath is a moving
          video, not the app's own themed background — inputs/text need a
          stable, opaque-enough surface to stay legible over arbitrary footage. */}
      <View style={[styles.card, { backgroundColor: colorScheme === 'dark' ? 'rgba(21,23,24,0.82)' : 'rgba(255,255,255,0.88)' }]}>
        <View style={styles.identity}>
          <HubIcon
            hub={hubIcon}
            tunnelUrl={tunnelUrl}
            size={44}
            style={styles.hubIcon}
            fallback={<HubLetterFallback letter={hubName?.charAt(0).toUpperCase() ?? '?'} size={44} />}
          />
          <ThemedText type="title" style={[styles.heading, styles.centerText]}>
            Log in to {hubName}
          </ThemedText>
          <ThemedText style={[styles.subheading, styles.centerText]}>Enter your account for this hub.</ThemedText>
        </View>

        <ThemedText style={styles.label}>Username</ThemedText>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="username"
          placeholderTextColor={Colors[colorScheme].icon}
          style={[styles.input, { color: Colors[colorScheme].text }]}
        />

        <ThemedText style={styles.label}>Password</ThemedText>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="password"
          placeholderTextColor={Colors[colorScheme].icon}
          style={[styles.input, { color: Colors[colorScheme].text }]}
        />

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <Pressable
          onPress={handleSubmit}
          disabled={submitting || !username || !password}
          style={[styles.button, { opacity: submitting || !username || !password ? 0.5 : 1 }]}>
          <BrandGradient style={styles.buttonFill}>
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText style={styles.buttonLabel} lightColor="#fff" darkColor="#fff">
                Log in
              </ThemedText>
            )}
          </BrandGradient>
        </Pressable>
      </View>
        </Pressable>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  transparentBg: {
    backgroundColor: 'transparent',
  },
  tapToDismiss: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    borderRadius: 20,
    padding: 20,
  },
  identity: {
    alignItems: 'center',
    marginBottom: 6,
  },
  hubIcon: {
    marginBottom: 10,
  },
  centerText: {
    textAlign: 'center',
  },
  heading: {
    marginBottom: 4,
  },
  subheading: {
    marginBottom: 24,
    opacity: 0.7,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 18,
  },
  error: {
    color: '#b0392f',
    marginBottom: 12,
  },
  button: {
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
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
