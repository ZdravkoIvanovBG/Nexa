export { relativeTime as lastPlayedRelative } from "@/lib/dates";

export function formatPlaytime(minutes: number): string {
  if (minutes < 1) return "Never played";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 10) return `${hours.toFixed(1)} hrs`;
  return `${Math.round(hours)} hrs`;
}
