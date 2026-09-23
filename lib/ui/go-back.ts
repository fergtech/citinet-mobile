import { router } from 'expo-router';

// router.back() throws "The action 'GO_BACK' was not handled by any
// navigator" (dev-only warning, silent no-op in production — the user is
// just stuck on the screen) whenever the current screen has no back
// history: a deep link, a push notification, or a dev Fast Refresh that
// remounted the navigator with this route as its initial one. Every caller
// that pops "back" after some action (closing a header, finishing a
// delete/upload) means "return to wherever makes sense," so falling back to
// the home tab is the right default when there's nothing to pop to.
export function goBack(fallbackHref: Parameters<typeof router.replace>[0] = '/') {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallbackHref);
  }
}
