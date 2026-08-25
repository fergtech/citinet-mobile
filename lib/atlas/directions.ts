import { Linking, Platform } from 'react-native';

// iOS opens Apple Maps (via its universal link, not the maps:// custom scheme
// — the universal link opens the app directly without needing an
// LSApplicationQueriesSchemes entitlement, which this Expo-Go-only project
// can't add). Android's google.navigation: intent needs Google Maps
// installed to resolve; if it can't (canOpenURL returns false, or the intent
// itself fails), fall back to the plain Google Maps web URL, which opens the
// app if installed or the browser otherwise — never a dead tap either way.
export async function openDirections(latitude: number, longitude: number, label?: string): Promise<void> {
  const encodedLabel = label ? encodeURIComponent(label) : '';

  if (Platform.OS === 'ios') {
    const url = `https://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=d${encodedLabel ? `&q=${encodedLabel}` : ''}`;
    await Linking.openURL(url);
    return;
  }

  const webFallback = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  if (Platform.OS === 'android') {
    const navUrl = `google.navigation:q=${latitude},${longitude}`;
    try {
      const canOpen = await Linking.canOpenURL(navUrl);
      await Linking.openURL(canOpen ? navUrl : webFallback);
      return;
    } catch {
      // fall through to the web URL below
    }
  }

  await Linking.openURL(webFallback);
}
