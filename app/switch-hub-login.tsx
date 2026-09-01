// Same reachability problem switch-hub.tsx solves for hub-select.tsx, one
// step further down the flow: (auth)/login is only mounted while status is
// 'signedOut' (see app/_layout.tsx's Stack.Protected), so a hub picked from
// switch-hub.tsx that needs a real login (no valid stored session) has
// nowhere to push to while another hub is already active. This route lives
// in the 'signedIn' Protected block instead, reusing the exact same screen.
export { default } from './(auth)/login';
