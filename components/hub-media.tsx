import { Image, ImageContentPosition, ImageStyle } from 'expo-image';
import { useEffect, useState } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ActivityIndicator, StyleProp, StyleSheet, View } from 'react-native';

import { getMediaUrl } from '@/lib/api/hubService';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];

function isVideo(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type Props = {
  fileName: string;
  tunnelUrl: string;
  token: string;
  // Overrides the default "width 100%, 4:3" box — e.g. a full-bleed square
  // background (post-grid-card.tsx passes aspectRatio/width/height explicitly
  // as undefined to cancel the defaults, RN's style-array merge applies them
  // in order so a later `undefined` does reset an earlier value).
  style?: StyleProp<ImageStyle>;
  // Feed/grid contexts autoplay muted, so a full-length video would just run
  // unattended in the background — cap it to a short looping preview instead
  // (loop the first N seconds, not the whole thing) and leave this unset on
  // the post-detail screen, where the viewer came to actually watch it.
  previewSeconds?: number;
  // Vertical crop anchor for the admin-configurable marketplace banner
  // (e.g. { top: '30%' }) — unused by every other caller, ignored for video.
  contentPosition?: ImageContentPosition;
};

export function HubMedia({ fileName, tunnelUrl, token, style, previewSeconds, contentPosition }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const video = isVideo(fileName);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    getMediaUrl(tunnelUrl, token, fileName)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tunnelUrl, token, fileName]);

  // Must call this hook unconditionally; pass null until the URL resolves.
  // Autoplay muted: browsers block unmuted autoplay outright, and it's the
  // standard feed convention anyway — native controls (post-detail only, see
  // below) let the viewer unmute there.
  const player = useVideoPlayer(video ? url : null, (p) => {
    p.loop = true;
    p.muted = true;
    if (previewSeconds) p.timeUpdateEventInterval = 0.25;
    p.play();
  });

  // Loops just the first `previewSeconds` rather than the whole video —
  // `p.loop` above only covers reaching the actual end, so a long video
  // would otherwise autoplay in full before it kicks in.
  useEffect(() => {
    if (!video || !previewSeconds) return;
    const subscription = player.addListener('timeUpdate', ({ currentTime }) => {
      if (currentTime >= previewSeconds) {
        player.currentTime = 0;
      }
    });
    return () => subscription.remove();
  }, [video, previewSeconds, player]);

  if (failed) return null;

  if (!url) {
    return (
      <View style={[styles.placeholder, style]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (video) {
    // Compact autoplaying previews (previewSeconds set) skip native controls —
    // there's nothing to scrub/pause in a small muted loop, and on some
    // platforms the controls overlay can itself throw off how the video
    // surface fills its box. Full nativeControls only on post-detail.
    return (
      <VideoView
        player={player}
        style={[styles.media, style]}
        nativeControls={!previewSeconds}
        contentFit="cover"
      />
    );
  }

  return (
    <Image
      source={{ uri: url }}
      style={[styles.media, style]}
      contentFit="cover"
      contentPosition={contentPosition}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8882',
  },
  media: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: 10,
    backgroundColor: '#8882',
  },
});
