/**
 * emoji-picker-react (see emoji-picker-button.tsx) has no hook to extend its
 * built-in search with extra keywords for existing Unicode emoji — its
 * `customEmojis` prop only registers whole new (non-Unicode) images, and its
 * search box has no controllable/observable search-term prop or callback
 * (confirmed against its shipped .d.ts files). Its bundled keyword data also
 * only covers standard English CLDR annotations, so informal or
 * transliterated terms — "amen"/"ameen"/"aameen", "dua", "blessed" — return
 * nothing even though there's an obvious matching emoji. This is a small,
 * curated keyword -> emoji map that emoji-picker-button.tsx layers on top of
 * the library's own search, read straight from its search input's live
 * value (see attachSuggestionListener there).
 */
export const EMOJI_KEYWORD_SUGGESTIONS: Record<string, string[]> = {
  pray: ["🙏", "🙌"],
  prayer: ["🙏"],
  praying: ["🙏"],
  amen: ["🙏", "🙌"],
  ameen: ["🙏", "🙌"],
  aameen: ["🙏", "🙌"],
  aamin: ["🙏", "🙌"],
  salah: ["🙏"],
  dua: ["🙏"],
  bless: ["🙏", "😇"],
  blessed: ["🙏", "😇", "✨"],
  sad: ["😢", "😭", "☹️", "😔", "😞"],
  cry: ["😢", "😭"],
  crying: ["😢", "😭"],
  unhappy: ["😔", "☹️"],
  heartbroken: ["💔", "😢"],
  happy: ["😀", "😊", "😄", "🙂"],
  joy: ["😂", "😄", "😁"],
  love: ["❤️", "😍", "🥰"],
  laugh: ["😂", "🤣"],
  laughing: ["😂", "🤣"],
  funny: ["😂", "🤣"],
  angry: ["😠", "😡", "🤬"],
  mad: ["😠", "😡"],
  furious: ["🤬", "😡"],
  sorry: ["🙏", "😔", "🥺"],
  apology: ["🙏", "😔"],
  thanks: ["🙏", "🙌"],
  thankyou: ["🙏"],
  grateful: ["🙏", "🥹"],
  congratulations: ["🎉", "🎊", "👏"],
  congrats: ["🎉", "👏"],
  celebrate: ["🎉", "🥳"],
  party: ["🎉", "🥳"],
  birthday: ["🎂", "🎉"],
  sick: ["🤒", "🤢"],
  ill: ["🤒"],
  tired: ["😴", "🥱"],
  sleepy: ["😴", "🥱"],
  hungry: ["🤤", "😋"],
  thirsty: ["🥤"],
  scared: ["😱", "😨"],
  afraid: ["😨", "😱"],
  nervous: ["😬", "😰"],
  bored: ["😑", "🥱"],
  shocked: ["😱", "😲"],
  surprised: ["😲", "😮"],
  cool: ["😎"],
  fire: ["🔥"],
  hot: ["🔥", "🥵"],
  cold: ["🥶"],
  wow: ["😮", "😲"],
  peace: ["✌️", "☮️"],
  hope: ["🤞", "🙏"],
  welcome: ["🤗", "👋"],
  hello: ["👋"],
  bye: ["👋"],
  goodbye: ["👋"],
  ok: ["👌", "✅"],
  yes: ["✅", "👍"],
  no: ["❌", "👎"],
  rip: ["🙏", "🕊️"],
  condolences: ["🙏", "💐"],
};

/** Prefix-matched both ways so "pra" already finds "pray" and a longer typed word still finds a shorter keyword it starts with. */
export function getSuggestedEmojis(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: string[] = [];
  const seen = new Set<string>();
  for (const [keyword, emojis] of Object.entries(EMOJI_KEYWORD_SUGGESTIONS)) {
    if (!keyword.startsWith(q) && !q.startsWith(keyword)) continue;
    for (const emoji of emojis) {
      if (seen.has(emoji)) continue;
      seen.add(emoji);
      matches.push(emoji);
    }
  }
  return matches.slice(0, 8);
}
