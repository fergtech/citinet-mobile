// Same picker as the fresh-onboarding flow ((auth)/hub-select.tsx), reused
// as-is for switching hubs from an already-signed-in session. Registered as
// its own route (rather than reusing the (auth) group directly) because
// Stack.Protected in app/_layout.tsx only mounts (auth) while status is
// 'signedOut' — this route lives in the 'signedIn' Protected block instead,
// so it's reachable via "Switch Hub" without touching any currently-stored
// session. HubSelectScreen itself already detects which context it's in
// (see cameFromActiveSession) and behaves accordingly either way.
export { default } from './(auth)/hub-select';
