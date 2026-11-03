# Android build (Capacitor 6)

The APK bundles the web app (repo root files) inside a Capacitor WebView. Plugins: @capacitor/filesystem + @capacitor/share (v1.1: Download saves files to Documents/SkillChat, or opens the share sheet), and since v1.2 our own small native plugin **VideoShare** (`VideoSharePlugin.java`, registered in `MainActivity.java`) for "Post a video".

VideoShare: the web app writes the picked video into the app cache (Filesystem, in 3 MB chunks), then calls `VideoShare.share({ uri, text, pkg, alt, mime })`. The plugin copies the caption to the clipboard, and fires `ACTION_SEND` (`video/*`, `EXTRA_STREAM` = FileProvider content uri, `EXTRA_TEXT` = caption, read-permission grant) with `setPackage(pkg)` when that app is installed (YouTube, Instagram, Facebook, WhatsApp, Telegram, X, Snapchat, Moj/Josh, LinkedIn), else the Android chooser. Only files inside the app cache can be shared. Android 11+ package visibility needs the `<queries>` block in `AndroidManifest.xml` (copy of ours in this folder). Picking a video uses Capacitor's built-in WebView file chooser (`<input type="file" accept="video/*">`).

Permissions: INTERNET, plus storage only on old Android (READ up to API 32, WRITE up to API 29). No new permissions in v1.2.

```
npm i @capacitor/core@6.2.3 @capacitor/android@6.2.3 @capacitor/cli@6.2.3 @capacitor/filesystem@6.0.4 @capacitor/share@6.0.4
mkdir www && cp -r ../index.html ../preview.html ../app.* ../lib ../vendor ../icons ../manifest.webmanifest ../sw.js www/
npx cap add android && npx cap sync android
cp MainActivity.java VideoSharePlugin.java android/app/src/main/java/com/techbroz/skillchat/
# merge the <queries> block of AndroidManifest.xml into android/app/src/main/AndroidManifest.xml
cd android && ./gradlew assembleRelease   # sign with your own keystore
```

App id `com.techbroz.skillchat`, version 1.2 (versionCode 3, installs over 1.0 and 1.1). The release keystore is kept outside this repo.
