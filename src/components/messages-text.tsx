"use client";

import { createAreaText } from "@/components/ui-text";
import { messagesEn } from "@/lib/i18n/en/messages";

const messages = createAreaText(messagesEn);

/** messages/layout.tsx: everything under /messages. */
export const MessagesTextProvider = messages.Provider;
export const useMessagesText = messages.useText;
