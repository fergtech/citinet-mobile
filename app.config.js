// Extends app.json so the `development` EAS profile installs as a separate
// app (own bundle id/scheme/name) instead of overwriting a standalone
// preview/production build already on the device -- both can then coexist.
// APP_VARIANT is set via eas.json's build.development.env for cloud builds,
// and must be set the same way for a local `expo start` dev-client session
// (see README note below) so the dev-client deep link scheme matches.
module.exports = ({ config }) => {
  const isDev = process.env.APP_VARIANT === 'development';
  if (!isDev) return config;

  return {
    ...config,
    name: `${config.name} (Dev)`,
    scheme: `${config.scheme}-dev`,
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}.dev`,
    },
  };
};
