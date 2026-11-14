"use client";

import { createAreaText } from "@/components/ui-text";
import { commentToolsEn } from "@/lib/i18n/en/commentTools";

const commentTools = createAreaText(commentToolsEn);

/** Root layout: the delete confirmation every comment surface uses, and the Muse composer's emoji / GIF panel. */
export const CommentToolsTextProvider = commentTools.Provider;
export const useCommentToolsText = commentTools.useText;
