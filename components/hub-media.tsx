import { useIsFocused } from '@react-navigation/native';
import { Image, ImageContentPosition, ImageStyle } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleProp, StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { MediaSkeleton } from '@/components/ui/media-skeleton';
import { getMediaUrl, getPublicFileUrl } from '@/lib/api/hubService';
import { acquirePlaybackSlot, releasePlaybackSlot } from '@/lib/media/video-playback-slots';

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
  // Default 'cover' crops to fill `style`'s box (every existing thumbnail
  // caller). MediaLightbox passes 'contain' so a full-screen view shows the
  // whole frame at its own aspect ratio instead of cropping it.
  contentFit?: 'cover' | 'contain';
  // Every preview (feed, chat bubble, post detail) autoplays muted — default
  // true keeps that. MediaLightbox passes false: once someone's deliberately
  // opened a video to watch it full-screen, it should have sound.
  muted?: boolean;
  // Defaults to `!previewSeconds` (unchanged). A chat attachment thumbnail
  // passes false explicitly so a tap always opens MediaLightbox instead of
  // being ambiguous with the native play/pause/scrub overlay's own tap.
  nativeControls?: boolean;
};

export function HubMedia({ fileName, tunnelUrl, token, style, previewSeconds, contentPosition, isPublic, contentFit = 'cover', muted = true, nativeControls }: Props) {
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

  // Gates whether this instance is actually allowed to load/decode a video
  // right now — see lib/media/video-playback-slots.ts. Only a bounded number
  // of HubMedia instances hold a slot at once app-wide; everything else
  // renders the static fallback below instead of competing for the same
  // limited decoder memory. State (not just a ref) because flipping it needs
  // to change what's passed into useVideoPlayer below and force a re-render.
  const [hasSlot, setHasSlot] = useState(false);
  const heldSlotRef = useRef(false);

  // Tied to the *screen's* focus (not just this component's mount state) —
  // expo-router leaves other tabs/pushed-under screens mounted rather than
  // unmounting them, so without this a preview that's already playing keeps
  // decoding frames off-screen (wasted native decoder resources, worse on
  // Android where those are limited) and holds its slot hostage from
  // whatever's actually visible now. Losing focus releases the slot (and,
  // via hasSlot below, drops the player's source entirely — a stronger stop
  // than just pausing); regaining focus tries to reacquire one.
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!video) return;
    if (isFocused) {
      if (!heldSlotRef.current && acquirePlaybackSlot()) {
        heldSlotRef.current = true;
        setHasSlot(true);
      }
    } else if (heldSlotRef.current) {
      releasePlaybackSlot();
      heldSlotRef.current = false;
      setHasSlot(false);
    }
    return () => {
      if (heldSlotRef.current) {
        releasePlaybackSlot();
        heldSlotRef.current = false;
      }
    };
  }, [video, isFocused]);

  // Must call this hook unconditionally; pass null until the URL resolves
  // OR this instance doesn't currently hold a playback slot — no slot means
  // no source at all, not just "loaded but paused," so it isn't also
  // holding decoder buffers for a video nothing is actually showing.
  // Autoplay muted: browsers block unmuted autoplay outright, and it's the
  // standard feed convention anyway — native controls (post-detail only, see
  // below) let the viewer unmute there.
  const player = useVideoPlayer(video && hasSlot ? url : null, (p) => {
    p.loop = true;
    p.muted = muted;
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
    return <MediaSkeleton style={[styles.placeholder, style]} />;
  }

  if (video) {
    // Didn't win a playback slot (see lib/media/video-playback-slots.ts) —
    // rather than compete for the same limited decoder memory that just
    // crashed the app with an OOM, show a plain static marker instead of
    // loading the video at all. Scrolling this row off-screen and back (or
    // navigating away and back) gives it another chance once something else
    // releases a slot.
    if (!hasSlot) {
      return (
        <View style={[styles.media, style, styles.videoFallback]}>
          <IconSymbol name="play.fill" size={26} color="#fff" />
        </View>
      );
    }
    // Compact autoplaying previews (previewSeconds set) skip native controls —
    // there's nothing to scrub/pause in a small muted loop, and on some
    // platforms the controls overlay can itself throw off how the video
    // surface fills its box. Full nativeControls only on post-detail.
    return (
      <VideoView
        player={player}
        style={[styles.media, style]}
        nativeControls={nativeControls ?? !previewSeconds}
        contentFit={contentFit}
      />
    );
  }

  return (
    <Image
      source={{ uri: url }}
      style={[styles.media, style]}
      contentFit={contentFit}
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
  videoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
});
