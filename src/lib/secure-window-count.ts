// Reference count behind secure-window.ts: several views may want the window protected at once (or one may re-mount
// before the other's cleanup runs), and FLAG_SECURE must come off only when the last of them is gone. Pure, so the
// on/off sequence is unit-tested (secure-window-count.test.ts).

/**
 * `apply(true)` runs when the first holder arrives, `apply(false)` when the last one leaves. Each `acquire()` returns
 * its own release function, which only ever counts once however often it is called.
 */
export function createSecureWindowCounter(apply: (secure: boolean) => void) {
  let holders = 0;
  return {
    acquire(): () => void {
      holders += 1;
      if (holders === 1) apply(true);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) apply(false);
      };
    },
    get holders() {
      return holders;
    },
  };
}
