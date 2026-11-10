package com.ladioyeleye.hoopsladder;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.ladioyeleye.hoopsladder.remote.HoopsRemotePlugin;
import com.ladioyeleye.hoopsladder.remote.RemoteHub;
import com.ladioyeleye.hoopsladder.voice.HoopsVoicePlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that live inside this app (not from npm) must be registered before super.onCreate().
        registerPlugin(HoopsRemotePlugin.class);
        registerPlugin(HoopsVoicePlugin.class);
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
