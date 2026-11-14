"use client";

import { createAreaText } from "@/components/ui-text";
import { postUploadEn } from "@/lib/i18n/en/postUpload";

const postUpload = createAreaText(postUploadEn);

/** FeedLayout: the post composer's failure and Retry wording (post-composer.tsx). */
export const PostUploadTextProvider = postUpload.Provider;
export const usePostUploadText = postUpload.useText;
