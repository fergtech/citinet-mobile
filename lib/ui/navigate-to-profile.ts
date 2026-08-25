import { router } from 'expo-router';

// The one rule for every avatar/username shown anywhere in the app: it's a
// tap target to that user's profile. Your own → the Profile tab itself
// (app/(tabs)/profile.tsx); anyone else → the pushed other-member screen
// (app/profile/[userId].tsx), which has no Settings section, just identity
// and a Message CTA.
export function goToProfile(userId: string | null, currentUserId: string) {
  if (!userId) return;
  if (userId === currentUserId) {
    router.push('/profile');
  } else {
    router.push({ pathname: '/profile/[userId]', params: { userId } });
  }
}
