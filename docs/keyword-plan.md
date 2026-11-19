# Keyword and page plan (draft, 2026-11-19)

Status: a plan, not live. Nothing here is verified with search-volume data: no keyword tool was available when it was
written. The priorities come from what competing apps and guides say about themselves (HelloTalk, Tandem, InterPals,
Slowly, InterNations, Bexpat, the African-diaspora apps). Step 1 below replaces the guesses with numbers.

## What YuKon3t can truthfully claim (every page must stay inside this)

Checked against `docs/store-listing-drafts.md` and the FAQ on 2026-11-18:

- Find people by country or interest; say what you're here for (friendship, cultural exchange, community,
  professional ties, travel tips).
- Stories that disappear after 24 hours, with hearts only the author sees.
- Muse: a full-screen feed of short videos.
- Private, invite-only Circles (free) and Collab Boards (skill swaps, study groups, projects).
- Live: up to 10 guests on stage, with an audience choice down to "only the people I pick".
- One-to-one and group chat, voice and video calls, shared shopping lists.
- Nine languages: English, Spanish, French, Portuguese, Arabic, German, Italian, Hindi, Swahili.
- Every account confirms an email address or phone number first. This is NOT ID verification, so never write
  "ID-verified" or "real identity".
- Do not mention: paid features (none), gifts and challenges (admins only), ad booking, user counts, ratings, "best",
  "#1", or competitor names.

## Step 1: replace guesses with data (before building anything)

1. Google Search Console (verified 2026-11-19): after 2 to 4 weeks, Performance report, group by Query and Country.
2. Google Keyword Planner (free with a Google Ads account, no spend needed): paste the 15 phrases below, set the
   location to "all countries", then repeat for the countries in the diaspora list.
3. Google Trends: compare the phrases against each other and by country. Trends gives relative interest, not volume.
4. App Store Connect (App Analytics, Search Terms) and Play Console (Store listing acquisition, Search terms) once the
   new listings are live.
5. Bing Webmaster Tools (verified 2026-11-19): same Query report.

Keep the 6 to 8 phrases that show real demand and drop the rest. The order below is a hypothesis.

## The 15 target phrases

Tier A: build first. Specific, matches what the app does, fewer big competitors.

| # | Phrase | Intent | Page |
|---|---|---|---|
| 1 | make friends from other countries | find people abroad | Landing `/` (done: title, H1 and description) |
| 2 | meet people from other cultures | cultural curiosity | Landing `/`, section on culture |
| 3 | connect with people from my home country | diaspora, homesick | `/diaspora` |
| 4 | african diaspora community app | diaspora, brand-new apps compete here | `/diaspora` |
| 5 | pen pals worldwide | pen-pal seekers | `/pen-pals` |
| 6 | cultural exchange app | exchange seekers | `/pen-pals` (or `/cultural-exchange` if the data splits them) |

Tier B: build second. Feature-led, broader competition.

| # | Phrase | Intent | Page |
|---|---|---|---|
| 7 | make friends abroad | people who just moved | `/abroad` |
| 8 | talk to people from around the world | casual, high volume, high competition | Landing `/`, FAQ |
| 9 | international friends app | app-seeking | Landing `/`, store listings |
| 10 | private community app | community builders | `/circles` |
| 11 | create a free online community | community builders | `/circles` |
| 12 | find people who speak my language | language-based, not tutoring | `/abroad` and `/diaspora` |

Tier C: opportunistic. Feature pages and long tail.

| # | Phrase | Intent | Page |
|---|---|---|---|
| 13 | live stream with friends | stream seekers | `/live` |
| 14 | go live with guests | stream hosts | `/live` |
| 15 | short video app to watch with friends | Muse | `/muse` (only if it can show public content; see risks) |

## Pages to add

Each page needs real, useful content. Do not generate near-duplicate pages that change only a country name: Google
treats those as doorway pages and may demote the whole site.

| Page | Phrases | Contents | Notes |
|---|---|---|---|
| `/diaspora` | 3, 4, 12 | Who it's for, how to find people from your home country or language, example Circles, safety (email or phone confirmed), a sign-up call to action, FAQ block | One hub first. Country pages (`/diaspora/nigeria`, `/ghana`, `/kenya`, `/india`) only after Search Console shows demand AND there are real Circles or members to describe |
| `/pen-pals` | 5, 6, 2 | How to find pen pals and exchange culture on YuKon3t, what you can share (Stories, chat, calls), safety tips, call to action | Be clear it is not a tutoring or language-lesson app |
| `/abroad` | 7, 12 | "Just moved?" guide: find people from home or from the new country by country and interest, Circles by city or interest, calls home | Mention only features that exist |
| `/circles` | 10, 11 | What a Circle is, free to start, invite-only option, Collab Boards, examples | Best linked from the FAQ |
| `/live` | 13, 14 | Live with up to 10 guests, audience choices, how guests join | Include a screenshot or short loop |
| FAQ additions | 8, 9 | 6 to 8 new question-and-answer entries phrased the way people search ("How do I find people from my country?") | Cheapest to ship, goes into all nine languages |

## How each page is built (matches what was shipped for SEO on 2026-11-18)

- Server-rendered, localized with the existing `?lang=` system and self-canonical URL.
- `hreflang` for all nine languages plus x-default; add to `src/app/sitemap.ts` and the sitemap test.
- Title under 60 characters, description under 160, one H1, the target phrase near the start of both.
- JSON-LD: `WebPage` plus `BreadcrumbList`; `FAQPage` where the page has Q and A (note: Google rarely shows FAQ
  results, but the markup is harmless).
- Internal links: from the landing page footer and from the related FAQ answers.
- A tracked sign-up link on every page (a `?ref=` or UTM) so Search Console clicks can be tied to sign-ups in
  PostHog.
- Dictionaries in `account.ts` for all nine languages, as with `seo.landing`.

## Other languages (candidate phrasing, NOT reviewed by native speakers)

Direct translation misses what people actually type. Treat these as search ideas to test in Keyword Planner and Google
Trends in each language, then have a native speaker choose the final wording.

| Language | make friends from other countries | connect with people from my home country | pen pals |
|---|---|---|---|
| Spanish | hacer amigos de otros países | conectar con gente de mi país | amigos por correspondencia |
| French | se faire des amis dans d'autres pays | retrouver des gens de mon pays | correspondants |
| Portuguese | fazer amigos de outros países | conectar com gente do meu país | amigos por correspondência |
| Arabic | تكوين صداقات من دول أخرى | التواصل مع أشخاص من بلدي | أصدقاء مراسلة |
| German | Freunde aus anderen Ländern finden | Kontakt zu Menschen aus meiner Heimat | Brieffreunde finden |
| Italian | fare amicizia con persone di altri paesi | contattare persone del mio paese | amici di penna |
| Hindi | दूसरे देशों में दोस्त बनाना | अपने देश के लोगों से जुड़ना | पेन फ्रेंड |
| Swahili | kupata marafiki kutoka nchi nyingine | kuwasiliana na watu wa nyumbani | marafiki wa barua |

## Store listings

After Step 1, update the App Store keyword field (100 characters, comma-separated, no spaces, no app name, no
competitor names) and the Google Play short description in `docs/store-listing-drafts.md`. The current English
keywords are `friends,culture,diaspora,community,stories,shortvideo,livestream,chat,groups,penpal,language,abroad`.
Candidates to test after data: `international`, `homeland`, `exchange`, `expat`. Don't repeat words that are already in
the title or subtitle; Apple counts them once.

## Risks and limits

- Rankings take weeks to months. A new domain section with few backlinks won't beat established apps quickly. Plan on
  links from diaspora communities, university groups, and local press, and ask real communities to link to the
  `/diaspora` page.
- Content behind sign-in (Muse, Circles) can't be indexed. Feature pages can describe it but only public pages rank.
- Competitor "alternative to X" pages are a trademark and trust risk and are excluded here. Revisit only as a separate
  decision.
- Do not claim safety beyond what exists. Say accounts confirm an email or phone, not that people are verified.
- The language rows above are unreviewed. Wrong wording in Arabic or Hindi costs rankings and credibility.

## Suggested order

1. Step 1 data (2 to 4 weeks of Search Console, plus Keyword Planner today).
2. FAQ additions in English, then all nine languages. Cheap and indexed quickly.
3. `/diaspora` hub, then `/pen-pals`.
4. `/abroad`, `/circles`, `/live` once the first two show impressions.
5. Country pages only where demand and real content exist.
6. Native-speaker review of every non-English page before it goes live.

## FAQ additions (shipped, unreviewed)

Seven entries in a new first FAQ section, "Meeting people around the world" (`meet-people-worldwide`), in all nine
languages. The eight translations are NOT reviewed by native speakers. `FAQ_JSON_LD_MAX_ENTRIES` went from 40 to 47 so
the FAQPage markup still carries the original 40 questions plus these 7 (it takes the first N in page order).

| Entry id | Target phrases it covers (numbers from the table above) |
|---|---|
| `make-friends-other-countries` | 1 make friends from other countries, 8 talk to people from around the world, 9 international friends app |
| `find-people-home-country-language` | 3 connect with people from my home country, 12 find people who speak my language |
| `pen-pals-cultural-exchange` | 5 pen pals worldwide, 6 cultural exchange app, 2 meet people from other cultures |
| `moved-abroad-meet-people` | 7 make friends abroad, 3, 12 |
| `start-private-community-free-circle` | 10 private community app, 11 create a free online community |
| `go-live-with-friends-guests` | 13 live stream with friends, 14 go live with guests |
| `safe-talk-people-other-countries` | safety support for 1 and 8 (no phrase of its own) |

Not covered: 4 (african diaspora community app) and 15 (short video app to watch with friends).

Claims left out because the code does not back them: a language *filter* (Discover filters by country and by what
people are open to; search matches names, usernames, bios and interests; languages are only listed on profiles), and
"study groups" for Collab Boards (the existing FAQ lists skill exchange, mentorship, services, events and projects).
The store-listing draft no longer claims a language filter (it says "find people by country or interest").
