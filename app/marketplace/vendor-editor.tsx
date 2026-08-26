import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createVendor, getMediaUrl, getMyVendor, updateVendor, uploadFile } from '@/lib/api/hubService';
import { VENDOR_CATEGORIES } from '@/lib/marketplace/categories';
import { useSession } from '@/lib/session/session-context';

// Creates or updates the caller's one-per-account vendor page (hub_vendors,
// UNIQUE(owner_user_id)) — the real server requires this to exist before any
// listing can be posted, so this screen is both a standalone "Edit vendor
// page" destination (from the vendor profile's pencil) and a gate step in
// the "Sell or give something" flow (see app/marketplace/editor.tsx, which
// pushes here when getMyVendor() comes back null and picks the change back
// up via useFocusEffect once this pops).
export default function VendorEditorScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();

  const [isEdit, setIsEdit] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState(VENDOR_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [hours, setHours] = useState('');
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getMyVendor(session.hub.tunnelUrl, session.token)
      .then((vendor) => {
        if (cancelled || !vendor) return;
        setIsEdit(true);
        setName(vendor.name);
        setCategory(vendor.category || VENDOR_CATEGORIES[0]);
        setDescription(vendor.description ?? '');
        setEmail(vendor.contact_email ?? '');
        setPhone(vendor.contact_phone ?? '');
        setWebsite(vendor.website ?? '');
        setHours(vendor.hours ?? '');
        if (vendor.logo_file_name) {
          setLogoFileName(vendor.logo_file_name);
          getMediaUrl(session.hub.tunnelUrl, session.token, vendor.logo_file_name)
            .then(setLogoUri)
            .catch(() => {});
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load your vendor page.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handlePickLogo() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is needed to set a logo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !session) return;
    const asset = result.assets[0];
    setUploadingLogo(true);
    setError(null);
    setLogoUri(asset.uri);
    try {
      const uploaded = await uploadFile(session.hub.tunnelUrl, session.token, {
        uri: asset.uri,
        name: asset.fileName ?? `vendor-logo-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      setLogoFileName(uploaded.file_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that logo.");
      setLogoUri(null);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSave() {
    if (!session || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const data = {
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        logo_file_name: logoFileName,
        contact_email: email.trim() || undefined,
        contact_phone: phone.trim() || undefined,
        website: website.trim() || undefined,
        hours: hours.trim() || undefined,
      };
      if (isEdit) {
        await updateVendor(session.hub.tunnelUrl, session.token, data);
      } else {
        await createVendor(session.hub.tunnelUrl, session.token, data);
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your vendor page.");
      setSaving(false);
    }
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={styles.cancel}>Cancel</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          {isEdit ? 'Edit vendor page' : 'Create vendor page'}
        </ThemedText>
        <Pressable
          onPress={handleSave}
          disabled={loading || saving || uploadingLogo || !name.trim()}
          style={[styles.saveButton, { opacity: loading || saving || uploadingLogo || !name.trim() ? 0.4 : 1 }]}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <ThemedText style={styles.saveLabel} lightColor="#fff" darkColor="#fff">Save</ThemedText>}
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic">
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {!isEdit && (
            <ThemedText style={styles.intro}>
              Create a vendor page to list products and services on the community marketplace. Your existing account stays the same.
            </ThemedText>
          )}

          <ThemedText style={styles.sectionLabel}>Logo</ThemedText>
          <Pressable onPress={handlePickLogo} disabled={uploadingLogo} style={styles.logoPicker}>
            {logoUri ? (
              <Image source={{ uri: logoUri }} style={styles.logoImage} contentFit="cover" />
            ) : (
              <IconSymbol name="storefront.fill" size={24} color={Colors[colorScheme].icon} />
            )}
            {uploadingLogo && (
              <View style={styles.logoUploadingOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </Pressable>

          <ThemedText style={styles.sectionLabel}>Vendor / organization name</ThemedText>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Corner Bakery, Freelance Tech Help"
            placeholderTextColor={Colors[colorScheme].icon}
            maxLength={100}
            style={[styles.input, { color: Colors[colorScheme].text }]}
          />

          <ThemedText style={styles.sectionLabel}>Category</ThemedText>
          <View style={styles.categoryGrid}>
            {VENDOR_CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <Pressable key={cat} onPress={() => setCategory(cat)} style={[styles.categoryChip, active && { backgroundColor: Brand }]}>
                  <ThemedText style={styles.categoryLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                    {cat}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          <ThemedText style={styles.sectionLabel}>Description</ThemedText>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What do you offer? Tell your neighbors about your business or organization."
            placeholderTextColor={Colors[colorScheme].icon}
            multiline
            textAlignVertical="top"
            maxLength={500}
            style={[styles.textarea, { color: Colors[colorScheme].text }]}
          />

          <ThemedText style={styles.sectionLabel}>Email</ThemedText>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="contact@example.com"
            placeholderTextColor={Colors[colorScheme].icon}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[styles.input, { color: Colors[colorScheme].text }]}
          />

          <ThemedText style={styles.sectionLabel}>Phone</ThemedText>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 000-0000"
            placeholderTextColor={Colors[colorScheme].icon}
            keyboardType="phone-pad"
            style={[styles.input, { color: Colors[colorScheme].text }]}
          />

          <ThemedText style={styles.sectionLabel}>Website</ThemedText>
          <TextInput
            value={website}
            onChangeText={setWebsite}
            placeholder="yoursite.com"
            placeholderTextColor={Colors[colorScheme].icon}
            autoCapitalize="none"
            style={[styles.input, { color: Colors[colorScheme].text }]}
          />

          <ThemedText style={styles.sectionLabel}>Hours</ThemedText>
          <TextInput
            value={hours}
            onChangeText={setHours}
            placeholder="Mon-Fri 9am-5pm"
            placeholderTextColor={Colors[colorScheme].icon}
            style={[styles.input, { color: Colors[colorScheme].text }]}
          />
        </ScrollView>
      )}
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
  saveButton: {
    backgroundColor: Brand,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  saveLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  spinner: {
    marginTop: 40,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  error: {
    color: '#b0392f',
    fontSize: 13,
    marginBottom: 12,
  },
  intro: {
    fontSize: 12.5,
    opacity: 0.6,
    lineHeight: 17,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  logoPicker: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8881',
    borderWidth: 1,
    borderColor: '#8884',
    borderStyle: 'dashed',
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  logoUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    fontSize: 16,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  textarea: {
    fontSize: 15,
    lineHeight: 21,
    minHeight: 90,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
