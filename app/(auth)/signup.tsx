import { useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AuthBackground } from '@/components/auth-background';
import { BrandGradient } from '@/components/brand-gradient';
import { HubIcon, HubLetterFallback } from '@/components/hub-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/lib/session/session-context';

// Mobile equivalent of citinet web's NodeEntryFlow signup step — trimmed to
// what registration actually requires (display name, username, password);
// no email or interest-tags collection here, unlike web's fuller onboarding.
// Same card/AuthBackground chrome as login.tsx, including the same
// backdrop-Pressable-behind-not-wrapping-the-card structure (see login.tsx's
// comment) so the fields stay clickable on web too.
export default function SignupScreen() {
  const { hubId, hubSlug, hubName, tunnelUrl, location, hubIconMode, hubIconSymbol, hubIconBgMode, hubIconGradientFrom, hubIconGradientTo, hubIconSolidColor, hubIconImageFileName } =
    useLocalSearchParams<{
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
  const { signUp } = useSession();

  const hubIcon = {
    hub_icon_mode: hubIconMode,
    hub_icon_symbol: hubIconSymbol,
    hub_icon_bg_mode: hubIconBgMode,
    hub_icon_gradient_from: hubIconGradientFrom,
    hub_icon_gradient_to: hubIconGradientTo,
    hub_icon_solid_color: hubIconSolidColor,
    hub_icon_image_file_name: hubIconImageFileName,
  };

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = displayName.trim().length >= 2 && username.trim().length >= 2 && password.length > 0 && password === confirmPassword;

  async function handleSubmit() {
    if (!canSubmit) {
      if (password !== confirmPassword) setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signUp(
        { id: hubId, slug: hubSlug, name: hubName, tunnelUrl, location: location || undefined },
        { username: username.trim(), password, displayName: displayName.trim() }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedView style={[styles.container, styles.transparentBg]}>
        <AuthBackground />
        <Pressable style={styles.backdrop} onPress={Keyboard.dismiss} />
        <View style={styles.centerWrap} pointerEvents="box-none">
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
                Join {hubName}
              </ThemedText>
              <ThemedText style={[styles.subheading, styles.centerText]}>Create an account for this hub.</ThemedText>
            </View>

            <ThemedText style={styles.label}>Display name</ThemedText>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="How neighbors will see you"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.input, { color: Colors[colorScheme].text }]}
            />

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
              placeholder="At least 10 characters"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.input, { color: Colors[colorScheme].text }]}
            />

            <ThemedText style={styles.label}>Confirm password</ThemedText>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              placeholder="Re-enter your password"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.input, { color: Colors[colorScheme].text }]}
            />

            {error && <ThemedText style={styles.error}>{error}</ThemedText>}

            <Pressable onPress={handleSubmit} disabled={submitting || !canSubmit} style={[styles.button, { opacity: submitting || !canSubmit ? 0.5 : 1 }]}>
              <BrandGradient style={styles.buttonFill}>
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={styles.buttonLabel} lightColor="#fff" darkColor="#fff">
                    Create account
                  </ThemedText>
                )}
              </BrandGradient>
            </Pressable>

            <Pressable onPress={() => router.back()} style={styles.backLink}>
              <ThemedText style={styles.backLinkLabel}>Already have an account? Log in</ThemedText>
            </Pressable>
          </View>
        </View>
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
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  centerWrap: {
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
  backLink: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 4,
  },
  backLinkLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    opacity: 0.7,
  },
});
