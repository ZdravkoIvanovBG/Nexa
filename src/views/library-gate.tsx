import { useEffect } from "react";
import { focusTvPageDefault } from "@/lib/keyboard-navigation";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";
import { GameLibraryView } from "./game-library";
import { LibraryView } from "./library";
import { LibraryChooser } from "./library-chooser";

/**
 * My Library while Games is on: the chooser, or whichever library was picked.
 * With Games off App renders LibraryView directly and this chunk never loads,
 * which is why the Game Library can be imported here without being lazy. Lazy
 * would blank the page for a moment the first time its card is clicked.
 *
 * `backFloatsOverPage` is for the layouts whose floating Back button sits where
 * a page header starts. The Movie Library is padded from here rather than from
 * its own file, which stays exactly as it is.
 */
export function LibraryGate({
  active,
  backFloatsOverPage,
}: {
  active: boolean;
  backFloatsOverPage: boolean;
}) {
  const { librarySection } = useView();
  const { settings } = useSettings();

  // TV focus follows the top frame's kind, which doesn't change between sections.
  useEffect(() => {
    if (!settings.tvNavigation || !active) return;
    const id = window.requestAnimationFrame(() => focusTvPageDefault());
    return () => window.cancelAnimationFrame(id);
  }, [settings.tvNavigation, active, librarySection]);

  if (librarySection === "movies") {
    return (
      <div className={backFloatsOverPage ? "contents [&>main]:pt-40!" : "contents"}>
        <LibraryView active={active} />
      </div>
    );
  }
  if (librarySection === "games") {
    return <GameLibraryView active={active} backFloatsOverPage={backFloatsOverPage} />;
  }
  return <LibraryChooser active={active} />;
}
