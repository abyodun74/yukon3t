"use client";

import { createAreaText } from "@/components/ui-text";
import { advertiseEn } from "@/lib/i18n/en/advertise";

const advertise = createAreaText(advertiseEn);

/** advertise/layout.tsx: the ad booking form. */
export const AdvertiseTextProvider = advertise.Provider;
export const useAdvertiseText = advertise.useText;
