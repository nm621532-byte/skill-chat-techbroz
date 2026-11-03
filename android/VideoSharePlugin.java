package com.techbroz.skillchat;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * "Post a video" bridge (v1.2). The web app writes the picked video into the app cache, then calls
 * VideoShare.share({ uri, text, pkg, alt, mime }). We copy the caption to the clipboard (Instagram ignores
 * EXTRA_TEXT), and fire ACTION_SEND with the video through our FileProvider, aimed at the chosen platform's
 * app when it is installed, otherwise at the Android share sheet. The user taps Post inside that app.
 */
@CapacitorPlugin(name = "VideoShare")
public class VideoSharePlugin extends Plugin {

    private boolean isInstalled(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private File fileFrom(String uri) {
        if (uri == null) return null;
        String path = uri.startsWith("file:") ? Uri.parse(uri).getPath() : uri;
        if (path == null) return null;
        File f = new File(path);
        // Only files inside our own cache may be shared.
        try {
            String cache = getContext().getCacheDir().getCanonicalPath();
            if (!f.getCanonicalPath().startsWith(cache + File.separator)) return null;
        } catch (Exception e) {
            return null;
        }
        return f.exists() ? f : null;
    }

    @PluginMethod
    public void installed(PluginCall call) {
        JSArray out = new JSArray();
        try {
            JSArray pkgs = call.getArray("packages", new JSArray());
            for (int i = 0; i < pkgs.length(); i++) {
                String p = pkgs.getString(i);
                if (isInstalled(p)) out.put(p);
            }
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("installed", out);
        call.resolve(ret);
    }

    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text", "");
        String mime = call.getString("mime", "video/*");
        String title = call.getString("title", "Post video");
        if (mime == null || !mime.startsWith("video/")) mime = "video/*";
        File f = fileFrom(call.getString("uri"));
        if (f == null) {
            call.reject("The video file is missing. Pick the video again.");
            return;
        }
        Context ctx = getContext();
        // 1. caption on the clipboard
        try {
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null && text != null && !text.isEmpty()) cm.setPrimaryClip(ClipData.newPlainText("Caption", text));
        } catch (Exception ignored) {}

        Uri content = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mime);
        send.putExtra(Intent.EXTRA_STREAM, content);
        if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
        send.setClipData(ClipData.newRawUri("", content));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        // 2. the chosen platform's app, if installed
        List<String> targets = new ArrayList<>();
        String pkg = call.getString("pkg", "");
        if (pkg != null && !pkg.isEmpty()) targets.add(pkg);
        try {
            JSArray alt = call.getArray("alt", new JSArray());
            for (int i = 0; i < alt.length(); i++) targets.add(alt.getString(i));
        } catch (Exception ignored) {}
        for (String p : targets) {
            if (!isInstalled(p)) continue;
            Intent direct = new Intent(send);
            direct.setPackage(p);
            try {
                getActivity().startActivity(direct);
                JSObject ret = new JSObject();
                ret.put("target", "app");
                ret.put("package", p);
                call.resolve(ret);
                return;
            } catch (ActivityNotFoundException e) {
                // this app cannot take a video share: fall through to the chooser
            }
        }
        // 3. fallback: Android share sheet
        try {
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            JSObject ret = new JSObject();
            ret.put("target", "chooser");
            ret.put("missing", targets.isEmpty() ? "" : targets.get(0));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No app on this phone can take this video.");
        }
    }
}
