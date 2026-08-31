type SvpSettings = {
  playerSvp: boolean;
  svpVpyPath: string;
};

export function isSvpActive(settings: SvpSettings): boolean {
  return settings.playerSvp && settings.svpVpyPath.length > 0;
}
