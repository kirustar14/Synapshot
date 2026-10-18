import { Skeleton } from "@/components/ui/skeleton";

/** Localized placeholders keep the destination workspace visible while genuine data loads. */
export function WorkspaceSkeleton({
  label = "Loading patients",
  record = false,
}: {
  label?: string;
  record?: boolean;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className="workspace-skeleton space-y-5 py-4"
    >
      <span className="sr-only">{label}</span>
      {record && (
        <div aria-hidden="true" className="space-y-4 pb-5">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-5 w-80 max-w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      )}
      <div
        aria-hidden="true"
        className="space-y-3 rounded-3xl bg-card p-5 shadow-soft"
      >
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="flex min-h-20 items-center gap-5 border-b border-border/40 last:border-0"
          >
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="hidden h-7 w-32 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
