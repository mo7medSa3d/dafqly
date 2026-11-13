/**
 * L2: escape a user-supplied term for use inside a SQL LIKE/ILIKE pattern.
 * Drizzle parameterises the value (so this is not SQL injection), but `%`
 * and `_` keep their wildcard meaning unless escaped. Postgres LIKE uses
 * backslash as the default escape character, so prefixing `\`, `%` and `_`
 * with a backslash makes the term match literally.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Wrap an escaped term as a contains-pattern: `%<escaped>%`. */
export function likePattern(value: string): string {
  return `%${escapeLike(value)}%`;
}
