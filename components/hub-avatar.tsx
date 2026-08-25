import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { BrandGradient } from '@/components/brand-gradient';
import { ThemedText } from '@/components/themed-text';
import { getAvatarUrl } from '@/lib/api/hubService';

type Props = {
  userId: string | null;
  displayName: string;
  tunnelUrl: string;
  size?: number;
};

export function HubAvatar({ userId, displayName, tunnelUrl, size = 36 }: Props) {
  const [failed, setFailed] = useState(false);

  const dimensionStyle = { width: size, height: size, borderRadius: size / 2 };

  if (!userId || failed) {
    return (
      <BrandGradient style={[styles.fallback, dimensionStyle]}>
        <ThemedText style={[styles.initial, { fontSize: size * 0.42 }]} lightColor="#fff" darkColor="#fff">
          {(displayName || '?').charAt(0).toUpperCase()}
        </ThemedText>
      </BrandGradient>
    );
  }

  return (
    <Image
      source={{ uri: getAvatarUrl(tunnelUrl, userId) }}
      style={dimensionStyle}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontWeight: '600',
  },
});
