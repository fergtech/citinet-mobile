import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// A modern phone photo (12MP+, several MB) has no business being uploaded at
// full resolution just to be displayed in a feed a few hundred px wide —
// this is the "don't make the payload huge in the first place" half of the
// feed image latency fix (the other half is hub-media.tsx's own note on
// skipping the token round-trip for post media). ImagePicker's own `quality`
// option only controls JPEG re-encoding quality, not dimensions, so a
// full-resolution photo picked at quality 0.7 is still full-resolution.
const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.8;

// No-op (returns the original uri/dimensions untouched) for anything already
// at or under MAX_DIMENSION on its longer side — most non-camera picks
// (screenshots, already-shared images) don't need re-encoding at all.
export async function prepareImageForUpload(
  uri: string,
  width: number,
  height: number
): Promise<{ uri: string; width: number; height: number }> {
  if (Math.max(width, height) <= MAX_DIMENSION) return { uri, width, height };

  const resize = width >= height ? { width: MAX_DIMENSION } : { height: MAX_DIMENSION };
  const rendered = await ImageManipulator.manipulate(uri).resize(resize).renderAsync();
  const result = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return { uri: result.uri, width: result.width, height: result.height };
}

// Avatars are only ever drawn a few dozen to ~100 px wide, so 512px square is
// plenty (and 2x-3x headroom for the largest profile placements) — a
// full-resolution photo would just be slow to send over a relayed tunnel and
// slow to load in every list that shows this person. Always re-encodes to
// JPEG so the hub sees a consistent, small file whatever the picker returned.
const AVATAR_SIZE = 512;

export async function prepareAvatarForUpload(uri: string, width: number, height: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  const shortest = Math.min(width, height);
  const resized = shortest > AVATAR_SIZE ? (width <= height ? ctx.resize({ width: AVATAR_SIZE }) : ctx.resize({ height: AVATAR_SIZE })) : ctx;
  const rendered = await resized.renderAsync();
  const result = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return result.uri;
}
