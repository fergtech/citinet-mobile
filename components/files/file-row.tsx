import { Pressable, StyleSheet, View } from 'react-native';

import { HubMedia } from '@/components/hub-media';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { HubFile } from '@/lib/api/types';
import { FILE_KIND_META, fileKind, formatBytes } from '@/lib/files/kind';
import { timeAgo } from '@/lib/ui/time-ago';

export function fileVisibilityMeta(file: HubFile): { icon: 'lock.fill' | 'person.2.fill' | 'globe'; label: string } {
  if (file.web_public) return { icon: 'globe', label: 'Public link' };
  if (file.is_public) return { icon: 'person.2.fill', label: 'Hub' };
  return { icon: 'lock.fill', label: 'Private' };
}

export function FileRow({
  file,
  starred,
  tunnelUrl,
  token,
  onPress,
  onToggleStar,
  onMove,
}: {
  file: HubFile;
  starred: boolean;
  tunnelUrl: string;
  token: string;
  onPress: () => void;
  onToggleStar: () => void;
  // Owner-only "move to folder" action — omitted entirely when there's
  // nowhere to move this file to/from (see app/files/index.tsx's canMove).
  onMove?: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const kind = fileKind(file.file_name, file.mime_type);
  const meta = FILE_KIND_META[kind];
  const vis = fileVisibilityMeta(file);
  // Only image/video decode into an actual thumbnail — everything else keeps the type icon.
  const hasPreview = kind === 'image' || kind === 'video';

  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} style={styles.tapArea}>
        {hasPreview ? (
          <HubMedia
            fileName={file.file_name}
            tunnelUrl={tunnelUrl}
            token={token}
            previewSeconds={4}
            style={styles.thumb}
          />
        ) : (
          <View style={[styles.tile, { backgroundColor: meta.color }]}>
            <IconSymbol name={meta.icon} size={18} color="#fff" />
          </View>
        )}
        <View style={styles.text}>
          <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.name}>
            {file.file_name}
          </ThemedText>
          <View style={styles.metaRow}>
            <IconSymbol name={vis.icon} size={11} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.metaText}>
              {vis.label} · {formatBytes(file.size_bytes)} · {timeAgo(file.uploaded_at)}
            </ThemedText>
          </View>
        </View>
      </Pressable>
      {onMove && (
        <Pressable onPress={onMove} hitSlop={12} style={styles.starButton} accessibilityLabel="Move to folder">
          <IconSymbol name="folder.fill" size={17} color={Colors[colorScheme].icon} />
        </Pressable>
      )}
      <Pressable onPress={onToggleStar} hitSlop={12} style={styles.starButton} accessibilityLabel={starred ? 'Unstar' : 'Star'}>
        <IconSymbol name={starred ? 'star.fill' : 'star'} size={18} color={starred ? Brand : Colors[colorScheme].icon} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  tapArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: 40,
    height: 40,
    aspectRatio: undefined,
    borderRadius: 10,
  },
  text: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 15,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 11.5,
    opacity: 0.6,
  },
  starButton: {
    paddingVertical: 12,
    paddingLeft: 12,
  },
});
