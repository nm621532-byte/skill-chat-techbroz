# Android build (Capacitor 6)

The APK bundles the web app (repo root files) inside a Capacitor WebView. Plugins: @capacitor/filesystem + @capacitor/share (v1.1: Download saves files to Documents/SkillChat, or opens the share sheet). Permissions: INTERNET, plus storage only on old Android (READ up to API 32, WRITE up to API 29).

```
npm i @capacitor/core@6.2.3 @capacitor/android@6.2.3 @capacitor/cli@6.2.3 @capacitor/filesystem@6.0.4 @capacitor/share@6.0.4
mkdir www && cp -r ../index.html ../preview.html ../app.* ../lib ../vendor ../icons ../manifest.webmanifest ../sw.js www/
npx cap add android && npx cap sync android
cd android && ./gradlew assembleRelease   # sign with your own keystore
```

App id `com.techbroz.skillchat`, version 1.1 (versionCode 2, installs over 1.0). The release keystore is kept outside this repo.
