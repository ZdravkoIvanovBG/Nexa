import { useCloudSession } from "@/lib/cloud/session";
import { LoginView } from "./login-view";

/**
 * Hard gate in front of the app shell, in the same slot as CurfewGuard. The
 * router cannot guard this -- every route component renders null and the real
 * UI comes from the view stack -- so the gate is a conditional overlay.
 */
export function CloudAuthGate() {
  const { status } = useCloudSession();
  // "loading" keeps the boot veil in place rather than flashing a login form.
  if (status !== "signed-out") return null;
  return <LoginView />;
}
