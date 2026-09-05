package com.yukon3t.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Observes the hardware volume-up button so the web page can auto-unmute a
 * muted feed video when the user physically turns the volume up — there's
 * no web API for hardware volume keys, so MainActivity.onKeyDown forwards
 * the event here (see that method) rather than this plugin intercepting it
 * itself. Purely observational: never consumes the key event or touches
 * any audio stream/volume itself, so Android's own volume UI and behavior
 * (including in-call STREAM_VOICE_CALL handling) are completely unaffected
 * — this only tells JS "volume up was pressed," nothing more.
 */
@CapacitorPlugin(name = "VolumeButton")
public class VolumeButtonPlugin extends Plugin {

    void notifyVolumeUp() {
        notifyListeners("volumeUp", new JSObject());
    }
}
