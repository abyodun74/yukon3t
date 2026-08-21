package com.yukon3t.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate() — that's where BridgeActivity
        // actually builds the Bridge from the plugin list accumulated so far.
        registerPlugin(CallForegroundPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
