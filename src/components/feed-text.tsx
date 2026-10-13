"use client";

import { createAreaText } from "@/components/ui-text";
import { feedEn } from "@/lib/i18n/en/feed";

const feed = createAreaText(feedEn);

/** FeedLayout (feed-layout.tsx): posts, the composer, sharing, stories, the live strip and the people controls. */
export const FeedTextProvider = feed.Provider;
export const useFeedText = feed.useText;
