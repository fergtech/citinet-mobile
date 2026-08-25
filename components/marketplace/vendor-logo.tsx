import { StyleSheet } from 'react-native';

import { BrandGradient } from '@/components/brand-gradient';
import { HubMedia } from '@/components/hub-media';
import { ThemedText } from '@/components/themed-text';

type Props = {
  fileName: string | null | undefined;
  name: string;
  tunnelUrl: string;
  token: string;
  size?: number;
};

// The vendor-logo equivalent of components/hub-avatar.tsx — but a vendor
// logo is a hub_files upload (image_file_name-style, token-gated download),
// not a user avatar (which has its own dedicated /api/auth/avatar/:userId
// route), so this resolves through HubMedia/getMediaUrl instead.
export function VendorLogo({ fileName, name, tunnelUrl, token, size = 36 }: Props) {
  const dimensionStyle = { width: size, height: size, borderRadius: size / 2 };
  // HubMedia's default style sets aspectRatio: 4/5 (post/media convention) —
  // cancel it explicitly so a fixed size x size circle isn't stretched, same
  // pattern components/post-grid-card.tsx uses for its full-bleed tile media.
  const mediaStyle = { ...dimensionStyle, aspectRatio: undefined as number | undefined };

  if (!fileName) {
    return (
      <BrandGradient style={[styles.fallback, dimensionStyle]}>
        <ThemedText style={[styles.initial, { fontSize: size * 0.42 }]} lightColor="#fff" darkColor="#fff">
          {(name || '?').charAt(0).toUpperCase()}
        </ThemedText>
      </BrandGradient>
    );
  }

  return <HubMedia fileName={fileName} tunnelUrl={tunnelUrl} token={token} style={mediaStyle} />;
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
