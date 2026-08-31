/**
 * Normalizes a provider-supplied release/air date to a single YYYY-MM-DD
 * bucket in the viewer's local timezone.
 *
 * Two shapes come in from providers: a bare calendar date ("2024-01-06",
 * from TMDB/TVmaze) which carries no time-of-day or timezone and must be
 * used exactly as given, and a full timestamp ("2024-01-06T22:30:00.000Z",
 * from Cinemeta) which is an absolute instant that has to be converted to
 * the viewer's local day. Running a bare date through `new Date(...)` would
 * parse it as UTC midnight and can shift it a day for viewers behind UTC, so
 * the two cases are handled separately -- each date is converted at most
 * once, right here, rather than re-derived per call site.
 */
export function toLocalDayISO(raw: string | null | undefined): string {
  if (!raw) return "";
  const bare = /^(\d{4})-(\d{2})-(\d{2})(?:$|[^T\d])/.exec(raw);
  if (bare) return `${bare[1]}-${bare[2]}-${bare[3]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
