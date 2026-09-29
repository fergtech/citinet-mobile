import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

import { ensureAlertPrefsLoaded, getAlertPrefs } from '@/lib/notifications/alert-prefs';

// Lazily created, then reused — a fresh player per chime would leak native
// resources on a busy hub. Created on first use rather than at import so
// nothing native spins up before the user is even signed in.
let player: AudioPlayer | null = null;
let acceptPlayer: AudioPlayer | null = null;

// Re-applied on EVERY alert, not once. On iOS the audio session category is
// one shared setting, and other things in this app (video/audio playback,
// LiveKit calls) switch it to a category that ignores the silent switch and
// can also suppress haptics. Reasserting "ambient" right before we play puts
// it back, so the chime honours the ringer switch and haptics aren't blocked.
async function applyAudioMode(): Promise<void> {
  // Same behaviour as Instagram/X/Discord's in-app chime: honours the
  // silent switch on iOS, and mixes with (rather than pauses) whatever
  // music/podcast the user already has playing.
  await setAudioModeAsync({
    playsInSilentMode: false,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
  }).catch((err) => console.warn('[notification-alert] audio mode failed', err));
}

function ensurePlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(require('@/assets/sounds/new-notification.mp3'));
  }
  return player;
}

function ensureAcceptPlayer(): AudioPlayer {
  if (!acceptPlayer) {
    acceptPlayer = createAudioPlayer(require('@/assets/sounds/accept.mp3'));
  }
  return acceptPlayer;
}

// Creating the players up front lets them finish loading their files well
// before the first sound is needed — a player created at the moment of
// play can still be loading, and seeking/playing it then is unreliable.
// Called once from the tab layout after sign-in.
export function preloadAlertSounds(): void {
  try {
    ensurePlayer();
    ensureAcceptPlayer();
  } catch (err) {
    console.warn('[alert-sounds] preload failed', err);
  }
}

// Only rewind when it has actually been played before — the very first play
// needs no seek, and seeking a not-yet-loaded player is what can stall.
async function playFromStart(p: AudioPlayer): Promise<void> {
  if (p.currentTime > 0) await p.seekTo(0);
  p.play();
}

// Same impactAsync call the tab bar/drawer already use (known to fire on this
// app's iOS builds) rather than notificationAsync, in a two-tap pattern so
// it reads as "something arrived" and not a stray button-press tick.
function buzz(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    .then(() => new Promise((r) => setTimeout(r, 110)))
    .then(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy))
    .catch((err) => console.warn('[notification-alert] haptics failed', err));
}

// Short confirmation sound for a finished upload (100% of the batch sent).
// Shares the Sound toggle in Account Settings — one switch for every sound the
// app makes on its own. Never throws: a failed chime must not turn a
// successful upload into an error.
export async function playUploadCompleteSound(): Promise<void> {
  try {
    await ensureAlertPrefsLoaded();
    if (!getAlertPrefs().sound) {
      console.log('[upload-sound] skipped: sound is turned off in settings');
      return;
    }
    await applyAudioMode();
    await playFromStart(ensureAcceptPlayer());
    console.log('[upload-sound] play() called');
  } catch (err) {
    console.warn('[upload-sound] playback failed', err);
  }
}

// Sound + a two-tap haptic, for "something new just arrived while you're
// in the app". Never throws — a failed chime must not break the poll that
// triggered it.
export async function playNotificationAlert(): Promise<void> {
  await ensureAlertPrefsLoaded();
  const { sound, haptics } = getAlertPrefs();
  await applyAudioMode();
  if (haptics) buzz();
  if (!sound) return;
  try {
    await playFromStart(ensurePlayer());
  } catch (err) {
    console.warn('[notification-alert] playback failed', err);
  }
}
