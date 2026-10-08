const ANNOUNCER_ID = "a11y-announcer";

/**
 * Speaks a short confirmation ("Posted", "Message sent") to screen-reader
 * users via one shared, visually hidden polite live region — for outcomes
 * that are otherwise only visible (a card appearing in the feed, a composer
 * quietly emptying itself). Errors don't go through here: they render as
 * real on-screen text with role="alert" next to whatever failed.
 *
 * Never pass private content (a message body, a secret chat's plaintext):
 * the region is a real DOM node, so session replay would record it.
 */
export function announce(message: string) {
  if (typeof document === "undefined") return;
  let region = document.getElementById(ANNOUNCER_ID);
  if (!region) {
    region = document.createElement("div");
    region.id = ANNOUNCER_ID;
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    // Inline rather than the sr-only utility class: this node is created
    // outside React, and must stay hidden even on a page whose CSS never
    // happened to include that class.
    Object.assign(region.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      margin: "-1px",
      padding: "0",
      overflow: "hidden",
      clipPath: "inset(50%)",
      whiteSpace: "nowrap",
      border: "0",
    });
    document.body.appendChild(region);
  }
  // aria-modal="true" tells VoiceOver that everything outside the dialog is
  // inert — a live region left on <body> would then be silent for exactly
  // the confirmations raised from inside a sheet or the story viewer
  // ("Sent", "Comment posted"). So the region lives inside the topmost open
  // modal while there is one (appendChild moves it) and on <body>
  // otherwise. It's absolutely positioned and clipped to 1px, so which
  // container it's in has no visual effect; if that modal later unmounts
  // and takes the node with it, the next call just recreates it.
  const generation = ++latestGeneration;
  speak(region, message, generation, true);
}

let latestGeneration = 0;

function speak(region: HTMLElement, message: string, generation: number, mayRehome: boolean) {
  const modals = document.querySelectorAll('[aria-modal="true"]');
  const host = modals.length > 0 ? modals[modals.length - 1] : document.body;
  if (region.parentElement !== host) host.appendChild(region);
  // Cleared first, then set on a later tick — setting the same text twice
  // in a row ("Message sent", "Message sent") is otherwise no DOM change at
  // all, and the second one would never be read.
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = message;
    if (!mayRehome) return;
    // A Sheet keeps its aria-modal node mounted through its exit animation,
    // so an announcement raised as one closes can land in a node that's
    // destroyed a moment later, before VoiceOver reads it. One check, once
    // that animation has surely finished: if the region went with it, say
    // it again from wherever it belongs now. A newer announce() supersedes.
    window.setTimeout(() => {
      if (generation !== latestGeneration || region.isConnected) return;
      speak(region, message, generation, false);
    }, 1000);
  }, 50);
}
