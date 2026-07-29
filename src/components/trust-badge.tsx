import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  TRUSTED: "bg-success/15 text-success",
  ESTABLISHED: "bg-teal/15 text-teal",
  NEW: "bg-line text-foreground-soft",
};

const labels: Record<string, string> = {
  TRUSTED: "Trusted",
  ESTABLISHED: "Established",
  NEW: "New member",
};

export function TrustBadge({ band }: { band: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        styles[band] ?? styles.NEW,
      )}
    >
      {labels[band] ?? "New member"}
    </span>
  );
}
