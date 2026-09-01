import { Lock, LogOut, Pencil, Plus, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CatAvatar } from "@/components/icons/cat-avatar";
import { ParentalPinModal } from "@/components/parental-pin-modal";
import { TvModalClose } from "@/components/tv-modal-close";
import { useCloudSession } from "@/lib/cloud/session";
import { useT } from "@/lib/i18n";
import { useTvFocusScope } from "@/lib/keyboard-navigation";
import { verifyProfilePassword } from "@/lib/profile-password";
import { useProfiles, type Profile } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";

export function ProfileChip({ collapsed = false }: { collapsed?: boolean } = {}) {
  const { settings } = useSettings();
  const { profiles, activeProfile, openPicker, selectProfile } = useProfiles();
  const { status: cloudStatus, signOut } = useCloudSession();
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<Profile | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useTvFocusScope(menuOpen, ref);

  const doSwitch = (p: Profile) => {
    if (p.passwordHash) openPicker({ kind: "unlock", profileId: p.id });
    else selectProfile(p.id);
  };
  const requestSwitch = (p: Profile) => {
    setMenuOpen(false);
    if (activeProfile?.kid?.parentPinHash) {
      setPendingSwitch(p);
      return;
    }
    doSwitch(p);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const otherProfiles = profiles.filter((p) => p.id !== activeProfile?.id);
  const kid = !!activeProfile?.kid;
  const harborAvatar = settings.harborAvatar?.startsWith("/kids/avatars/")
    ? null
    : settings.harborAvatar;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setMenuOpen((o) => !o)}
        aria-label={activeProfile?.name ?? t("profile.fallback")}
        className={`flex w-full items-center justify-center gap-3.5 rounded-xl py-2.5 text-start transition-colors hover:bg-elevated/60 ${
          collapsed ? "" : "lg:justify-start lg:px-3"
        }`}
      >
        <ProfileAvatar profile={activeProfile} fallbackAvatar={harborAvatar} />
        <div className={`hidden min-w-0 flex-1 ${collapsed ? "" : "lg:block"}`}>
          <div className="truncate text-[14.5px] font-medium tracking-tight text-ink">
            {activeProfile?.name ?? t("profile.fallback")}
          </div>
        </div>
      </button>

      {menuOpen && (
        <div
          data-tv-focus-scope
          className={`absolute bottom-full mb-1.5 overflow-hidden rounded-xl border border-edge bg-elevated shadow-[0_20px_40px_-10px_rgba(0,0,0,0.6)] ${
            collapsed ? "start-0 w-64" : "start-2 end-2 lg:start-4 lg:end-4"
          }`}
        >
          <TvModalClose onClose={() => setMenuOpen(false)} label={t("common.close")} />
          {otherProfiles.length > 0 && (
            <div className="flex flex-col gap-0.5 border-b border-edge-soft p-1.5">
              <span className="px-2.5 pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
                {t("profile.switch")}
              </span>
              {otherProfiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => requestSwitch(p)}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-raised"
                >
                  <span className="relative inline-flex shrink-0">
                    <ProfileAvatar profile={p} fallbackAvatar={null} compact />
                    {p.passwordHash && (
                      <span className="absolute -bottom-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-canvas text-ink shadow-sm ring-1 ring-edge">
                        <Lock size={8} strokeWidth={2.6} />
                      </span>
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13.5px] font-medium text-ink">{p.name}</span>
                    {p.isPrimary && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-[0.18em]"
                        style={{ color: p.color }}
                      >
                        {t("profile.primary")}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
          {!kid && (
            <div className="flex flex-col">
              <button
                onClick={() => {
                  openPicker({ kind: "list" });
                  setMenuOpen(false);
                }}
                className="flex items-center gap-2.5 px-4 py-3 text-start text-[13.5px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <Users size={14} strokeWidth={2.2} />
                {t("profile.whoWatching")}
              </button>
              {activeProfile && (
                <button
                  onClick={() => {
                    openPicker({ kind: "edit", profileId: activeProfile.id });
                    setMenuOpen(false);
                  }}
                  className="flex items-center gap-2.5 px-4 py-3 text-start text-[13.5px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  <Pencil size={14} strokeWidth={2.2} />
                  {t("profile.editThis")}
                </button>
              )}
              {activeProfile?.isPrimary && (
                <button
                  onClick={() => {
                    openPicker({ kind: "create" });
                    setMenuOpen(false);
                  }}
                  className="flex items-center gap-2.5 px-4 py-3 text-start text-[13.5px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  <Plus size={14} strokeWidth={2.2} />
                  {t("profile.new")}
                </button>
              )}
              {cloudStatus === "signed-in" && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void signOut();
                  }}
                  className="flex items-center gap-2.5 border-t border-edge-soft px-4 py-3 text-start text-[13.5px] text-ink-subtle transition-colors hover:bg-raised hover:text-danger"
                >
                  <LogOut size={14} strokeWidth={2.2} />
                  {t("Sign out")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {pendingSwitch && activeProfile?.kid?.parentPinHash && (
        <ParentalPinModal
          mode={{
            kind: "unlock",
            onUnlock: () => {
              const target = pendingSwitch;
              setPendingSwitch(null);
              selectProfile(target.id);
            },
            onCancel: () => setPendingSwitch(null),
          }}
          verify={(pin) => verifyProfilePassword(pin, activeProfile.kid!.parentPinHash!)}
          kids
        />
      )}
    </div>
  );
}

function ProfileAvatar({
  profile,
  fallbackAvatar,
  compact,
}: {
  profile: Profile | null;
  fallbackAvatar: string | null;
  compact?: boolean;
}) {
  const dim = compact ? "h-9 w-9" : "h-12 w-12";
  const src = profile?.avatar ?? fallbackAvatar ?? null;
  const ringStyle = profile?.color ? { boxShadow: `0 0 0 2px ${profile.color}` } : undefined;
  return (
    <div className={`${dim} shrink-0 overflow-hidden rounded-full bg-elevated`} style={ringStyle}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <CatAvatar className="h-full w-full" />
      )}
    </div>
  );
}
