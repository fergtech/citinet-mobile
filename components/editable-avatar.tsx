import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  userId: string | null;
  displayName: string;
  tunnelUrl: string;
  size: number;
  uploading: boolean;
  onPress: () => void;
};

// The signed-in user's own avatar with a camera badge and an upload spinner —
// tapping it starts the change-photo flow (see lib/session/use-change-avatar.ts).
export function EditableAvatar({ userId, displayName, tunnelUrl, size, uploading, onPress }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const badge = Math.round(size * 0.32);
  return (
    <Pressable onPress={onPress} disabled={uploading} accessibilityRole="button" accessibilityLabel="Change profile photo">
      <HubAvatar userId={userId} displayName={displayName} tunnelUrl={tunnelUrl} size={size} />
      <View
        style={[
          styles.badge,
          { width: badge, height: badge, borderRadius: badge / 2, borderColor: Colors[colorScheme].background },
        ]}>
        <IconSymbol name="camera.fill" size={Math.round(badge * 0.5)} color="#fff" />
      </View>
      {uploading && (
        <View style={[styles.spinner, { borderRadius: size / 2 }]}>
          <ActivityIndicator color="#fff" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    borderWidth: 2,
    backgroundColor: '#2b6be6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
