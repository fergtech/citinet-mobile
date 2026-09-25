import { StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const MIN_SCALE = 1;
const MAX_SCALE = 6;

// Pinch-to-zoom + drag-to-pan on a plain image, entirely native
// (react-native-gesture-handler + reanimated, both already dependencies) —
// built to replace a WebView-embedded viewer that turned out to hang
// unreliably (see app/atlas/panoramax-view.tsx for the full story). No
// external JS bundle, no WebView, nothing that can get stuck loading.
export function ZoomableImage({
  uri,
  headers,
  onLoad,
  onError,
}: {
  uri: string;
  // media-lightbox.tsx's image is a private file, fetched with a Bearer
  // header the same way the rest of the app's authenticated requests are
  // (see getMediaSource in hubService.ts) — unset for panoramax-view.tsx/
  // banner-editor's callers, whose images need no auth.
  headers?: Record<string, string>;
  // Neither is required by panoramax-view.tsx/banner-editor's callers, which
  // don't surface load failures at all — media-lightbox.tsx passes both so a
  // resolved-but-undecodable uri (expired signed URL, dropped connection
  // mid-fetch) shows its error+retry state instead of an indefinitely blank
  // screen (expo-image's <Image> otherwise fails silently with nothing on
  // screen to explain why).
  onLoad?: () => void;
  // Passes expo-image's own error event through (a message string) rather
  // than swallowing it — useful for diagnosing *why* a load failed, not just
  // that it did.
  onError?: (event: { error: string }) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  function resetPan() {
    'worklet';
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= MIN_SCALE) resetPan();
    });

  // Panning only does anything once zoomed in — at 1x there's nothing to pan
  // to, and letting the gesture "work" anyway just feels broken.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value <= MIN_SCALE) return;
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = scale.value > MIN_SCALE ? MIN_SCALE : 2.5;
      scale.value = withTiming(next);
      savedScale.value = next;
      if (next <= MIN_SCALE) resetPan();
    });

  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.flex, animatedStyle]}>
        <Image
          source={{ uri, headers }}
          style={styles.flex}
          contentFit="contain"
          // media-lightbox.tsx passes a local file:// path it downloads
          // itself under a fixed, reused name per file (see
          // download-to-cache.ts) and overwrites on every open/retry — a
          // cache keyed by that same uri string can easily go stale (a
          // failed/blank earlier attempt cached against that exact path,
          // then replayed forever even after a later download at the same
          // path succeeds). Confirmed real bug this fixes: the photo lightbox
          // went blank with no error every time after one bad attempt got
          // cached, while video (a separate native module with its own,
          // unaffected cache) kept working fine. This is a one-off
          // full-screen view anyway — no benefit to caching it.
          cachePolicy="none"
          onLoad={onLoad}
          onError={onError}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    // Explicit, not just `flex: 1` — flex-grow only governs the main axis;
    // a parent with `alignItems: 'center'` (cross axis) instead of the
    // default 'stretch' would otherwise collapse this to zero width, and
    // <Image> never gets a chance to render anything (confirmed real bug —
    // see media-lightbox.tsx's own container style for the full story).
    // Explicit here too so this can't regress the same way in whatever
    // container next wraps this component.
    width: '100%',
    height: '100%',
  },
});
