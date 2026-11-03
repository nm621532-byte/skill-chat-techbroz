package com.techbroz.skillchat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** Skill Chat Android app: the Skill Chat web app bundled inside a Capacitor WebView. All data stays on the phone.
 *  v1.2 adds the VideoShare bridge ("Post a video": ACTION_SEND to YouTube, Instagram, WhatsApp ...). */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VideoSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
