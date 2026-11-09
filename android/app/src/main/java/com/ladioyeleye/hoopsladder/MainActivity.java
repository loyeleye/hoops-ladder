package com.ladioyeleye.hoopsladder;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;
import com.ladioyeleye.hoopsladder.remote.HoopsRemotePlugin;
import com.ladioyeleye.hoopsladder.remote.RemoteHub;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that live inside this app (not from npm) must be registered before super.onCreate().
        registerPlugin(HoopsRemotePlugin.class);
        super.onCreate(savedInstanceState);
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
