// Links and sign-in steps inside the native app (src/lib/app-links.ts). An emailed sign-in link only opens the app once
// the installed build claims yukon3t.com links; until then it opens the phone's browser, so the in-app wording says
// what to do if that happens instead of the website's "close this tab".
export const appLinksEn = {
  checkEmailInApp:
    "Open the email on this phone and tap the link to finish signing in. If it opens in your browser instead of the YuKon3t app, come back here and sign in with your username and password (use \"Forgot password?\" to set one).",
};
