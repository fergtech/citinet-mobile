import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hostnameOf } from '@/lib/ui/link-preview';

type PreviewContent = {
  title: string;
  subtitle?: string;
};

async function fetchWithTimeout(url: string, ms = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Renders a message URL as a rich title/description/domain card, resolved via
 *  the hub's own /api/public/og unfurl endpoint — same route and response
 *  shape as citinet-web's LinkPreviewCard, so a shared link looks the same on
 *  both clients. Falls back to a bare domain card if the fetch fails or the
 *  page has no OG metadata. */
export function LinkPreviewCard({ url, tunnelUrl }: { url: string; tunnelUrl: string }) {
  const colorScheme = useColorScheme() ?? 'light';
  const domain = hostnameOf(url);
  const [content, setContent] = useState<PreviewContent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContent(null);
    fetchWithTimeout(`${tunnelUrl}/api/public/og?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('not ok');
        const data = await res.json();
        if (cancelled) return;
        setContent(
          data.title ? { title: data.title, subtitle: data.description || data.site_name || undefined } : { title: domain }
        );
      })
      .catch(() => {
        if (!cancelled) setContent({ title: domain });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, tunnelUrl, domain]);

  async function openLink() {
    if (Platform.OS === 'web') {
      Linking.openURL(url);
      return;
    }
    await openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
  }

  if (loading) {
    return (
      <View style={[styles.card, styles.loadingCard, { borderColor: Colors[colorScheme].icon + '33' }]}>
        <View style={[styles.iconWrap, { backgroundColor: Colors[colorScheme].icon + '22' }]}>
          <ActivityIndicator size="small" color={Colors[colorScheme].icon} />
        </View>
        <View style={styles.textWrap}>
          <View style={[styles.skeletonLine, { backgroundColor: Colors[colorScheme].icon + '22', width: '70%' }]} />
          <View style={[styles.skeletonLine, { backgroundColor: Colors[colorScheme].icon + '22', width: '45%' }]} />
        </View>
      </View>
    );
  }

  if (!content) return null;

  return (
    <Pressable onPress={openLink} style={[styles.card, { borderColor: Colors[colorScheme].icon + '33' }]}>
      <View style={[styles.iconWrap, { backgroundColor: Brand }]}>
        <IconSymbol name="globe" size={16} color="#fff" />
      </View>
      <View style={styles.textWrap}>
        <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.title}>
          {content.title}
        </ThemedText>
        {content.subtitle && (
          <ThemedText numberOfLines={1} style={styles.subtitle}>
            {content.subtitle}
          </ThemedText>
        )}
        <ThemedText numberOfLines={1} style={styles.domain}>
          {domain}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 10,
    maxWidth: 260,
    marginTop: 4,
  },
  loadingCard: {
    opacity: 0.7,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 13.5,
  },
  subtitle: {
    fontSize: 11.5,
    opacity: 0.7,
  },
  domain: {
    fontSize: 10,
    opacity: 0.5,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  skeletonLine: {
    height: 8,
    borderRadius: 4,
  },
});
