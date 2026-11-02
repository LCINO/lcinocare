# Signing & Notarization — LcinoCare

Everything is already wired. Once you have an Apple Developer membership,
releases become signed, notarized, and free of the right-click → Open dance —
with no code changes needed.

## 1. Join the Apple Developer Program

- <https://developer.apple.com/programs/> — $99/year, approved within a day or two.

## 2. Create a **Developer ID Application** certificate

- **Xcode route (easiest):** Xcode → Settings → Accounts → select your team →
  **Manage Certificates** → **+** → *Developer ID Application*.
- Verify it landed in your keychain:

```bash
security find-identity -v -p codesigning
# should list: "Developer ID Application: Your Name (TEAMID)"
```

## 3. Notarization credentials (one time)

Give Apple your account once, and every build can notarize itself:

```bash
xcrun notarytool store-credentials lcino-notary \
  --apple-id "your@apple.id" \
  --team-id "XXXXXXXXXX" \
  --password "app-specific-password"
```

- The password is an **App-Specific Password**: appleid.apple.com →
  Sign-In and Security → App-Specific Passwords.
- Team ID: developer.apple.com → Membership details.

## 4. Build

```bash
npm run dist
```

electron-builder will automatically:

- sign with your **Developer ID Application** identity (hardened runtime +
  `build/entitlements.mac.plist`),
- notarize through `build/afterSign.js` (reads the keychain profile above, or
  `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` env vars),
- staple the ticket to the app.

## 5. Verify

```bash
spctl -a -vv dist/mac-arm64/LcinoCare.app
# → accepted, source=Notarized Developer ID
xcrun stapler validate dist/mac-arm64/LcinoCare.app
```

## 6. Release

Upload `dist/LcinoCare-arm64.dmg` **and** `dist/latest-mac.yml` to a new
GitHub release — the self-update engine reads `latest-mac.yml` and installs
in place. Signed builds make that update flow fully trusted by Gatekeeper.

---

### Notes

- **No cert yet?** `npm run dist` still works — signing is skipped with a
  log line and the notarization hook steps aside. Users right-click → Open.
- **Entitlements** live in `build/entitlements.mac.plist` (JIT + unsigned
  executable memory + library validation off — what Electron needs).
- The app is intentionally **not** sandboxed (a cleaner needs broad file
  access); Developer ID distribution is the right channel.
