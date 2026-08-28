# SOP: per-item network calls need a virtualized list

## The failure pattern

A list row component that fetches something of its own on mount (a media
token, a thumbnail URL, any per-item API call) is safe **only** if the list
rendering it is virtualized. Render that same row via a plain `.map()`
inside a `ScrollView`, and every row mounts at once regardless of scroll
position — so every one of those per-item fetches fires simultaneously the
instant the screen/tab renders, not as the user actually scrolls to them.

Concretely hit this in `app/(tabs)/discover.tsx`'s Files tab:
`FileRow` → `HubMedia` → `getMediaUrl()` → `POST /api/files/:name/token`,
once per image/video file, in a `useEffect` on mount. The tab rendered
`publicFiles.map(file => <FileRow .../>)` inside the shared outer
`ScrollView`, so a file-heavy hub fired dozens of simultaneous token
requests on tab load and tripped the server's rate limiter — reported as a
"too many requests" error surfacing in the UI.

## How to recognize it

Two things both have to be true:

1. **The row component fetches on mount.** Look for a `useEffect` (or
   equivalent) in the row/card component that calls an API — most commonly
   `HubMedia` (`getMediaUrl`), but any per-item fetch counts.
2. **The list isn't virtualized.** A plain `View`/`<>` wrapping a
   `.map()`, especially one sitting inside (or as a direct child of) a
   `ScrollView`, mounts every item unconditionally. `FlatList` (or
   `SectionList`) only mounts items near the current viewport and unmounts
   ones that scroll far away, so per-item effects only fire for items that
   actually come into view.

Not every list needs this — a short, bounded list (a handful of items,
never user-generated-content-scale) is fine as a plain `.map()` even if its
rows fetch something. The risk is specifically **unbounded list length ×
per-item network call**.

## The fix

Reference implementation: `app/(tabs)/discover.tsx`'s Files tab
(`filesListRef`, and the `listWrap` split around it).

1. **Give the list its own `FlatList`**, not a `.map()` inside the shared
   `ScrollView`. If the screen has one big outer `ScrollView` shared across
   several tabs/sections (as Discover does), don't nest the `FlatList`
   inside it — React Native warns against nesting a `VirtualizedList`
   inside a plain `ScrollView` with the same scroll orientation, and it
   silently defeats the virtualization (the outer ScrollView forces the
   inner list to measure/render everything anyway). Instead, conditionally
   render *either* the FlatList *or* the shared ScrollView-wrapped content,
   so the FlatList is its own top-level scroll container when that
   tab/section is active.
2. **Carry over whatever the shared ScrollView was doing**: same
   `contentContainerStyle` (including any `paddingBottom` for safe-area/tab
   bar clearance), same `onScroll`/`scrollEventThrottle` if the screen
   tracks scroll offset (e.g. for a "tap the tab bar icon to scroll to
   top" gesture), same empty-state handling via `ListEmptyComponent`
   instead of an inline `{list.length === 0 && ...}` check.
3. **If the screen has a shared scroll-to-top ref** (`scrollRef` pointing
   at the ScrollView), add a second ref for the FlatList
   (`someListRef = useRef<FlatList>(null)`) and call both refs' scroll
   methods at the point that triggers it — `ScrollView.scrollTo({y: 0,
   animated: true})` vs `FlatList.scrollToOffset({offset: 0, animated:
   true})` are different methods. Optional-chaining both is fine — only
   the one actually mounted will do anything.
4. Default `FlatList` tuning (`initialNumToRender`, `windowSize`,
   `maxToRenderPerBatch`) is a reasonable starting point; only override it
   if a specific list needs a different balance of "rows ready before you
   scroll to them" vs "requests fired at once."

## Known candidate, not yet fixed

`app/(tabs)/discover.tsx`'s **Marketplace** tab (`ListingCard` grid) has
the same shape — non-virtualized `.map()`, and listing cards likely also
pull media per card — but wasn't fixed alongside Files since the hub's
seeded marketplace data is small enough that it hasn't actually tripped
anything yet. Revisit with the same fix above if/when marketplace listings
grow past a handful of items, or if this same "too many requests" symptom
shows up there.

## General rule for new screens/features

Before shipping any new list/feed of user-generated or hub content: check
whether its row component does a per-item fetch, and if so, render it via
`FlatList` from the start rather than a `.map()` — cheaper to build it
right the first time than to retrofit it once real data volume exposes the
burst-of-requests problem.
