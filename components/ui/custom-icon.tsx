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
// "satelliteDish" (replaced the Messages tab's IconSymbol "paperplane.fill")
// is lifted directly from satellite-dish-android's pathData — same as
// "bell", its declared viewportWidth/Height="24" matches its own coordinate
// range, so no rescale needed.
//
// "landLayerLocation" (replaced the home screen Atlas section's IconSymbol
// "chevron.right") is lifted directly from land-layer-location.svg's own
// `d` attribute — already a plain SVG (not an Android vector-drawable this
// time) on a matching 0-24 viewBox, so no rescale needed either.
//
// "bullseyeArrow" (replaced the home screen Initiatives section's IconSymbol
// "target") is lifted directly from bullseye-arrow.svg's `d` attribute —
// its viewBox is 0-24 even though the svg tag also declares width="512"
// height="512" (just export metadata, not the coordinate space the path
// data is actually in), so again no rescale needed.
//
// "commentDots" (replaces the app drawer's Discussions row IconSymbol
// "message.fill") is lifted directly from comment-dots_24.xml's pathData —
// same as bell/satelliteDish, its declared viewportWidth/Height="24" matches
// its own coordinate range, so no rescale needed. Two subpaths form the
// bubble outline itself (an outer boundary and an inner one, wound in
// opposite directions so the default nonzero fill rule renders a hollow
// ring rather than a solid disc — no fillRule override needed, unlike
// "home"), plus three more subpaths for the dots. Verified against
// H:\Apps\custom-icons\comment-dots.png via the same render-and-compare
// pass as every other icon here — this pathData needed zero adjustment,
// it was already an exact match.
//
// "feedGlyph" (replaces the app drawer's Feed row's "commentDots", from when
// that row was still labeled "Discussions") is lifted verbatim from
// citinet-web's own FeedGlyph (src/app/components/icons.tsx) — the icon its
// sidebar/bottom-dock nav already uses for the same destination, so the two
// clients now share one glyph for it. Already a 0-24 viewBox, no rescale
// needed. Three subpaths: a wide top block, a wide bottom block, and a
// narrow full-height left column — reads as a stacked news/article layout.
//
// "citinetLogo" (replaces the app drawer's About row IconSymbol
// "info.circle") is hand-authored, not lifted — H:\Apps\custom-icons\
// apple-touch-icon.svg turned out to be a raster PNG (the same "C" mark
// used for the app's own home-screen icon, see the logoWrap comment above)
// wrapped in `<svg><image href="data:...base64">`, not real path data, so
// this needed the same trace-by-eye treatment as "home". The ring is a
// concentric outer arc (r=10) and inner arc (r=7, opposite sweep) around
// center (13,12), with the two open ends of the "C" capped by small r≈1.54
// rounding arcs (half the outer/inner point-to-point distance, bulging away
// from the ring's center) instead of a plain straight cut — a plain L
// between the arc endpoints reads as a sharp angular chisel-cut tip, this
// reads as a soft rounded one. Three more subpaths for the dots. Authored
// directly on a 0-24 grid, so no rescale needed.
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
  satelliteDish:
    'm20,11c0,.553-.448,1-1,1s-1-.447-1-1c0-2.757-2.243-5-5-5-.552,0-1-.447-1-1s.448-1,1-1c3.86,0,7,3.141,7,7Zm-6,0c0,.553.448,1,1,1s1-.447,1-1c0-1.654-1.346-3-3-3-.552,0-1,.447-1,1s.448,1,1,1,1,.448,1,1ZM13,0c-.552,0-1,.447-1,1s.448,1,1,1c4.962,0,9,4.037,9,9,0,.553.448,1,1,1s1-.447,1-1C24,4.935,19.065,0,13,0Zm3.246,18.351c.552.552.821,1.313.74,2.09-.083.785-.511,1.482-1.175,1.914-1.691,1.099-3.625,1.635-5.549,1.635-2.654,0-5.292-1.019-7.262-2.989C-.399,17.603-.969,12.215,1.646,8.188c.431-.663,1.128-1.092,1.913-1.174.776-.084,1.539.187,2.091.739l4.591,4.591,1.052-1.052c.391-.391,1.023-.391,1.414,0s.391,1.023,0,1.414l-1.052,1.052,4.591,4.591Z',
  landLayerLocation:
    'm16.949,2.05c-1.321-1.322-3.079-2.05-4.949-2.05s-3.628.728-4.95,2.05c-2.729,2.729-2.729,7.17.008,9.907l2.495,2.44c.675.66,1.561.99,2.447.99s1.772-.33,2.447-.99l2.502-2.448c1.322-1.322,2.051-3.08,2.051-4.95s-.729-3.627-2.051-4.95Zm-4.949,7.94c-1.657,0-3-1.343-3-3s1.343-3,3-3,3,1.343,3,3-1.343,3-3,3Zm12,6.772c.002.354-.183.682-.485.863l-9.861,5.917c-.51.306-1.082.459-1.653.459s-1.144-.153-1.653-.459L.485,17.625c-.303-.182-.487-.51-.485-.863.002-.353.19-.679.495-.857l4.855-2.842c.1.11.203.219.309.325l2.495,2.439c1.028,1.006,2.395,1.561,3.846,1.561s2.817-.555,3.846-1.561l2.518-2.463c.098-.098.194-.199.287-.301l4.854,2.841c.305.179.493.505.495.857Z',
  bullseyeArrow:
    'M24,12c0,6.62-5.38,12-12,12S0,18.62,0,12,5.38,0,12,0c.19,0,.38,0,.57,.01,.83,.04,1.47,.74,1.43,1.57-.04,.83-.72,1.45-1.57,1.43-.14,0-.29-.01-.43-.01C7.04,3,3,7.04,3,12s4.04,9,9,9,9-4.04,9-9c0-.14,0-.29-.01-.43-.04-.83,.6-1.53,1.43-1.57,.85-.03,1.53,.6,1.57,1.43,0,.19,.01,.38,.01,.57Zm-13.09-3.85c.8-.23,1.26-1.05,1.04-1.85s-1.06-1.26-1.85-1.04c-3,.85-5.09,3.62-5.09,6.74,0,3.86,3.14,7,7,7,3.12,0,5.89-2.09,6.74-5.09,.23-.8-.24-1.63-1.04-1.85-.8-.23-1.63,.24-1.85,1.04-.48,1.71-2.07,2.91-3.85,2.91-2.21,0-4-1.79-4-4,0-1.78,1.2-3.37,2.91-3.85Zm.03,2.79c-.59,.59-.59,1.54,0,2.12,.29,.29,.68,.44,1.06,.44s.77-.15,1.06-.44l5.06-5.06h2.38c.4,0,.78-.16,1.06-.44l2-2c.43-.43,.56-1.07,.33-1.63-.23-.56-.78-.93-1.39-.93h-1.5V1.5c0-.61-.37-1.15-.93-1.39-.56-.23-1.21-.1-1.63,.33l-2,2c-.28,.28-.44,.66-.44,1.06v2.38l-5.06,5.06Z',
  commentDots:
    'm12,0C5.383,0,0,5.383,0,12s5.383,12,12,12h12v-12C24,5.383,18.617,0,12,0Zm11,23h-11c-6.065,0-11-4.935-11-11S5.935,1,12,1s11,4.935,11,11v11Zm-10-11c0,.552-.448,1-1,1s-1-.448-1-1,.448-1,1-1,1,.448,1,1Zm5,0c0,.552-.448,1-1,1s-1-.448-1-1,.448-1,1-1,1,.448,1,1Zm-10,0c0,.552-.448,1-1,1s-1-.448-1-1,.448-1,1-1,1,.448,1,1Z',
  feedGlyph: 'M7,2h14c1.654,0,3,1.346,3,3v6H7V2Zm0,11v9H24V13H7ZM5,2H3C1.346,2,0,3.346,0,5V22H5V2Z',
  citinetLogo:
    'M21,6 A10,10 0 1 0 21,18 A1.54,1.54 0 0 0 18.5,16.2 A7,7 0 1 1 18.5,7.8 A1.54,1.54 0 0 0 21,6 Z M8.6,13.8 a1,1 0 1 0 2,0 a1,1 0 1 0 -2,0 M11.9,12 a1,1 0 1 0 2,0 a1,1 0 1 0 -2,0 M15.2,10.2 a1,1 0 1 0 2,0 a1,1 0 1 0 -2,0',
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
