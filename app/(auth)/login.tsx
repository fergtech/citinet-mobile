import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { BrandGradient } from '@/components/brand-gradient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/lib/session/session-context';

export default function LoginScreen() {
  const { hubId, hubSlug, hubName, tunnelUrl, location } = useLocalSearchParams<{
    hubId: string;
    hubSlug: string;
    hubName: string;
    tunnelUrl: string;
    location: string;
  }>();
  const colorScheme = useColorScheme() ?? 'light';
  const { signIn } = useSession();

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
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.heading}>
        Log in to {hubName}
      </ThemedText>
      <ThemedText style={styles.subheading}>Enter your account for this hub.</ThemedText>

      <ThemedText style={styles.label}>Username</ThemedText>
      <TextInput
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="username"
        placeholderTextColor={Colors[colorScheme].icon}
        style={[styles.input, { color: Colors[colorScheme].text, borderColor: Colors[colorScheme].icon }]}
      />

      <ThemedText style={styles.label}>Password</ThemedText>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="password"
        placeholderTextColor={Colors[colorScheme].icon}
        style={[styles.input, { color: Colors[colorScheme].text, borderColor: Colors[colorScheme].icon }]}
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
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
    borderWidth: 1,
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
