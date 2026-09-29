import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';

import { uploadAvatar } from '@/lib/api/hubService';
import { prepareAvatarForUpload } from '@/lib/media/prepare-image-upload';
import { bumpAvatarVersion } from '@/lib/session/avatar-version';
import { useSession } from '@/lib/session/session-context';

// Pick -> square-crop -> shrink -> upload -> bust the avatar cache, shared by
// every place that lets someone change their own photo (Account Settings and
// the "Me" tab) so they can't drift apart.
export function useChangeAvatar() {
  const { session } = useSession();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changePhoto = useCallback(async () => {
    if (!session || uploading) return;
    setError(null);
    // Native square crop UI — an avatar is drawn as a circle, so the user
    // should choose which part of the photo lands inside it.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const uri = await prepareAvatarForUpload(asset.uri, asset.width, asset.height);
      await uploadAvatar(session.hub.tunnelUrl, session.token, { uri, name: 'avatar.jpg', type: 'image/jpeg' });
      bumpAvatarVersion(session.userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that photo.");
    } finally {
      setUploading(false);
    }
  }, [session, uploading]);

  return { changePhoto, uploading, error };
}
