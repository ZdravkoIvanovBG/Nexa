const TRUSTED_GROUPS = new Set([
  "FRDS",
  "FRAMESTOR",
  "FORM",
  "EVO",
  "RARBG",
  "ETHEL",
  "FLUX",
  "QXR",
  "MEGUSTA",
  "ION10",
  "PSA",
  "AMIABLE",
  "GALAXYRG",
  "WEBDV",
  "RZEROX",
  "SIC",
  "TGX",
  "NTB",
  "NTG",
  "TEPES",
  "GECKOS",
  "SUCCESSFULCRAB",
]);

export function isTrustedGroup(normalized: string | null): boolean {
  return normalized != null && TRUSTED_GROUPS.has(normalized);
}
