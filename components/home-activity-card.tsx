import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image as RNImage, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { LeafletMap } from '@/components/atlas/leaflet-map';
import { HubMedia } from '@/components/hub-media';
import { VendorLogo } from '@/components/marketplace/vendor-logo';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Brand } from '@/constants/theme';
import { initiativeBannerUrl } from '@/lib/api/hubService';
import { AtlasPin } from '@/lib/api/types';
import { findNearestPanoramaxImage, type PanoramaxImage } from '@/lib/atlas/panoramax';
import { fetchPlacePhoto, type PlacePhoto } from '@/lib/atlas/place-photo';
import { peekCardVisual, readCardVisual, writeCardVisual } from '@/lib/atlas/card-visual-cache';
import { geocodeLocation } from '@/lib/atlas/geocoding';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { initiativeCategoryMeta, initiativeCategoryPresetImage, initiativeColor } from '@/lib/initiatives/meta';
import { goToProfile } from '@/lib/ui/navigate-to-profile';

// Card styling lifted from the Sept 1 2026 Home "Featured" carousel
// (components/featured-carousel.tsx's FeaturedCard, commit a8b8c7b) — same
// radius/border/typography, minus the admin-dismiss ✕ and made full-width
// for a vertical list instead of a fixed-250 horizontal strip. Media no
// longer sits behind a scrim as a cover: it renders under the text, at its
// own aspect ratio, just above the author line.

export type HomeActivityCardData = {
  key: string;
  // Brand-colored eyebrow, e.g. "EVENT" / "DISCUSSION" (the old
  // FeaturedItem.category_label).
  label: string;
  title: string;
  caption?: string | null;
  authorUsername?: string | null;
  authorId?: string | null;
  mediaFileName?: string | null;
  // Defaults to true (post/pin/event attachments are always public
  // server-side). Marketplace listing images aren't marked that way — the
  // listing detail loads them through the authenticated path — so listing
  // cards pass false.
  mediaIsPublic?: boolean;
  // Marketplace cards: shown in place of the media when the listing has no
  // image — the same solid category-color box + big category icon the
  // listing detail screen uses (app/marketplace/[id].tsx).
  placeholder?: { color: string; icon: IconSymbolName };
  // Marketplace cards: the vendor responsible, shown at the bottom where an
  // author would be, tappable to the vendor page.
  vendor?: { id: string; name: string; logoFileName: string | null };
  // Initiative cards: same visual the Initiatives list uses — the user-
  // uploaded banner if there is one, else the category's preset photo, else
  // the initiative's solid color with its category icon.
  initiativeVisual?: { id: string; category: string; colorName: string; hasBannerImage: boolean };
  // Set on Atlas cards. When the pin has no uploaded photo (mediaFileName),
  // the card shows a place photo / street-view still / mini-map instead — see
  // AtlasVisual below.
  atlasPin?: AtlasPin;
  // Set on Event cards. Visual precedence: a location Atlas recognizes (the
  // event's own linked/matching pin, else a geocode of its location text) →
  // minimap; else the event's own photo/video (mediaFileName); else the
  // calendar sticker. See EventVisual below.
  eventVisual?: { location: string | null; pin: AtlasPin | null };
  onPress: () => void;
};

type Props = {
  card: HomeActivityCardData;
  tunnelUrl: string;
  token: string;
  currentUserId: string;
};

// Home's list pads 20px each side (styles.cardList in app/(tabs)/index.tsx);
// the card's own text padding is 12px each side.
const LIST_PADDING = 20;
const CARD_PADDING = 12;
// Until the file reports its real size (see HubMedia's onSize), hold a
// neutral 4:3 box so the card doesn't jump from zero height.
const FALLBACK_RATIO = 4 / 3;

// How long a mini-map gets to report Leaflet is up before it's treated as
// failed (offline / script blocked → LeafletMap's 'ready' never arrives).
const MAP_READY_TIMEOUT_MS = 8000;
const LOCATION_STICKER = require('@/assets/images/location.png');

// Non-interactive mini-map filling its parent box. pointerEvents="none" takes
// the WebView out of touch hit-testing entirely — a transparent overlay isn't
// enough, since the WebView still receives the touch natively and pans/zooms
// (and the card's onPress then fires on release). With this, touches land on
// the card's own Pressable (and scrolling the list) as if the map weren't there.
// If the map never comes up, `onFail` fires; with no `onFail`, the location
// sticker takes the map's place.
function MapFill({ pin, center, onFail }: { pin: AtlasPin | null; center: [number, number]; onFail?: () => void }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => {
      setFailed(true);
      onFail?.();
    }, MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onFail is a fresh closure each render; only `ready` should reset the timer.
  }, [ready]);

  if (failed && !onFail) {
    return <RNImage source={LOCATION_STICKER} resizeMode="contain" style={[StyleSheet.absoluteFill, styles.stickerFill]} />;
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LeafletMap
        pins={pin ? [pin] : []}
        center={center}
        zoom={16}
        style={StyleSheet.absoluteFill}
        onReady={() => setReady(true)}
      />
    </View>
  );
}

const CALENDAR_STICKER = require('@/assets/images/calendar.png');
const stickerSource = RNImage.resolveAssetSource(CALENDAR_STICKER);
const STICKER_RATIO = stickerSource?.width && stickerSource?.height ? stickerSource.width / stickerSource.height : 1;
const STICKER_HEIGHT = 140;

// Event cards' fallback chain — see HomeActivityCardData.eventVisual. While
// a location is still being geocoded it holds an empty map-sized box, so the
// card doesn't flash the photo/sticker and then swap to the map.
function EventVisual({
  card,
  tunnelUrl,
  token,
  innerWidth,
  maxHeight,
  renderMedia,
}: {
  card: HomeActivityCardData;
  tunnelUrl: string;
  token: string;
  innerWidth: number;
  maxHeight: number;
  renderMedia: () => React.ReactNode;
}) {
  const { location, pin } = card.eventVisual!;
  const hubCenter = useHubCenter();
  const geoKey = location?.trim() ? `geo:${location.trim().toLowerCase()}` : null;
  const knownCoords = geoKey ? peekCardVisual<[number, number]>(geoKey) : undefined;
  const [state, setState] = useState<{ status: 'pending' | 'none' | 'found'; coords: [number, number] | null }>(
    pin
      ? { status: 'found', coords: [pin.latitude, pin.longitude] }
      : knownCoords !== undefined
        ? knownCoords
          ? { status: 'found', coords: knownCoords }
          : { status: 'none', coords: null }
        : { status: location?.trim() ? 'pending' : 'none', coords: null }
  );

  useEffect(() => {
    if (pin) {
      setState({ status: 'found', coords: [pin.latitude, pin.longitude] });
      return;
    }
    if (!location?.trim()) {
      setState({ status: 'none', coords: null });
      return;
    }
    let cancelled = false;
    (async () => {
      // Geocoding is a network call to Nominatim; the answer for a given
      // location text doesn't change, so it's cached (memory + disk) and only
      // looked up once.
      const cached = geoKey ? await readCardVisual<[number, number]>(geoKey) : undefined;
      if (cancelled) return;
      if (cached !== undefined) {
        setState(cached ? { status: 'found', coords: cached } : { status: 'none', coords: null });
        return;
      }
      setState({ status: 'pending', coords: null });
      const coords = await geocodeLocation(location.trim(), hubCenter ?? undefined).catch(() => undefined);
      // undefined = the request itself failed → don't cache, retry next time.
      if (coords !== undefined && geoKey) writeCardVisual(geoKey, coords);
      if (cancelled) return;
      setState(coords ? { status: 'found', coords } : { status: 'none', coords: null });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hubCenter is a fresh array each render; location/pin identify the source.
  }, [location, pin?.id]);

  if (state.status === 'pending' || state.status === 'found') {
    const height = Math.min(innerWidth / FALLBACK_RATIO, maxHeight);
    return (
      <View style={[styles.media, styles.atlasBox, { width: height * FALLBACK_RATIO, height }]}>
        {state.status === 'found' && state.coords && (
          <MapFill pin={pin} center={state.coords} onFail={() => setState({ status: 'none', coords: null })} />
        )}
      </View>
    );
  }

  if (card.mediaFileName) return <>{renderMedia()}</>;

  const stickerHeight = Math.min(STICKER_HEIGHT, maxHeight);
  return (
    <RNImage
      source={CALENDAR_STICKER}
      resizeMode="contain"
      style={[styles.media, { width: Math.min(stickerHeight * STICKER_RATIO, innerWidth), height: stickerHeight }]}
    />
  );
}

function InitiativeVisual({
  visual,
  tunnelUrl,
  innerWidth,
  maxHeight,
}: {
  visual: NonNullable<HomeActivityCardData['initiativeVisual']>;
  tunnelUrl: string;
  innerWidth: number;
  maxHeight: number;
}) {
  const presetImage = initiativeCategoryPresetImage(visual.category);
  const [ratio, setRatio] = useState<number | null>(null);
  const hasImage = visual.hasBannerImage || !!presetImage;
  const boxRatio = hasImage ? (ratio ?? FALLBACK_RATIO) : FALLBACK_RATIO;
  const height = Math.min(innerWidth / boxRatio, maxHeight);
  const width = height * boxRatio;

  return (
    <View style={[styles.media, styles.placeholderBox, { width, height, backgroundColor: initiativeColor(visual.colorName) }]}>
      {hasImage ? (
        <Image
          source={visual.hasBannerImage ? { uri: initiativeBannerUrl(tunnelUrl, visual.id) } : presetImage}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          onLoad={(e) => {
            if (e.source.width > 0 && e.source.height > 0) setRatio(e.source.width / e.source.height);
          }}
        />
      ) : (
        <IconSymbol name={initiativeCategoryMeta(visual.category).icon} size={64} color="rgba(255,255,255,0.85)" />
      )}
    </View>
  );
}

// Non-interactive visual for an Atlas pin with no uploaded photo, same
// precedence as app/atlas/[id].tsx's banner: place photo (Wikidata/Wikipedia)
// > Panoramax street-level still > mini-map. The map renders immediately and is
// swapped out if a photo resolves. Purely visual here — taps fall through to
// the card's own onPress (the transparent overlay claims no responder, so the
// WebView underneath can't pan/zoom). Sized like card media: native ratio for
// photos, 4:3 for the map, always within `maxHeight`.
function AtlasVisual({ pin, innerWidth, maxHeight }: { pin: AtlasPin; innerWidth: number; maxHeight: number }) {
  // Looked up once per pin and cached (memory + disk, see
  // lib/atlas/card-visual-cache.ts) — Home remounts/reloads constantly, and
  // these are third-party requests whose answer for a coordinate doesn't change.
  const cacheKey = `atlas:${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}:${pin.title.trim().toLowerCase()}`;
  const initial = peekCardVisual<{ place: PlacePhoto | null; pano: PanoramaxImage | null }>(cacheKey);
  const [placePhoto, setPlacePhoto] = useState<PlacePhoto | null>(initial?.place ?? null);
  const [panoramax, setPanoramax] = useState<PanoramaxImage | null>(initial?.pano ?? null);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readCardVisual<{ place: PlacePhoto | null; pano: PanoramaxImage | null }>(cacheKey);
      if (cancelled) return;
      if (cached !== undefined) {
        setPlacePhoto(cached?.place ?? null);
        setPanoramax(cached?.pano ?? null);
        return;
      }
      const [place, pano] = await Promise.all([
        fetchPlacePhoto(pin.latitude, pin.longitude, pin.title).catch(() => null),
        findNearestPanoramaxImage(pin.latitude, pin.longitude).catch(() => null),
      ]);
      // Both-null is stored as an explicit miss (shorter TTL).
      writeCardVisual(cacheKey, place || pano ? { place, pano } : null);
      if (cancelled) return;
      setPlacePhoto(place);
      setPanoramax(pano);
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, pin.latitude, pin.longitude, pin.title]);

  const photoUri = placePhoto?.url ?? panoramax?.thumbnailUrl ?? null;
  const credit = placePhoto ? placePhoto.attribution : panoramax ? 'Street view via Panoramax' : null;

  // New source → forget the previous source's ratio until it reports its own.
  useEffect(() => {
    setRatio(null);
  }, [photoUri]);

  const boxRatio = photoUri ? (ratio ?? FALLBACK_RATIO) : FALLBACK_RATIO;
  const height = Math.min(innerWidth / boxRatio, maxHeight);
  const width = height * boxRatio;

  return (
    <View style={[styles.media, styles.atlasBox, { width, height }]}>
      {photoUri ? (
        <>
          <Image
            source={{ uri: photoUri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            onLoad={(e) => {
              if (e.source.width > 0 && e.source.height > 0) setRatio(e.source.width / e.source.height);
            }}
          />
          {credit && (
            <View style={styles.atlasCredit}>
              <ThemedText style={styles.atlasCreditLabel} lightColor="#fff" darkColor="#fff">
                {credit}
              </ThemedText>
            </View>
          )}
        </>
      ) : (
        <MapFill pin={pin} center={[pin.latitude, pin.longitude]} />
      )}
    </View>
  );
}

export function HomeActivityCard({ card, tunnelUrl, token, currentUserId }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [ratio, setRatio] = useState<number | null>(null);

  function handleAuthorPress(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    if (card.authorId) goToProfile(card.authorId, currentUserId);
  }

  // Media keeps its own orientation (never cropped): full available width,
  // capped at the height the old 4:5 media card had (cardWidth * 5/4). When
  // the cap bites, the box narrows to keep the ratio rather than cropping.
  const cardWidth = windowWidth - LIST_PADDING * 2;
  const innerWidth = cardWidth - CARD_PADDING * 2;
  const maxHeight = cardWidth * (5 / 4);
  const mediaRatio = ratio ?? FALLBACK_RATIO;
  const mediaHeight = Math.min(innerWidth / mediaRatio, maxHeight);
  const mediaWidth = mediaHeight * mediaRatio;

  const renderMedia = () => (
    <HubMedia
      fileName={card.mediaFileName!}
      tunnelUrl={tunnelUrl}
      token={token}
      isPublic={card.mediaIsPublic ?? true}
      previewSeconds={4}
      contentFit="contain"
      onSize={({ width, height }) => {
        if (width > 0 && height > 0) setRatio(width / height);
      }}
      style={[styles.media, { width: mediaWidth, height: mediaHeight, aspectRatio: undefined }]}
    />
  );

  return (
    <Pressable style={styles.card} onPress={card.onPress}>
      <View style={styles.textArea}>
        <ThemedText style={[styles.categoryLabel, { color: Brand }]}>{card.label}</ThemedText>
        <ThemedText type="defaultSemiBold" numberOfLines={2} style={styles.title}>
          {card.title}
        </ThemedText>
        {card.caption && (
          <ThemedText numberOfLines={3} style={styles.caption}>
            {card.caption}
          </ThemedText>
        )}
        {card.eventVisual ? (
          <EventVisual
            card={card}
            tunnelUrl={tunnelUrl}
            token={token}
            innerWidth={innerWidth}
            maxHeight={maxHeight}
            renderMedia={renderMedia}
          />
        ) : (
          card.mediaFileName && renderMedia()
        )}
        {card.initiativeVisual && (
          <InitiativeVisual visual={card.initiativeVisual} tunnelUrl={tunnelUrl} innerWidth={innerWidth} maxHeight={maxHeight} />
        )}
        {!card.eventVisual && !card.mediaFileName && card.placeholder && (
          <View
            style={[
              styles.media,
              styles.placeholderBox,
              { backgroundColor: card.placeholder.color, width: innerWidth, height: Math.min(innerWidth / FALLBACK_RATIO, maxHeight) },
            ]}>
            <IconSymbol name={card.placeholder.icon} size={64} color="rgba(255,255,255,0.85)" />
          </View>
        )}
        {!card.mediaFileName && card.atlasPin && (
          <AtlasVisual pin={card.atlasPin} innerWidth={innerWidth} maxHeight={maxHeight} />
        )}
        {card.vendor && (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              router.push({ pathname: '/marketplace/vendor/[id]', params: { id: card.vendor!.id } });
            }}
            hitSlop={6}
            style={styles.vendorRow}>
            <VendorLogo
              fileName={card.vendor.logoFileName}
              name={card.vendor.name}
              tunnelUrl={tunnelUrl}
              token={token}
              size={20}
            />
            <ThemedText style={styles.author} numberOfLines={1}>
              {card.vendor.name}
            </ThemedText>
          </Pressable>
        )}
        {card.authorUsername && (
          <Pressable onPress={handleAuthorPress} hitSlop={6} style={styles.authorWrap}>
            <ThemedText style={styles.author}>@{card.authorUsername}</ThemedText>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
    overflow: 'hidden',
    position: 'relative',
  },
  media: {
    alignSelf: 'center',
    marginVertical: 6,
  },
  stickerFill: {
    margin: 12,
  },
  placeholderBox: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vendorRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  atlasBox: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#8882',
  },
  atlasCredit: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  atlasCreditLabel: {
    fontSize: 10.5,
    fontWeight: '600',
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
