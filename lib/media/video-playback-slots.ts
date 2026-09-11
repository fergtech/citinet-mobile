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
