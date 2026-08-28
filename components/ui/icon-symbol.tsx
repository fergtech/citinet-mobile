// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<SymbolViewProps['name'], ComponentProps<typeof MaterialIcons>['name']>;
export type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'safari.fill': 'explore',
  'plus': 'add',
  'message.fill': 'chat-bubble',
  'person.fill': 'person',
  'xmark': 'close',
  'checkmark.circle.fill': 'check-circle',
  'circle': 'radio-button-unchecked',
  'calendar': 'event',
  'photo': 'photo',
  'list.bullet': 'list',
  'mappin.and.ellipse': 'place',
  'shippingbox.fill': 'inventory-2',
  'exclamationmark.triangle.fill': 'warning',
  'chevron.left': 'arrow-back',
  'heart': 'favorite-border',
  'heart.fill': 'favorite',
  'person.crop.circle': 'account-circle',
  'gearshape.fill': 'settings',
  'sun.max.fill': 'light-mode',
  'moon.fill': 'dark-mode',
  'rectangle.portrait.and.arrow.right': 'logout',
  'lock.shield.fill': 'security',
  'bell.fill': 'notifications',
  'globe': 'public',
  'person.2.fill': 'group',
  'lock.fill': 'lock',
  'key.fill': 'vpn-key',
  'trash.fill': 'delete',
  'doc.text.fill': 'description',
  'magnifyingglass': 'search',
  'pin.fill': 'push-pin',
  'archivebox.fill': 'archive',
  'bold': 'format-bold',
  'italic': 'format-italic',
  'textformat': 'title',
  'list.number': 'format-list-numbered',
  'checklist': 'checklist',
  'link': 'link',
  'video.fill': 'videocam',
  'newspaper.fill': 'article',
  'doc.on.doc': 'content-copy',
  'square.and.arrow.up': 'share',
  'exclamationmark.octagon.fill': 'block',
  'building.2.fill': 'apartment',
  'star.fill': 'star',
  'hand.raised.fill': 'volunteer-activism',
  'leaf.fill': 'eco',
  'bookmark.fill': 'bookmark',
  'bookmark': 'bookmark-border',
  'location.fill': 'my-location',
  'pencil': 'edit',
  'bookmark.circle.fill': 'bookmark-added',
  'chevron.down': 'expand-more',
  'chevron.up': 'expand-less',
  'camera.fill': 'photo-camera',
  'arrow.triangle.turn.up.right.diamond.fill': 'directions',
  'view.3d': 'panorama',
  'checkmark.circle': 'check-circle-outline',
  'storefront.fill': 'storefront',
  'tag.fill': 'sell',
  'gift.fill': 'card-giftcard',
  'briefcase.fill': 'work',
  'clock.fill': 'schedule',
  'phone.fill': 'phone',
  'envelope.fill': 'email',
  'eye.fill': 'visibility',
  'eye.slash.fill': 'visibility-off',
  'cart.fill': 'shopping-cart',
  'wrench.and.screwdriver.fill': 'handyman',
  'fork.knife': 'restaurant',
  'desktopcomputer': 'computer',
  'paintpalette.fill': 'palette',
  'ellipsis.circle.fill': 'more-horiz',
  'arrow.up.arrow.down': 'swap-vert',
  'doc.fill': 'picture-as-pdf',
  'doc': 'insert-drive-file',
  'tablecells.fill': 'grid-on',
  'rectangle.fill.on.rectangle.fill': 'slideshow',
  'photo.fill': 'image',
  'waveform': 'audiotrack',
  'externaldrive.fill': 'storage',
  'arrow.down.circle.fill': 'download',
  'star': 'star-border',
  'play.fill': 'play-arrow',
  'pause.fill': 'pause',
  'wifi': 'wifi',
  'antenna.radiowaves.left.and.right': 'settings-input-antenna',
  'hammer.fill': 'build',
  'book.fill': 'menu-book',
  'target': 'track-changes',
  'person.badge.plus': 'person-add',
  'arrow.up.right.square': 'open-in-new',
  'square': 'check-box-outline-blank',
  'checkmark.square.fill': 'check-box',
  'checkmark': 'check',
  'shield.fill': 'shield',
  'flag.fill': 'flag',
  // Comms (calls/broadcasts/rooms) — added alongside that feature.
  'mic.fill': 'mic',
  'mic.slash.fill': 'mic-off',
  'video.slash.fill': 'videocam-off',
  'speaker.wave.2.fill': 'volume-up',
  'speaker.slash.fill': 'volume-off',
  'phone.down.fill': 'call-end',
  'arrow.triangle.2.circlepath.camera.fill': 'flip-camera-ios',
  'rectangle.on.rectangle': 'present-to-all',
  'arrow.up.left.and.arrow.down.right': 'fullscreen',
  'square.grid.2x2': 'grid-view',
  'dot.radiowaves.left.and.right': 'sensors',
  'paperclip': 'attach-file',
  'info.circle': 'info',
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
