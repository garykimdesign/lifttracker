# LiftTracker · Android (Trusted Web Activity)

This folder wraps the hosted PWA in a native Android shell using a
[Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity/).
The app runs full-screen in Chrome's engine (no URL bar), shows up as a normal app, and can be
published to Google Play. The web app itself is served from Firebase Hosting, so updates ship
without a new APK.

> You don't strictly need this: on Android, opening the hosted URL in Chrome → menu → **Install app**
> gives the same full-screen experience. The TWA is for a Play Store listing / a signed APK you can sideload.

## 1. Deploy the PWA

```bash
cd ..            # project root
firebase deploy --only hosting   # → https://gen-lang-client-0529107446.web.app
```

If you host elsewhere, update the host in **both** `app/build.gradle` (`hostName`, `defaultUrl`) and
`app/src/main/res/values/strings.xml` (`asset_statements`).

## 2. Signing key → Digital Asset Links

Create (or reuse) an upload key and read its SHA‑256:

```bash
keytool -genkeypair -v -keystore lifttracker.keystore -alias lifttracker -keyalg RSA -keysize 2048 -validity 10000
keytool -list -v -keystore lifttracker.keystore -alias lifttracker | grep SHA256
```

Paste the fingerprint into `../.well-known/assetlinks.json`
(`sha256_cert_fingerprints`) and redeploy hosting. If you use **Play App Signing**, use the
*App signing key certificate* fingerprint from Play Console → Setup → App integrity instead
(you can list both).

Verify: `https://<host>/.well-known/assetlinks.json` returns JSON with
`"package_name": "app.lifttracker.twa"`. Without a valid statement the app still runs but shows
Chrome's URL bar.

## 3. Build

Open `android/` in Android Studio and **Build → Generate Signed Bundle/APK**, or:

```bash
cd android
gradle wrapper            # once, if ./gradlew is missing
./gradlew assembleRelease # → app/build/outputs/apk/release/
```

Signing config: add a `signingConfigs { release { storeFile file("../lifttracker.keystore") … } }`
block to `app/build.gradle`, or sign in Android Studio.

## 4. Google sign-in inside the TWA

Firebase Auth runs in Chrome, so the web app's authorized domain (your hosting domain) is all that's
needed — no Android OAuth client. Sign-in uses a popup first and falls back to redirect automatically.

## Alternative: Bubblewrap

`npx @bubblewrap/cli init --manifest https://<host>/manifest.webmanifest` generates an
equivalent project interactively if you prefer a wizard.
