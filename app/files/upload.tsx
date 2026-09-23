import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setFileVisibility, uploadFilesWithProgress, type UploadedFile } from '@/lib/api/hubService';
import { FileVisibility } from '@/lib/api/types';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { FILE_KIND_META, fileKind, formatBytes } from '@/lib/files/kind';
import { guessMimeType } from '@/lib/files/mime';
import { useSession } from '@/lib/session/session-context';
import { goBack } from '@/lib/ui/go-back';

// Same cap citinet-web's own uploadFiles() uses before it skips client-side
// encryption — reading/encrypting a file this size fully into memory on a
// phone isn't worth it. Above this, a private upload goes up unencrypted
// rather than failing outright (same silent fallback web takes when it has
// no content key yet either).
const ENCRYPTION_SIZE_LIMIT = 100 * 1024 * 1024;

type UploadPart = { uri: string; name: string; type: string; size?: number };

// Private files are encrypted client-side before upload so the server only
// ever stores opaque ciphertext for them — matching citinet-web's own
// uploadFiles(), and required for ANY client (including this one) to be able
// to preview/download a private file later, since the read side now expects
// ciphertext and decrypts it (see app/files/[id].tsx, lib/files/save-to-device.ts).
async function toUploadPart(
  file: PickedFile,
  encryptFile: (data: Uint8Array) => Promise<Uint8Array | null>
): Promise<UploadPart> {
  const plain: UploadPart = { uri: file.uri, name: file.name, type: file.mimeType, size: file.size };
  if ((file.size ?? 0) > ENCRYPTION_SIZE_LIMIT) return plain;
  try {
    const bytes = await new File(file.uri).bytes();
    const encrypted = await encryptFile(bytes);
    if (!encrypted) return plain; // no content key on this device yet — fall back to plaintext, like web does
    const dest = new File(Paths.cache, `enc-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dest.create({ overwrite: true });
    dest.write(encrypted);
    return { uri: dest.uri, name: file.name, type: file.mimeType, size: encrypted.byteLength };
  } catch {
    return plain; // encryption failed for any reason — upload plaintext rather than block the user
  }
}

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
  const { ensure: ensureE2EKeys, encryptFile } = useE2EKeys();

  // Fire-and-forget: warms up this device's content key so a "Private"
  // upload below doesn't hit an empty key on its first try. Uploading still
  // falls back to plaintext gracefully if this hasn't resolved yet by the
  // time the user hits Upload, so this deliberately doesn't block or
  // redirect the way notes/messages do.
  useEffect(() => {
    ensureE2EKeys();
  }, [ensureE2EKeys]);

  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [visibility, setVisibility] = useState<FileVisibility>('hub');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The Photos library — not just the Files app browser — is how most
  // people expect to attach pictures or videos, so this is a real second
  // entry point alongside "Browse files" below, not a replacement for it.
  // Each pick action ADDS to the running selection (not replaces it) so a
  // batch can mix photos and documents from both pickers before hitting
  // Upload once.
  async function handlePickMedia() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is needed to choose photos or videos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1, allowsMultipleSelection: true });
    if (result.canceled) return;
    const newFiles = result.assets.map((asset, i) => {
      // `|| ` not `??` — some Android pickers return mimeType as '' (falsy but
      // not nullish), which would otherwise slip past a ?? fallback and get
      // stored server-side as a mimeType-less, unclassifiable file.
      const mimeType = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
      const name = asset.fileName ?? `${asset.type === 'video' ? 'video' : 'photo'}-${Date.now()}-${i}.${EXT_FOR_MIME[mimeType] ?? 'jpg'}`;
      return { uri: asset.uri, name, mimeType, size: asset.fileSize };
    });
    setPicked((prev) => [...prev, ...newFiles]);
    setError(null);
  }

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    const newFiles = result.assets.map((asset) => ({
      uri: asset.uri,
      name: asset.name,
      mimeType: guessMimeType(asset.name, asset.mimeType),
      size: asset.size,
    }));
    setPicked((prev) => [...prev, ...newFiles]);
    setError(null);
  }

  function handleRemove(index: number) {
    setPicked((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (!session || picked.length === 0 || uploading) return;
    setUploading(true);
    setProgress(0);
    setError(null);
    let uploaded: UploadedFile[] | undefined;
    try {
      // POST /api/files only ever accepts is_public at create time (private
      // vs. hub) — the real route has no way to set web_public in the same
      // call, so reaching "Public link" is upload-as-hub-shared, then one
      // more PATCH per file to move each into the web tier.
      const isPrivate = visibility === 'private';
      const parts = isPrivate
        ? await Promise.all(picked.map((p) => toUploadPart(p, encryptFile)))
        : picked.map((p) => ({ uri: p.uri, name: p.name, type: p.mimeType, size: p.size }));

      uploaded = await uploadFilesWithProgress(
        session.hub.tunnelUrl,
        session.token,
        parts,
        !isPrivate,
        setProgress,
        folderId ?? null
      );
    } catch (err) {
      // A batch can partially succeed (e.g. one blocked extension mixed in
      // with valid files) — hubService attaches the files that DID make it
      // to the server as err.uploaded so they aren't silently re-sent on
      // retry. Drop just those from the picker and leave the rest for the
      // user to fix or remove.
      const succeededNames = new Set(((err as { uploaded?: UploadedFile[] })?.uploaded ?? []).map((u) => u.file_name));
      if (succeededNames.size) {
        setPicked((prev) =>
          prev.filter((p) => {
            if (succeededNames.has(p.name)) {
              succeededNames.delete(p.name); // only drop one matching entry per name
              return false;
            }
            return true;
          })
        );
      }
      setError(err instanceof Error ? err.message : "Couldn't upload those files.");
      setUploading(false);
      return;
    }
    if (visibility === 'web') {
      await Promise.all(uploaded.map((u) => setFileVisibility(session.hub.tunnelUrl, session.token, u.file_name, 'web')));
    }
    if (uploaded.length === 1) {
      if (fromComposeLauncher) {
        router.dismiss(2);
        router.push({ pathname: '/files/[id]', params: { id: uploaded[0].file_id } });
        return;
      }
      router.replace({ pathname: '/files/[id]', params: { id: uploaded[0].file_id } });
      return;
    }
    // Multiple files were uploaded — there's no single file detail screen to
    // land on, so just return to wherever this screen was opened from (the
    // files list/folder underneath already reflects the new uploads on its
    // own next fetch).
    if (fromComposeLauncher) {
      router.dismiss(2);
      return;
    }
    goBack('/files');
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/files')} hitSlop={12} disabled={uploading} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={[styles.cancel, uploading && { opacity: 0.3 }]}>Cancel</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          {picked.length > 1 ? `Upload ${picked.length} files` : 'Upload a file'}
        </ThemedText>
        <Pressable
          onPress={handleUpload}
          disabled={picked.length === 0 || uploading}
          style={[styles.uploadButton, { opacity: picked.length === 0 || uploading ? 0.4 : 1 }]}>
          <ThemedText style={styles.uploadLabel} lightColor="#fff" darkColor="#fff">
            Upload
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.body}>
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {uploading ? (
          <View style={styles.progressBlock}>
            <ThemedText style={styles.progressLabel}>
              Uploading {picked.length > 1 ? `${picked.length} files… ` : '… '}{progress}%
            </ThemedText>
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

            {picked.map((file, index) => {
              const kind = fileKind(file.name, file.mimeType);
              const kindMeta = FILE_KIND_META[kind];
              return (
                <View key={`${file.uri}-${index}`} style={styles.fileRow}>
                  <View style={[styles.fileTile, { backgroundColor: kindMeta.color }]}>
                    <IconSymbol name={kindMeta.icon} size={18} color="#fff" />
                  </View>
                  <View style={styles.fileText}>
                    <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.fileName}>
                      {file.name}
                    </ThemedText>
                    <ThemedText style={styles.fileMeta}>{formatBytes(file.size ?? 0)}</ThemedText>
                  </View>
                  <Pressable onPress={() => handleRemove(index)} hitSlop={10} accessibilityLabel={`Remove ${file.name}`} accessibilityRole="button">
                    <IconSymbol name="xmark.circle.fill" size={20} color={Colors[colorScheme].icon} />
                  </Pressable>
                </View>
              );
            })}

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
