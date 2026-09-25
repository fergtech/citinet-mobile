import { useEffect, useState } from 'react';

// Caps how many HubMedia video previews can actively decode at once.
// Each concurrently-playing ExoPlayer instance holds real decoder buffers —
// a dashboard/feed mounting several video rows together (files grid,
// marketplace strip, post previews) had nothing stopping every one of them
// from loading and playing simultaneously, which exhausted the process heap
// and crashed with a genuine OutOfMemoryError on ExoPlayer's own playback
// thread (confirmed via logcat: a handful of video files in Home's "Latest
// uploads" was enough to crash right after login on a stock Android
// emulator's ~192MB heap — a real device has more headroom but the same
// unbounded-concurrency bug, just a higher post count needed to trigger it).
//
// A component that fails to acquire a slot simply doesn't load its video
// source at all (see hub-media.tsx) rather than competing for memory anyway
// — scrolling it off-screen and back (or navigating away and back) gives it
// another chance once something else releases a slot.
const MAX_CONCURRENT_PLAYBACK = 2;
let activeCount = 0;

export function acquirePlaybackSlot(): boolean {
  if (activeCount >= MAX_CONCURRENT_PLAYBACK) return false;
  activeCount += 1;
  return true;
}

export function releasePlaybackSlot(): void {
  activeCount = Math.max(0, activeCount - 1);
}

// Confirmed real bug this fixes: open MediaLightbox for a video whose own
// chat-bubble preview is still mounted underneath it (Modal doesn't unmount
// what's behind it, and expo-router doesn't unmount other still-focused
// content either) — that bubble is still holding one of only 2 slots for a
// video the modal now fully covers, and any other video previews mounted
// elsewhere in the same still-"focused" screen (FlatList windowing keeps a
// few rows mounted just off-screen) can easily hold the other one, leaving
// the lightbox's own instance with zero — it never even attempts to load,
// forever showing the plain "no slot" icon with nothing to tap.
//
// Background previews (every HubMedia except the one instance that IS the
// open lightbox) release their slot for as long as any lightbox is open,
// since none of them are actually visible to the user while it covers the
// screen anyway — freeing both slots for the lightbox's own video the
// moment it needs one. A plain module-level flag + subscriber list because
// this needs to reactively re-run each background HubMedia's slot effect,
// not just be read once.
let lightboxOpen = false;
const lightboxListeners = new Set<() => void>();

export function setLightboxOpen(open: boolean): void {
  if (lightboxOpen === open) return;
  lightboxOpen = open;
  lightboxListeners.forEach((listener) => listener());
}

export function useIsLightboxOpen(): boolean {
  const [value, setValue] = useState(lightboxOpen);
  useEffect(() => {
    const listener = () => setValue(lightboxOpen);
    lightboxListeners.add(listener);
    // The flag can flip between this hook's initial render and the effect
    // above subscribing to it (e.g. a lightbox opens in that gap) — re-sync
    // once subscribed rather than trusting the value captured at render time.
    setValue(lightboxOpen);
    return () => {
      lightboxListeners.delete(listener);
    };
  }, []);
  return value;
}
