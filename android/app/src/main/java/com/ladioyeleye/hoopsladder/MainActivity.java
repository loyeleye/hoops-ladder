package com.ladioyeleye.hoopsladder;

import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.ladioyeleye.hoopsladder.audio.HoopsAudioPlugin;
import com.ladioyeleye.hoopsladder.music.HoopsMusicPlugin;
import com.ladioyeleye.hoopsladder.remote.HoopsRemotePlugin;
import com.ladioyeleye.hoopsladder.remote.RemoteHub;
import com.ladioyeleye.hoopsladder.share.HoopsSharePlugin;
import com.ladioyeleye.hoopsladder.voice.HoopsTranscribePlugin;
import com.ladioyeleye.hoopsladder.voice.HoopsVoicePlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that live inside this app (not from npm) must be registered before super.onCreate().
        registerPlugin(HoopsRemotePlugin.class);
        registerPlugin(HoopsVoicePlugin.class);
        registerPlugin(HoopsAudioPlugin.class);
        registerPlugin(HoopsMusicPlugin.class);
        registerPlugin(HoopsSharePlugin.class);
        registerPlugin(HoopsTranscribePlugin.class);
        // A link shared into the app reaches onNewIntent() below, including the one that started it (BridgeActivity
        // passes its first intent there too). When Android rebuilds the app after closing it in the background, it
        // hands back that same old intent, so drop it rather than add the link twice.
        if (savedInstanceState != null && Intent.ACTION_SEND.equals(getIntent().getAction())) setIntent(new Intent(Intent.ACTION_MAIN));
        super.onCreate(savedInstanceState);

        // Capacitor sends every navigation to another site out to the browser. That's right for the page itself,
        // but the in-app demo clip player is a YouTube iframe, and its own page loads must stay inside the frame.
        // Links that open the whole page elsewhere (main frame) still go to the browser or YouTube app.
        // See docs/LEARNING.md, step 14.
        bridge.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (!request.isForMainFrame()) return false;
                    return super.shouldOverrideUrlLoading(view, request);
                }
            }
        );

        // Back button and back swipe: the whole app is one web page, so by default Android closed the app from any
        // screen. Ask the page first (hoopsBack() in native-web/native.js closes the open player, sheet or clip, or
        // goes back a tab); only when it has nothing left to go back to does Android leave the app as usual.
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    bridge
                        .getWebView()
                        .evaluateJavascript(
                            "(function(){try{return !!(window.hoopsBack&&window.hoopsBack())}catch(e){return false}})()",
                            handled -> {
                                if ("true".equals(handled)) return;
                                setEnabled(false);
                                getOnBackPressedDispatcher().onBackPressed();
                                setEnabled(true);
                            }
                        );
                }
            }
        );
    }

    /**
     * Share › Hoops Ladder from YouTube: the link goes to the drill on the Coach tab, or to the coach session when it
     * came through the session's share target. The app is launchMode singleTask, so a share while it's open arrives
     * here instead of starting a second copy. See docs/LEARNING.md, steps 20 and 27.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        HoopsSharePlugin.receive(this, intent);
    }

    /**
     * Every key press reaches the activity before Android acts on it. While the full-screen rep logger is
     * open, the volume and media buttons log reps instead of changing the volume. See docs/LEARNING.md, step 11.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (RemoteHub.handleKey(event)) return true;
        return super.dispatchKeyEvent(event);
    }
}
