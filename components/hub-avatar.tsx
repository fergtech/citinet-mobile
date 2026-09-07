import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { BrandGradient } from '@/components/brand-gradient';
import { AvatarIconColor } from '@/constants/theme';
import { getAvatarUrl } from '@/lib/api/hubService';

// Lifted verbatim from the source icon set's Android vector-drawable XML
// (H:\Apps\custom-icons\user-android\res\drawable\user_24.xml) — same
// lift-from-Android-XML approach as components/ui/custom-icon.tsx, but kept
// on its own native 512x512 viewBox instead of being rescaled into that
// component's shared 0-24 one (its "plus" icon needed exactly that rescale;
// this one doesn't, and rescaling by hand risks a transcription slip in the
// arc-radius args). This exact path pair is edge-to-edge on its own
// viewBox — the head touches y=0, the shoulders' flat base touches y=512 —
// so rendering it at `size` (the avatar's own diameter) fills the circle
// with no built-in padding, unlike the MaterialIcons/SF Symbol "person.fill"
// glyphs this replaced, which reserve baseline padding inside their own box
// no matter how large you draw them (that padding is what left a gap under
// the shoulders even after sizing the glyph up to the full circle).
const PERSON_SILHOUETTE_PATHS = [
  'M256,298.667c-105.99,0.118-191.882,86.01-192,192C64,502.449,73.551,512,85.333,512h341.333c11.782,0,21.333-9.551,21.333-21.333C447.882,384.677,361.99,298.784,256,298.667z',
  'M 256 128 m -128, 0 a 128, 128 0 1,0 256,0 a 128, 128 0 1,0 -256,0',
];

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
      <BrandGradient style={[styles.fallback, dimensionStyle]} accessibilityLabel={displayName || undefined}>
        <Svg width={size} height={size} viewBox="0 0 512 512">
          {PERSON_SILHOUETTE_PATHS.map((d) => (
            <Path key={d} d={d} fill={AvatarIconColor} />
          ))}
        </Svg>
      </BrandGradient>
    );
  }

  return (
    <Image
      source={{ uri: getAvatarUrl(tunnelUrl, userId) }}
      style={dimensionStyle}
      cachePolicy="memory-disk"
      transition={200}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
