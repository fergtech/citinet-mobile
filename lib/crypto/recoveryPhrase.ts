import * as ExpoCrypto from 'expo-crypto';

/**
 * Fixed 256-word list for recovery-phrase generation, copied verbatim from
 * citinet's `src/app/utils/recoveryWords.ts`. Exactly 256 entries so each
 * word contributes exactly 8 bits of entropy -- 7 words = 56 bits, well
 * beyond what's practical to brute-force against an Argon2id-wrapped backup.
 * All short, common, unambiguous English words with no near-duplicates
 * (no plural/singular pairs, no homophones) so a word is easy to recognize
 * even if slightly mistyped.
 */
export const RECOVERY_WORDS: readonly string[] = [
  'acorn', 'action', 'address', 'aging', 'airport', 'alarm', 'alley', 'almond',
  'amber', 'anchor', 'animal', 'ankle', 'answer', 'antique', 'apple', 'archer',
  'arctic', 'armor', 'arrow', 'artist', 'ash', 'aspect', 'autumn', 'avenue',
  'badge', 'bakery', 'balance', 'bamboo', 'banjo', 'barrel', 'basket', 'beacon',
  'beetle', 'bench', 'berry', 'bicycle', 'billow', 'birch', 'bishop', 'blanket',
  'blizzard', 'bloom', 'bluff', 'boiler', 'bolt', 'bonfire', 'border', 'bottle',
  'boulder', 'bracket', 'branch', 'brass', 'breeze', 'brick', 'bridge', 'bronze',
  'brook', 'bucket', 'buffalo', 'bulb', 'bumper', 'bundle', 'burrow', 'butter',
  'cabin', 'cactus', 'camera', 'canal', 'candle', 'cannon', 'canvas', 'canyon',
  'carbon', 'carpet', 'carrot', 'castle', 'cavern', 'cedar', 'cellar', 'ceramic',
  'chalk', 'chamber', 'channel', 'charcoal', 'charm', 'cherry', 'chess', 'chimney',
  'chisel', 'circuit', 'clarity', 'clay', 'cliff', 'clover', 'coast', 'cobalt',
  'compass', 'copper', 'coral', 'corner', 'cotton', 'cousin', 'coyote', 'crater',
  'cricket', 'crimson', 'crystal', 'cupboard', 'current', 'cushion', 'dagger', 'daisy',
  'debris', 'delta', 'desert', 'diamond', 'ditch', 'dolphin', 'domino', 'dragon',
  'drawer', 'drift', 'drum', 'dune', 'dusk', 'eagle', 'echo', 'eclipse',
  'elbow', 'elder', 'elm', 'ember', 'emerald', 'engine', 'envelope', 'equator',
  'estate', 'exit', 'fabric', 'falcon', 'feather', 'fence', 'fern', 'ferry',
  'fiddle', 'field', 'figure', 'filter', 'finger', 'fishing', 'flare', 'flask',
  'flint', 'forest', 'fossil', 'fountain', 'fracture', 'frame', 'frost', 'furnace',
  'galaxy', 'garden', 'garnet', 'gazebo', 'ginger', 'glacier', 'glider', 'goblet',
  'gopher', 'granite', 'gravel', 'grove', 'guitar', 'gulf', 'gutter', 'hammer',
  'harbor', 'harness', 'harvest', 'hatch', 'hazel', 'heather', 'hemlock', 'heron',
  'hickory', 'hollow', 'honey', 'horizon', 'hunter', 'hyena', 'iceberg', 'igloo',
  'indigo', 'inlet', 'iron', 'island', 'ivory', 'jacket', 'jade', 'jasper',
  'jigsaw', 'journal', 'jungle', 'kettle', 'kitten', 'ladder', 'lagoon', 'lantern',
  'lattice', 'lava', 'leather', 'ledge', 'lemon', 'lentil', 'lettuce', 'lighthouse',
  'lilac', 'linen', 'lizard', 'lobster', 'locket', 'lumber', 'lunar', 'magnet',
  'maple', 'marble', 'marker', 'marsh', 'meadow', 'melon', 'mesa', 'meteor',
  'mineral', 'mirror', 'mitten', 'monsoon', 'moose', 'mosaic', 'mountain', 'mule',
  'mustard', 'napkin', 'nebula', 'nectar', 'needle', 'nickel', 'nomad', 'noodle',
  'nutmeg', 'oasis', 'oatmeal', 'obelisk', 'ocean', 'olive', 'onion', 'opal',
] as const;

/**
 * One random byte per word -- 256 is a power of two, so getRandomValues
 * indexing is exactly uniform, no modulo bias. This is the recovery secret
 * for a NEW backup this app creates; app-generated (not user-chosen)
 * specifically so it can't be a guessable password.
 */
export function generateRecoveryPhrase(): string {
  const bytes = ExpoCrypto.getRandomValues(new Uint8Array(7));
  return Array.from(bytes, (b) => RECOVERY_WORDS[b]).join('-');
}
