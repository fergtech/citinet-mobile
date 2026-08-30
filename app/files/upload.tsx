import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setFileVisibility, uploadFileWithProgress } from '@/lib/api/hubService';
import { FileVisibility } from '@/lib/api/types';
import { FILE_KIND_META, fileKind, formatBytes } from '@/lib/files/kind';
import { useSession } from '@/lib/session/session-context';

const VISIBILITY_OPTIONS: { value: FileVisibility; label: string; description: string; icon: IconSymbolName }[] = [
  { value: 'private', label: 'Private', description: 'Only you can see this file.', icon: 'lock.fill' },
  { value: 'hub', label: 'Hub shared', description: 'Any signed-in hub member can see this file.', icon: 'person.2.fill' },
  { value: 'web', label: 'Public link', description: 'Anyone with the share link can open this file — no hub account needed.', icon: 'globe' },
];

// Unifies expo-document-picker's DocumentPickerAsset and expo-image-picker's
// ImagePickerAsset into one shape the rest of this screen works with — the
// two libraries name their fields differently (name/mimeType/size vs.
// fileName/mimeType/fileSize) and only one of them ever guarantees a real
// file name.
type PickedFile = { uri: string; name: string; mimeType: string; size?: number };

const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

export default function UploadFileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { from, folderId, folderName } = useLocalSearchParams<{ from?: string; folderId?: string; folderName?: string }>();
  const fromComposeLauncher = from === 'compose';

  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [visibility, setVisibility] = useState<FileVisibility>('hub');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The Photos library — not just the Files app browser — is how most
  // people expect to attach a picture or video, so this is a real second
  // entry point alongside "Browse files" below, not a replacement for it.
  async function handlePickMedia() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is needed to choose a photo or video.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
    const name = asset.fileName ?? `${asset.type === 'video' ? 'video' : 'photo'}-${Date.now()}.${EXT_FOR_MIME[mimeType] ?? 'jpg'}`;
    setPicked({ uri: asset.uri, name, mimeType, size: asset.fileSize });
    setError(null);
  }

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    setPicked({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream', size: asset.size });
    setError(null);
  }

  async function handleUpload() {
    if (!session || !picked || uploading) return;
    setUploading(true);
    setProgress(0);
    setError(null);
    try {
      // POST /api/files only ever accepts is_public at create time (private
      // vs. hub) — the real route has no way to set web_public in the same
      // call, so reaching "Public link" is upload-as-hub-shared, then one
      // more PATCH to move it to the web tier.
      const uploaded = await uploadFileWithProgress(
        session.hub.tunnelUrl,
        session.token,
        { uri: picked.uri, name: picked.name, type: picked.mimeType },
        visibility !== 'private',
        setProgress,
        folderId ?? null
      );
      if (visibility === 'web') {
        await setFileVisibility(session.hub.tunnelUrl, session.token, uploaded.file_name, 'web');
      }
      if (fromComposeLauncher) {
        router.dismiss(2);
        router.push({ pathname: '/files/[id]', params: { id: uploaded.file_id } });
        return;
      }
      router.replace({ pathname: '/files/[id]', params: { id: uploaded.file_id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that file.");
      setUploading(false);
    }
  }

  if (!session) return null;

  const kind = picked ? fileKind(picked.name, picked.mimeType) : null;
  const kindMeta = kind ? FILE_KIND_META[kind] : null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} disabled={uploading} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={[styles.cancel, uploading && { opacity: 0.3 }]}>Cancel</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          Upload a file
        </ThemedText>
        <Pressable
          onPress={handleUpload}
          disabled={!picked || uploading}
          style={[styles.uploadButton, { opacity: !picked || uploading ? 0.4 : 1 }]}>
          <ThemedText style={styles.uploadLabel} lightColor="#fff" darkColor="#fff">
            Upload
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.body}>
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {uploading ? (
          <View style={styles.progressBlock}>
            <ThemedText style={styles.progressLabel}>Uploading… {progress}%</ThemedText>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
          </View>
        ) : (
          <>
            {folderId && (
              <View style={styles.folderBanner}>
                <IconSymbol name="folder.fill" size={15} color={Colors[colorScheme].icon} />
                <ThemedText style={styles.folderBannerText}>Uploading into “{folderName || 'this folder'}”</ThemedText>
              </View>
            )}
            <View style={styles.pickerRow}>
              <Pressable onPress={handlePickMedia} style={[styles.pickerButton, styles.pickerButtonHalf]}>
                <IconSymbol name="photo" size={18} color={Colors[colorScheme].icon} />
                <ThemedText style={styles.pickerButtonLabel}>Photo or video</ThemedText>
              </Pressable>
              <Pressable onPress={handlePickFile} style={[styles.pickerButton, styles.pickerButtonHalf]}>
                <IconSymbol name="doc" size={18} color={Colors[colorScheme].icon} />
                <ThemedText style={styles.pickerButtonLabel}>Browse files</ThemedText>
              </Pressable>
            </View>

            {picked && kindMeta && (
              <View style={styles.fileRow}>
                <View style={[styles.fileTile, { backgroundColor: kindMeta.color }]}>
                  <IconSymbol name={kindMeta.icon} size={18} color="#fff" />
                </View>
                <View style={styles.fileText}>
                  <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.fileName}>
                    {picked.name}
                  </ThemedText>
                  <ThemedText style={styles.fileMeta}>{formatBytes(picked.size ?? 0)}</ThemedText>
                </View>
                <IconSymbol name="checkmark.circle.fill" size={20} color={Brand} />
              </View>
            )}

            <ThemedText style={styles.sectionLabel}>Visibility</ThemedText>
            <View style={styles.visSection}>
              {VISIBILITY_OPTIONS.map((opt) => {
                const selected = visibility === opt.value;
                return (
                  <Pressable key={opt.value} onPress={() => setVisibility(opt.value)} style={styles.visRow}>
                    <IconSymbol name={opt.icon} size={20} color={selected ? Brand : Colors[colorScheme].icon} />
                    <View style={styles.visText}>
                      <ThemedText style={[styles.visLabel, selected && { color: Brand, fontWeight: '600' }]}>{opt.label}</ThemedText>
                      <ThemedText style={styles.visDescription}>{opt.description}</ThemedText>
                    </View>
                    {selected && <IconSymbol name="checkmark.circle.fill" size={18} color={Brand} />}
                  </Pressable>
                );
              })}
            </View>

            <ThemedText style={styles.footnote}>Visibility is changeable after upload.</ThemedText>
          </>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    gap: 10,
  },
  cancel: {
    fontSize: 15,
    opacity: 0.7,
  },
  headerTitle: {
    fontSize: 16,
  },
  uploadButton: {
    backgroundColor: Brand,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  uploadLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  error: {
    color: '#b0392f',
    fontSize: 13,
    marginBottom: 12,
  },
  progressBlock: {
    marginTop: 40,
    gap: 12,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8882',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Brand,
    borderRadius: 4,
  },
  folderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#8881',
  },
  folderBannerText: {
    fontSize: 12.5,
    opacity: 0.75,
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8884',
    borderStyle: 'dashed',
  },
  pickerButtonHalf: {
    flex: 1,
  },
  pickerButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingVertical: 10,
  },
  fileTile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileText: {
    flex: 1,
    gap: 2,
  },
  fileName: {
    fontSize: 14.5,
  },
  fileMeta: {
    fontSize: 12,
    opacity: 0.6,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 4,
  },
  visSection: {
    gap: 0,
  },
  visRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  visText: {
    flex: 1,
    gap: 2,
  },
  visLabel: {
    fontSize: 15,
  },
  visDescription: {
    fontSize: 12.5,
    opacity: 0.6,
    lineHeight: 17,
  },
  footnote: {
    opacity: 0.5,
    fontSize: 12,
    marginTop: 12,
  },
});
