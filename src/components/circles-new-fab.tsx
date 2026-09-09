"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { ScrollFab } from "@/components/scroll-fab";

/** Appears once the page header's own "Start a Circle" link scrolls out of view. */
export function CirclesNewFab() {
  const router = useRouter();

  return (
    <ScrollFab
      hideWhileVisibleId="circles-header"
      actions={[
        {
          key: "new-circle",
          label: "Start a Circle",
          icon: <Plus size={24} />,
          iconClassName: "bg-accent text-accent-ink",
          onSelect: () => router.push("/circles/new"),
        },
      ]}
    />
  );
}
