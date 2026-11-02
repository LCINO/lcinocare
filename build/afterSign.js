'use strict';

// LcinoCare — afterSign notarization hook (electron-builder).
// Notarization runs ONLY when credentials are present in the environment,
// so unsigned/local builds never fail. Set these before `npm run dist`:
//   export APPLE_ID="your@apple.id"
//   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  (appleid.apple.com → App-Specific Passwords)
//   export APPLE_TEAM_ID="XXXXXXXXXX"
// (Alternative: `xcrun notarytool store-credentials lcino-notary` once, and
//  set APPLE_KEYCHAIN_PROFILE=lcino-notary instead.)

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const hasEnvCreds = !!process.env.APPLE_ID && !!process.env.APPLE_APP_SPECIFIC_PASSWORD && !!process.env.APPLE_TEAM_ID;
  const hasKeychainProfile = !!process.env.APPLE_KEYCHAIN_PROFILE;
  if (!hasEnvCreds && !hasKeychainProfile) {
    console.log('  • skipping notarization: no APPLE_ID credentials in environment (unsigned dev build)');
    return;
  }
  if (!process.env.APPLE_TEAM_ID && hasEnvCreds) {
    console.log('  • skipping notarization: APPLE_TEAM_ID missing');
    return;
  }

  console.log('  • notarizing with Apple — this can take a few minutes…');

  const { notarize } = require('@electron/notarize');
  const options = hasKeychainProfile
    ? { tool: 'notarytool', appPath, keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE }
    : {
        tool: 'notarytool',
        appPath,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID
      };

  await notarize(options);
  console.log('  • notarization complete ✓');
};
