import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a lazily-loaded route chunk is in flight.
 *
 * Deliberately generic: routes range from marketing prose to the workspace
 * shell, so this reserves a plausible page-shaped block rather than pretending
 * to match any one layout. It follows the same Skeleton convention as
 * ChartRenderer and BlogIndex.
 */
export function RouteFallback() {
  return (
    <div
      className="mx-auto w-full max-w-5xl px-6 py-16"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="mt-4 h-5 w-full" />
      <Skeleton className="mt-2 h-5 w-5/6" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default RouteFallback;
