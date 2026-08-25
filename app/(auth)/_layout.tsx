import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack>
      <Stack.Screen name="hub-select" options={{ title: 'Find your hub' }} />
      <Stack.Screen name="login" options={{ title: 'Log in' }} />
    </Stack>
  );
}
