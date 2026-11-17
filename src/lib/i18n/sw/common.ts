// Standard Swahili (Kiswahili sanifu), friendly "wewe" register. Product names (YuKon3t, Circles, Collab Boards, Muse,
// Story) stay as they are. Terms: akaunti (account), ujumbe (message), arifa (notification), wasifu (profile),
// chapisho (post), mwasiliani / wasiliani (a person someone is connected with; a request is "ombi la kuwasiliana"),
// maoni (comment), jibu (reply), "matangazo ya moja kwa moja" (live stream). Under /messages the people someone is
// connected with are "wasiliani", because "muunganisho" already means the network connection. A screen is referred
// to by the label the nav gives it ("Gundua", "Mipangilio"). Where a string has a count, the number is written
// after the noun ("maoni 3"), so one wording reads correctly for any number.

export const captchaFailed =
  "Ukaguzi wa usalama haukukamilika. Gusa tena «Thibitisha kuwa wewe ni binadamu» na usubiri umalizike kabla ya kuendelea. Kwa muunganisho wa polepole inaweza kuchukua hadi dakika moja.";
export const captchaUnavailable =
  "Huduma yetu ya ukaguzi wa usalama haipatikani kwa sasa, kwa hiyo hatuwezi kuendelea. Hili si tatizo la simu yako wala la muunganisho wako: jaribu tena baada ya dakika chache.";
export const phoneInvalid = "Nambari hiyo si sahihi kwa nchi iliyochaguliwa. Angalia nchi na tarakimu.";
export const emailPlaceholder = "wewe@mfano.com";

export const serverUnreachable = "Hatukuweza kufikia seva. Angalia muunganisho wako kisha ujaribu tena.";
export const newVersionAvailable = "Toleo jipya la programu linapatikana. Onyesha upya ukurasa ili uendelee.";
// Also under messages.controls: the screens under /messages render these two controls as well.
export const passwordInput = { show: "Onyesha nenosiri", hide: "Ficha nenosiri" };
export const multiSelect = {
  placeholder: "Tafuta na uchague...",
  noMatches: "Hakuna kinacholingana",
  remove: "Ondoa {label}",
  selected: "{count}/{max} vimechaguliwa",
};
