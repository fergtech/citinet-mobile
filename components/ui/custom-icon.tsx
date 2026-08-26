import Svg, { Path } from 'react-native-svg';

// True vector rendering (react-native-svg, already a project dependency) —
// not a rasterized bitmap, so it scales as crisply as IconSymbol's native
// SF Symbols/MaterialIcons at any size/density. "search"/"plus" path data is
// lifted directly from the source icon set's Android vector-drawable XML
// (H:\Apps\custom-icons), each already authored on a 0–24 viewBox.
//
// "home" is hand-authored, not lifted: its exported XML is corrupted (a
// single incomplete path fragment, not a full house outline), and there's no
// PDF/SVG source in the iOS export either — only raster PNGs, which is the
// same crispness problem this component exists to avoid. Traced by eye
// against home-ios/48pt.xcassets's PNG (rounded roof peak/shoulders/bottom
// corners via SVG arcs at each vertex, inset by that corner's radius along
// both adjacent edges — not a close approximation via bezier curves, which
// kept producing a visible kink at the shoulder). Close to the source glyph,
// not pixel-identical to it.
//
// Exported so components/create-tab-button.tsx can reuse the exact same
// "plus" path data for its own animated (Reanimated-driven fill color)
// rendering instead of duplicating the raw path string.
export const ICON_PATHS = {
  home: 'M13.56,3.56 L18.59,8.59 A2,2 0 0 1 20,12 L20,18.8 A2.2,2.2 0 0 1 17.8,21 L6.2,21 A2.2,2.2 0 0 1 4,18.8 L4,12 A2,2 0 0 1 5.41,8.59 L10.44,3.56 A2.2,2.2 0 0 1 13.56,3.56 Z M9,21 L9,15 A3,3 0 0 1 15,15 L15,21 Z',
  search:
    'M18.9,16.776A10.539,10.539,0,1,0,16.776,18.9l5.1,5.1L24,21.88ZM10.5,18A7.5,7.5,0,1,1,18,10.5,7.507,7.507,0,0,1,10.5,18Z',
  plus: 'M21.868,11.017c-.15-.038-3.519-.874-8.803-.977,.172-4.325,.856-7.062,.864-7.093,.204-.802-.28-1.619-1.082-1.824-.803-.205-1.618,.277-1.824,1.08-.036,.14-.789,3.123-.961,7.861-4.806,.17-7.792,.918-7.932,.954-.802,.205-1.286,1.021-1.082,1.823,.204,.802,1.021,1.29,1.822,1.084,.031-.008,2.774-.688,7.167-.857,.104,5.273,.944,8.589,.987,8.734,.315,1.077,1.368,1.209,1.827,1.075,.795-.233,1.284-1.025,1.078-1.827-.008-.033-.789-3.13-.891-8.01,4.904,.1,8.065,.876,8.098,.885,.881,.256,1.648-.409,1.82-1.089,.202-.803-.284-1.617-1.086-1.82Z',
} as const;

export type CustomIconName = keyof typeof ICON_PATHS;

export function CustomIcon({ name, size = 24, color }: { name: CustomIconName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* evenodd only matters for "home" — its second subpath (the door) is
          a hole cut from the first (the body); nonzero would just fill both
          solid. search/plus have no overlapping subpaths, so this is a no-op
          for them either way. */}
      <Path d={ICON_PATHS[name]} fill={color} fillRule={name === 'home' ? 'evenodd' : undefined} />
    </Svg>
  );
}
