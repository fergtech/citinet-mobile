import { useIsFocused } from '@react-navigation/native';
import { Image, ImageContentPosition, ImageStyle } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleProp, StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { getMediaSource, getPublicFileUrl } from '@/lib/api/hubService';
import { acquirePlaybackSlot, releasePlaybackSlot, useIsLightboxOpen } from '@/lib/media/video-playback-slots';

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
  // server always stores with is_public=true. Uses getPublicFileUrl's direct,
  // properly-cached public URL instead of the authenticated one below — see
  // that function's own comment for why (real cache headers; no auth needed
  // at all). Leave unset for anything that could be a private Files-section
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
  // Fires once the file has actually started rendering/playing — an image's
  // onLoad, or a video player's first `readyToPlay` status. media-lightbox.tsx
  // is the only caller that uses this (to know when to stop showing its own
  // spinner); every other caller ignores it.
  onLoad?: () => void;
  // Fires once, the first time this file fails to load — a bad URL, a
  // dropped connection mid-fetch, or (video) the player itself reporting a
  // decode/format error. Every existing caller ignores it and gets the same
  // silent placeholder/blank-null it always did; media-lightbox.tsx is the
  // one caller that needs to know, so it can show an error+retry state
  // instead of leaving the screen blank with nothing to explain why
  // (previously true even for video, which had no error reporting of any
  // kind — a stuck native play button forever).
  onError?: () => void;
  // Bypasses getMediaSource/getPublicFileUrl entirely and uses this local
  // file:// uri as-is (no auth headers needed — it's already on disk). Set
  // by media-lightbox.tsx, which downloads the file itself first — see
  // lib/media/download-to-cache.ts for why: a confirmed bug where handing
  // <VideoView>/<Image> a *remote* {uri, headers} source at this component's
  // full-screen render size never fires onLoad or onError at all, despite
  // the identical request succeeding fine as a small thumbnail (this prop)
  // or via a plain fetch() (download-to-cache.ts's own fix).
  localUri?: string;
  // True only for the single HubMedia instance that IS an open
  // MediaLightbox's video — see setLightboxOpen's own comment in
  // video-playback-slots.ts for why every *other* instance needs to know to
  // stand down while one of these is open.
  isLightbox?: boolean;
};

export function HubMedia({ fileName, tunnelUrl, token, style, previewSeconds, contentPosition, isPublic, contentFit = 'cover', muted = true, nativeControls, onLoad, onError, localUri, isLightbox }: Props) {
  const [failed, setFailed] = useState(false);
  const video = isVideo(fileName);

  // A different file reusing this same component instance (rare, but not
  // impossible) should get a fresh chance rather than staying stuck on a
  // previous file's failure.
  useEffect(() => {
    setFailed(false);
  }, [fileName, tunnelUrl, token, isPublic]);

  // One authenticated GET, not two — same endpoint + Bearer-header pattern
  // citinet-web's own inline preview (AuthMedia/fetchFileBlob) uses, instead
  // of getMediaUrl's "POST for a one-time token, then GET with it in the
  // query string" dance built for native browser/device downloads (see
  // getMediaSource's own comment in hubService.ts). Synchronous — no more
  // loading gap before the image/video request even starts, and one less
  // thing (a separate token-issuance call) that can fail on its own.
  // Memoized: getMediaSource builds a fresh object (with a fresh nested
  // `headers` object) on every call — passed inline, a parent re-render for
  // any unrelated reason hands <Image>/<VideoView> a new-by-reference source
  // every time, and both can read that as "the source changed" and cancel +
  // restart an in-flight load. A large file on a slow connection could keep
  // restarting forever, never once finishing before the next re-render — a
  // real candidate for "this stays stuck loading" with no error and no
  // upper bound on how long it takes.
  const source = useMemo(
    () => (localUri ? { uri: localUri } : isPublic ? { uri: getPublicFileUrl(tunnelUrl, fileName) } : getMediaSource(tunnelUrl, token, fileName)),
    [localUri, isPublic, tunnelUrl, fileName, token]
  );

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
  // Every background preview stands down for as long as any lightbox is
  // open — none of them are visible while it covers the screen, and the
  // lightbox's own instance (isLightbox: true) is exempt so it isn't blocked
  // by its own open state. See setLightboxOpen's comment in
  // video-playback-slots.ts for the exact bug this fixes.
  const lightboxOpen = useIsLightboxOpen();
  const shouldHoldSlot = isFocused && (isLightbox || !lightboxOpen);
  useEffect(() => {
    if (!video) return;
    if (shouldHoldSlot) {
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
  }, [video, shouldHoldSlot]);

  // Must call this hook unconditionally; pass null when this instance
  // doesn't currently hold a playback slot — no slot means no source at
  // all, not just "loaded but paused," so it isn't also holding decoder
  // buffers for a video nothing is actually showing.
  // Autoplay muted: browsers block unmuted autoplay outright, and it's the
  // standard feed convention anyway — native controls (post-detail only, see
  // below) let the viewer unmute there.
  const player = useVideoPlayer(video && hasSlot ? source : null, (p) => {
    p.loop = true;
    p.muted = muted;
    if (previewSeconds) p.timeUpdateEventInterval = 0.25;
    p.play();
  });

  // Video had no failure signal at all before this — an expired token, a
  // format the device's decoder rejects, or the hub going unreachable
  // mid-load all left the player silently stuck in its native "not started"
  // state (a bare play button that does nothing when tapped) with nothing
  // in the JS layer able to tell the difference from "still buffering."
  useEffect(() => {
    if (!video || !hasSlot) return;
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') {
        setFailed(true);
        onError?.();
      } else if (status === 'readyToPlay') {
        onLoad?.();
      }
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoad/onError are passed fresh each render by callers; including them would tear down/re-add this listener every render.
  }, [video, hasSlot, player]);

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
      source={source}
      style={[styles.media, style]}
      contentFit={contentFit}
      contentPosition={contentPosition}
      cachePolicy="memory-disk"
      transition={200}
      onLoad={() => onLoad?.()}
      onError={() => {
        setFailed(true);
        onError?.();
      }}
    />
  );
}

const styles = StyleSheet.create({
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
