# Android build (Capacitor 6)

The APK bundles the web app (repo root files) inside a Capacitor WebView. No native plugins, only the INTERNET permission.

```
npm i @capacitor/core@6.2.3 @capacitor/android@6.2.3 @capacitor/cli@6.2.3
mkdir www && cp -r ../index.html ../app.* ../lib ../vendor ../icons ../manifest.webmanifest ../sw.js www/
npx cap add android && npx cap sync android
cd android && ./gradlew assembleRelease   # sign with your own keystore
```

App id `com.techbroz.skillchat`, version 1.0 (versionCode 1). The release keystore is kept outside this repo.
