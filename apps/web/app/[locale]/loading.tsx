/**
 * Instant shell for every [locale] page while the server component loads.
 * Pure token-styled skeleton matching DAFQLY's Quiet Swiss Ledger layout
 * cadence (sidebar rail, sticky header, KPI strip, ledger table) with zero
 * JavaScript of its own.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-dvh bg-background text-foreground"
    >
      <span className="sr-only">Loading workspace…</span>

      {/* Desktop sidebar rail placeholder to prevent horizontal layout shift */}
      <div
        aria-hidden="true"
        className="hidden w-[240px] shrink-0 flex-col border-e border-border bg-sidebar lg:flex"
      >
        <div className="flex h-14 items-center border-b border-border px-4">
          <div className="h-5 w-24 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        </div>
        <div className="flex flex-1 flex-col gap-2 px-3 py-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-9 w-full animate-pulse rounded-md bg-muted/70 motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>

      {/* Main content shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top header bar */}
        <div
          aria-hidden="true"
          className="flex h-14 items-center justify-between border-b border-border bg-background px-4 sm:px-6 lg:px-8 2xl:px-10"
        >
          <div className="h-5 w-40 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="flex items-center gap-2">
            <div className="h-9 w-24 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            <div className="size-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            <div className="size-9 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          </div>
        </div>

        {/* Page body: heading + 4 KPI cards + ledger table card */}
        <div
          aria-hidden="true"
          className="flex w-full flex-1 flex-col gap-6 px-4 pb-24 pt-6 sm:px-6 lg:px-8 2xl:px-10"
        >
          <div className="flex flex-col gap-2">
            <div className="h-7 w-52 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            <div className="h-4 w-72 max-w-full animate-pulse rounded-md bg-muted/70 motion-reduce:animate-none" />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex h-24 flex-col justify-between rounded-xl border border-border bg-card p-4"
              >
                <div className="h-3 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <div className="h-6 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="h-4 w-36 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-7 w-24 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            </div>
            <div className="divide-y divide-border/60">
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="flex items-center justify-between gap-4 px-4 py-3.5">
                  <div className="h-4 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                  <div className="hidden h-4 w-28 animate-pulse rounded bg-muted/70 motion-reduce:animate-none sm:block" />
                  <div className="h-4 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
