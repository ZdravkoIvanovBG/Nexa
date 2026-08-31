import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { Section, ToggleRow } from "./shared";
import { isTauri } from "./player-panel/internals";
import { SvpSection } from "./smoothing-panel/svp-section";

export function SmoothingPanel() {
  const { settings, update } = useSettings();
  const t = useT();

  if (!isTauri) {
    return (
      <Section
        title={t("Desktop only")}
        subtitle={t(
          "Smooth motion runs on the bundled mpv engine in the Harbor desktop app. It has no effect in the browser.",
        )}
      >
        <span className="text-[13px] text-ink-subtle">
          {t("Download the desktop app to use motion smoothing.")}
        </span>
      </Section>
    );
  }

  return (
    <>
      <Section
        title={t("Smooth motion")}
        subtitle={t(
          "Fast pans can judder at low frame rates. Smoothing fills in the gaps so motion glides.",
        )}
      >
        <ToggleRow
          label={t("Motion smoothing")}
          sub={t(
            "Harbor's built-in frame interpolation. Needs a display refresh rate above the video's frame rate, and can stutter on weak GPUs. Lighter than SVP.",
          )}
          value={settings.playerMotionInterp}
          onChange={(v) => update({ playerMotionInterp: v })}
          lockReason={
            settings.playerSvp && !!settings.svpVpyPath
              ? t(
                  "SVP is already handling frame interpolation. Turn off SVP below to use this instead. Running both delays the audio.",
                )
              : undefined
          }
        />
      </Section>

      <SvpSection />
    </>
  );
}
