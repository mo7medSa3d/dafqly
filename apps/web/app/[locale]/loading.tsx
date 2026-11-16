/**
 * Instant shell for every [locale] page while the server component loads.
 * Pure token-styled skeleton (no text, no data fetch) so it renders in
 * both locales and themes with zero JavaScript of its own.
 */
export default function Loading() {
  return (
    <div className="min-h-dvh bg-background text-foreground" aria-busy="true">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="h-9 w-56 animate-pulse rounded-lg bg-muted" />
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
        <div className="mt-4 h-72 animate-pulse rounded-xl border border-border bg-card" />
      </div>
    </div>
  );
}
