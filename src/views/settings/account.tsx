import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCloudSession } from "@/lib/cloud/session";
import { useProfiles } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import { useTogether } from "@/lib/together/provider";
import { useT } from "@/lib/i18n";
import { ColorPicker } from "./color-picker";
import { Section } from "./shared";
import { AvatarRing } from "./account/avatar-ring";
import { resizeAvatar } from "./account/avatar-utils";
import { ChangePasswordRow } from "./account/change-password-row";
import { ProfilesStrip } from "./account/profiles-strip";
import { StartupDefaults } from "./account/startup-defaults";
import { SettingsScopeCard } from "./account/settings-scope-card";

export function AccountStub() {
  const t = useT();
  const { settings, update } = useSettings();
  const { displayName, setDisplayName } = useTogether();
  const { activeProfile, updateProfile } = useProfiles();
  const { user, signOut } = useCloudSession();
  const pushIdentity = (patch: { harborColor?: string; harborAvatar?: string | null }) => {
    update(patch);
    if (!activeProfile) return;
    const profilePatch: { color?: string; avatar?: string | null } = {};
    if (patch.harborColor !== undefined) profilePatch.color = patch.harborColor;
    if (patch.harborAvatar !== undefined) profilePatch.avatar = patch.harborAvatar;
    if (Object.keys(profilePatch).length > 0) updateProfile(activeProfile.id, profilePatch);
  };
  const pushDisplayName = (next: string) => {
    setDisplayName(next);
    if (activeProfile && next && next !== activeProfile.name) {
      updateProfile(activeProfile.id, { name: next });
    }
  };
  const [nameDraft, setNameDraft] = useState(displayName);
  const [editingName, setEditingName] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  const harborAvatar = settings.harborAvatar;
  const customAvatar = activeProfile?.avatar ?? harborAvatar ?? null;
  const effectiveAvatar = customAvatar;

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await resizeAvatar(file, 320);
      pushIdentity({ harborAvatar: dataUrl });
    } catch (err) {
      console.warn("[avatar] resize failed", err);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Section
        title={t("Nexa identity")}
        subtitle={t("How you appear in Watch Together, sessions, and chat.")}
      >
        <div className="flex flex-col gap-4 rounded-2xl border border-edge-soft bg-canvas/40 p-5">
          <div className="flex items-center gap-5">
            <AvatarRing src={effectiveAvatar} size={88} onClick={() => fileRef.current?.click()} />
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onPickFile}
              className="hidden"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        pushDisplayName(nameDraft.trim() || displayName);
                        setEditingName(false);
                      }
                      if (e.key === "Escape") {
                        setNameDraft(displayName);
                        setEditingName(false);
                      }
                    }}
                    className="h-10 flex-1 rounded-xl border border-ink bg-elevated px-3 text-[15px] font-semibold text-ink outline-none"
                  />
                  <button
                    onClick={() => {
                      pushDisplayName(nameDraft.trim() || displayName);
                      setEditingName(false);
                    }}
                    className="h-10 rounded-xl bg-ink px-4 text-[12.5px] font-semibold text-canvas"
                  >
                    {t("Save")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingName(true)}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0 self-start rounded-lg px-1 py-0.5 text-start transition-colors hover:bg-canvas/50"
                >
                  <span className="font-display text-[24px] font-medium leading-tight tracking-tight text-ink">
                    {displayName}
                  </span>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                    className="text-ink-subtle"
                  >
                    <path
                      d="M16.5 4.5l3 3-11 11H5.5v-3l11-11z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-edge-soft px-3 text-[12.5px] font-medium text-ink-muted transition-colors hover:border-edge hover:text-ink"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 5v14M5 12h14"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  {t("Upload photo")}
                </button>
                {customAvatar && (
                  <button
                    onClick={() => pushIdentity({ harborAvatar: null })}
                    className="flex h-9 items-center rounded-lg border border-edge-soft px-3 text-[12.5px] font-medium text-ink-subtle transition-colors hover:border-danger/40 hover:text-danger"
                  >
                    {t("Reset to default")}
                  </button>
                )}
              </div>
              <ColorPicker
                value={settings.harborColor}
                onChange={(c) => pushIdentity({ harborColor: c })}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section
        title={t("Nexa account")}
        subtitle={t("Your Nexa account. Library, watch progress, and addons sync from here.")}
      >
        <div className="flex flex-col gap-4 rounded-2xl border border-edge-soft bg-canvas/40 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
                {t("Email")}
              </span>
              <span className="truncate text-[14.5px] font-medium text-ink">
                {user?.email ?? "—"}
              </span>
            </div>
            <button
              onClick={() => void signOut()}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-edge-soft px-3 text-[12.5px] font-medium text-ink-subtle transition-colors hover:border-danger/40 hover:text-danger"
            >
              <LogOut size={13} strokeWidth={2.2} />
              {t("Sign out")}
            </button>
          </div>
          <ChangePasswordRow email={user?.email ?? null} />
        </div>
      </Section>

      <Section
        title={t("Profiles")}
        subtitle={t(
          "Everyone who uses this Nexa gets their own watch history, avatar, color, and optional PIN. Switch anytime.",
        )}
      >
        <div className="flex flex-col gap-5 rounded-2xl border border-edge-soft bg-canvas/40 p-5">
          <ProfilesStrip />
          <StartupDefaults />
          <SettingsScopeCard />
        </div>
      </Section>
    </div>
  );
}
