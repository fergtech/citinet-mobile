import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { HubMedia } from '@/components/hub-media';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';
import { FeaturedItem } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';
import { goToProfile } from '@/lib/ui/navigate-to-profile';

type Props = {
  items: FeaturedItem[];
  tunnelUrl: string;
  token: string;
  onDismiss: (id: string) => void;
};

function FeaturedCard({
  item,
  tunnelUrl,
  token,
  onDismiss,
}: {
  item: FeaturedItem;
  tunnelUrl: string;
  token: string;
  onDismiss: (id: string) => void;
}) {
  const { session } = useSession();
  const interactive = item.type === 'post' && !!item.ref_id;
  const hasMedia = !!item.media_file_name || !!item.image_url;

  const Container = interactive ? Pressable : View;

  function handleAuthorPress(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    if (session) goToProfile(item.author_id, session.userId);
  }

  return (
    <Container
      style={[styles.card, hasMedia && styles.cardMedia]}
      {...(interactive
        ? { onPress: () => router.push({ pathname: '/post/[id]', params: { id: item.ref_id! } }) }
        : {})}>
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          onDismiss(item.id);
        }}
        hitSlop={8}
        style={styles.dismiss}
        accessibilityLabel="Dismiss">
        <IconSymbol name="xmark" size={14} color="#fff" />
      </Pressable>

      {hasMedia ? (
        <>
          {item.media_file_name ? (
            <HubMedia
              fileName={item.media_file_name}
              tunnelUrl={tunnelUrl}
              token={token}
              previewSeconds={4}
              style={styles.fullBleedMedia}
            />
          ) : (
            <Image source={{ uri: item.image_url! }} style={styles.fullBleedMedia} contentFit="cover" />
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
            locations={[0, 0.5, 1]}
            style={styles.scrim}>
            <ThemedText type="defaultSemiBold" numberOfLines={2} style={styles.overlayTitle} lightColor="#fff" darkColor="#fff">
              {item.title}
            </ThemedText>
            {item.caption && (
              <ThemedText numberOfLines={2} style={styles.overlayCaption}>
                {item.caption}
              </ThemedText>
            )}
            {item.author_username && (
              <Pressable onPress={handleAuthorPress} hitSlop={6} style={styles.overlayAuthorWrap}>
                <ThemedText style={styles.overlayAuthor}>@{item.author_username}</ThemedText>
              </Pressable>
            )}
            {item.category_label && (
              <ThemedText style={[styles.categoryLabel, { color: Brand }]}>{item.category_label}</ThemedText>
            )}
          </LinearGradient>
        </>
      ) : (
        <View style={styles.textArea}>
          {item.category_label && (
            <ThemedText style={[styles.categoryLabel, { color: Brand }]}>{item.category_label}</ThemedText>
          )}
          <ThemedText type="defaultSemiBold" numberOfLines={2} style={styles.title}>
            {item.title}
          </ThemedText>
          {item.caption && (
            <ThemedText numberOfLines={3} style={styles.caption}>
              {item.caption}
            </ThemedText>
          )}
          {item.author_username && (
            <Pressable onPress={handleAuthorPress} hitSlop={6} style={styles.authorWrap}>
              <ThemedText style={styles.author}>@{item.author_username}</ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </Container>
  );
}

export function FeaturedCarousel({ items, tunnelUrl, token, onDismiss }: Props) {
  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionLabel}>Featured</ThemedText>
      <FlatList
        data={items}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <FeaturedCard item={item} tunnelUrl={tunnelUrl} token={token} onDismiss={onDismiss} />
        )}
      />
    </View>
  );
}

const CARD_WIDTH = 250;

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
    paddingHorizontal: 20,
  },
  list: {
    paddingHorizontal: 20,
    gap: 12,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
    overflow: 'hidden',
    position: 'relative',
  },
  // Media posts get a fixed, taller shape so the full-bleed background has a
  // deliberate frame — text-only cards (no media to sit behind) stay
  // content-sized instead of inheriting this and leaving empty space.
  cardMedia: {
    aspectRatio: 4 / 5,
  },
  dismiss: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Overrides HubMedia's/Image's own default box so it fills the whole
  // card — media is the entire visual, text overlays it (see scrim below)
  // rather than sitting in a separate block underneath.
  fullBleedMedia: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
    width: undefined,
    height: undefined,
    aspectRatio: undefined,
    borderRadius: 0,
  },
  // Spans about half the card so the gradient has room to fade in
  // gradually rather than starting at a hard edge right above the text.
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '50%',
    zIndex: 1,
    justifyContent: 'flex-end',
    padding: 12,
    gap: 3,
  },
  overlayTitle: {
    fontSize: 15.5,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  overlayCaption: {
    fontSize: 13,
    lineHeight: 18,
    color: '#fff',
    opacity: 0.9,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  overlayAuthorWrap: {
    alignSelf: 'flex-start',
  },
  overlayAuthor: {
    fontSize: 12,
    marginTop: 2,
    color: '#fff',
    opacity: 0.85,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  textArea: {
    padding: 12,
    gap: 3,
  },
  categoryLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 14.5,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.75,
  },
  authorWrap: {
    alignSelf: 'flex-start',
  },
  author: {
    fontSize: 12,
    marginTop: 2,
    opacity: 0.6,
  },
});
