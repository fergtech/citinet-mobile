import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { MediaSkeleton } from '@/components/ui/media-skeleton';

// Neutral placeholder tint already used throughout the app for dividers/
// empty-state chrome (post-row.tsx's own borderBottomColor, hub-media.tsx's
// placeholder background, etc.) — reused here so a skeleton reads as part of
// the same visual language, not a bolted-on different gray.
const PLACEHOLDER = '#8882';
const DIVIDER = '#8884';

// Shaped like a real PostRow (components/post-row.tsx: title/body bars, an
// optional media block, then an author-row + footer-icons row) — shown
// instead of a bare spinner on a post/event list's very first load, before
// there's any cached content to seed from (see the dataCache-based caching
// added to Feed/Home/Discover/Events). Each bar is a MediaSkeleton, so the
// whole row reads as "loading," not a wall of static gray boxes.
export function PostRowSkeleton({ withMedia }: { withMedia?: boolean }) {
  return (
    <View style={styles.row}>
      <MediaSkeleton style={styles.titleBar} />
      <MediaSkeleton style={styles.bodyBarFull} />
      <MediaSkeleton style={styles.bodyBarShort} />
      {withMedia && <MediaSkeleton style={styles.media} />}
      <View style={styles.metaRow}>
        <View style={styles.authorGroup}>
          <MediaSkeleton style={styles.avatar} />
          <MediaSkeleton style={styles.authorBar} />
        </View>
        <View style={styles.footerGroup}>
          <MediaSkeleton style={styles.footerPip} />
          <MediaSkeleton style={styles.footerPip} />
          <MediaSkeleton style={styles.footerPip} />
        </View>
      </View>
    </View>
  );
}

// A short stack of PostRowSkeletons, alternating the media block on/off so
// the loading state doesn't look uniform/robotic — used as the initial-load
// placeholder for a pure post/event list (Feed, Events). `style` carries the
// horizontal padding each caller's own list uses (Feed's is 10, Events' is
// 20) — the row itself has none baked in, so the skeleton lines up exactly
// with the real rows that replace it rather than sitting at a different inset.
export function PostListSkeleton({ count = 4, style }: { count?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      {Array.from({ length: count }).map((_, i) => (
        <PostRowSkeleton key={i} withMedia={i % 2 === 0} />
      ))}
    </View>
  );
}

// A single labeled-section placeholder, matching Home/Discover's own
// "uppercase label + content row" convention (see app/(tabs)/index.tsx's
// sectionLabel style) — for dashboard screens whose real sections vary too
// much in shape (a strip here, a grid there, a single row elsewhere) to
// skeleton individually. Generic on purpose: it reads as "a labeled section
// is coming," which is enough to feel like real loading structure rather
// than a spinner, without pretending to preview exact final content.
export function SectionSkeleton() {
  return (
    <View style={styles.section}>
      <MediaSkeleton style={styles.sectionLabel} />
      <MediaSkeleton style={styles.sectionBlock} />
    </View>
  );
}

export function DashboardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <SectionSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DIVIDER,
    paddingVertical: 16,
    gap: 8,
  },
  titleBar: {
    width: '55%',
    height: 15,
    borderRadius: 4,
    backgroundColor: PLACEHOLDER,
  },
  bodyBarFull: {
    width: '95%',
    height: 13,
    borderRadius: 4,
    backgroundColor: PLACEHOLDER,
  },
  bodyBarShort: {
    width: '70%',
    height: 13,
    borderRadius: 4,
    backgroundColor: PLACEHOLDER,
  },
  media: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    backgroundColor: PLACEHOLDER,
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  authorGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: PLACEHOLDER,
  },
  authorBar: {
    width: 90,
    height: 11,
    borderRadius: 4,
    backgroundColor: PLACEHOLDER,
  },
  footerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  footerPip: {
    width: 24,
    height: 14,
    borderRadius: 4,
    backgroundColor: PLACEHOLDER,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
    gap: 10,
  },
  sectionLabel: {
    width: 90,
    height: 10,
    borderRadius: 3,
    backgroundColor: PLACEHOLDER,
  },
  sectionBlock: {
    width: '100%',
    height: 90,
    borderRadius: 12,
    backgroundColor: PLACEHOLDER,
  },
});
