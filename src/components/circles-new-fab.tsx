"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { ScrollFab } from "@/components/scroll-fab";
import { useCirclesText } from "@/components/circles-text";

/** Appears once the page header's own "Start a Circle" link scrolls out of view. */
export function CirclesNewFab() {
  const router = useRouter();
  const { t } = useCirclesText();

  return (
    <ScrollFab
      hideWhileVisibleId="circles-header"
      actions={[
        {
          key: "new-circle",
          label: t.list.start,
          icon: <Plus size={24} />,
          iconClassName: "bg-accent text-accent-ink",
          onSelect: () => router.push("/circles/new"),
        },
      ]}
    />
  );
}
