import { BUNDLES } from "@/lib/addons-store/bundles";
import { useT } from "@/lib/i18n";
import { BundleCard } from "./bundle-card";

export function BundlesPane({
  onInstalled,
  showToast,
}: {
  onInstalled?: () => void;
  showToast: (kind: "ok" | "error", text: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h2 className="font-display text-[24px] font-medium text-ink">
          {t("Recommended Bundles")}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
          {t(
            "Hand-picked groups of addons that install together in one click. No paid placements -- these are just a solid, reliable starting point.",
          )}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {BUNDLES.map((bundle) => (
          <BundleCard
            key={bundle.id}
            bundle={bundle}
            onInstalled={onInstalled}
            showToast={showToast}
          />
        ))}
      </div>
    </div>
  );
}
