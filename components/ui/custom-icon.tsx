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
// "plus" (2nd source pass) is lifted from plus-android (2)'s pathData too,
// but that file declares viewportWidth/Height="24" while its own path
// coordinates run on a 512-unit grid — scaled down by 24/512 here so it
// lands correctly in this component's 0-24 viewBox. Replaced an earlier
// trace (from plus-android (1)) the user found "too playfully shaped";
// this one is the plain Material-style rounded plus — straight arms,
// rounded outer tips only.
//
// "bell" is lifted directly from bell-android's pathData, same as
// search/plus — its viewportWidth/Height="24" actually matches its own
// coordinate range this time (unlike plus's 512-grid mismatch), so no
// rescale needed. Two disjoint subpaths (dome body, then the separate
// bottom clapper crescent) — verified against bell-ios/48pt's PNG via the
// same scratchpad render-and-compare pass as every other icon here.
//
// Exported so components/create-tab-button.tsx can reuse the exact same
// "plus" path data for its own animated (Reanimated-driven fill color)
// rendering instead of duplicating the raw path string.
export const ICON_PATHS = {
  home: 'M13.56,3.56 L18.59,8.59 A2,2 0 0 1 20,12 L20,18.8 A2.2,2.2 0 0 1 17.8,21 L6.2,21 A2.2,2.2 0 0 1 4,18.8 L4,12 A2,2 0 0 1 5.41,8.59 L10.44,3.56 A2.2,2.2 0 0 1 13.56,3.56 Z M9,21 L9,15 A3,3 0 0 1 15,15 L15,21 Z',
  search:
    'M18.9,16.776A10.539,10.539,0,1,0,16.776,18.9l5.1,5.1L24,21.88ZM10.5,18A7.5,7.5,0,1,1,18,10.5,7.507,7.507,0,0,1,10.5,18Z',
  plus: 'M22.5,10.5H13.5V1.5c0,-0.8284,-0.6716,-1.5,-1.5,-1.5s-1.5,0.6716,-1.5,1.5v9H1.5c-0.8284,0,-1.5,0.6716,-1.5,1.5s0.6716,1.5,1.5,1.5h9v9c0,0.8284,0.6716,1.5,1.5,1.5s1.5,-0.6716,1.5,-1.5V13.5h9c0.8284,0,1.5,-0.6716,1.5,-1.5S23.3284,10.5,22.5,10.5z',
  bell: 'M4.068,18H19.724a3,3,0,0,0,2.821-4.021L19.693,6.094A8.323,8.323,0,0,0,11.675,0h0A8.321,8.321,0,0,0,3.552,6.516l-2.35,7.6A3,3,0,0,0,4.068,18Z M7.1,20a5,5,0,0,0,9.8,0Z',
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
