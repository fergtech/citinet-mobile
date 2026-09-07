import { useIsFocused } from '@react-navigation/native';
import { Image, ImageContentPosition, ImageStyle } from 'expo-image';
import { useEffect, useState } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleProp, StyleSheet } from 'react-native';

import { MediaSkeleton } from '@/components/ui/media-skeleton';
import { getMediaUrl, getPublicFileUrl } from '@/lib/api/hubService';

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
  // Set by callers that know this file is unconditionally public — post/reply
  // attachments (post-row.tsx, post-grid-card.tsx, post detail), which the
  // server always stores with is_public=true. Skips the token round-trip
  // entirely in favor of getPublicFileUrl's direct, properly-cached public
  // URL — see that function's own comment for why the token/download route
  // this otherwise falls back to (getMediaUrl) is actively bad for inline
  // feed images (private, no-store; built for explicit downloads, not
  // display). Leave unset for anything that could be a private Files-section
  // upload — that still needs the authenticated fallback below.
  isPublic?: boolean;
};

export function HubMedia({ fileName, tunnelUrl, token, style, previewSeconds, contentPosition, isPublic }: Props) {
  const [tokenUrl, setTokenUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const video = isVideo(fileName);

  useEffect(() => {
    if (isPublic) return;
    let cancelled = false;
    setTokenUrl(null);
    setFailed(false);
    getMediaUrl(tunnelUrl, token, fileName)
      .then((resolved) => {
        if (!cancelled) setTokenUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isPublic, tunnelUrl, token, fileName]);

  // Synchronous for the public path — no loading gap, no placeholder flash,
  // unlike the token round-trip the fallback still needs.
  const url = isPublic ? getPublicFileUrl(tunnelUrl, fileName) : tokenUrl;

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

  // Explicit play/pause tied to the *screen's* focus (not just this
  // component's mount state) — expo-router leaves other tabs/pushed-under
  // screens mounted rather than unmounting them, so without this a preview
  // that's already playing keeps decoding frames off-screen (wasted native
  // decoder resources, worse on Android where those are limited), and
  // worse: navigating away and back left it stuck on a static poster frame
  // instead of resuming, because nothing ever called play() again — the
  // original p.play() above only fires once, at creation. Re-deriving
  // "should this be playing" from isFocused on every focus change fixes
  // both: paused while off-screen, and explicitly restarted on return
  // instead of assuming the player quietly kept itself going.
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!video) return;
    if (isFocused) player.play();
    else player.pause();
  }, [video, isFocused, player]);

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
    return <MediaSkeleton style={[styles.placeholder, style]} />;
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
      cachePolicy="memory-disk"
      transition={200}
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
