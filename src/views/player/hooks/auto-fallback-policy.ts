/**
 * Latches auto-play's fallback behavior to "never switch to a different
 * source automatically." Same-source rescues (reload the same URL, retry
 * the same torrent on another debrid, wrap the same stream in a local proxy
 * or remux) stay allowed -- they never change what's playing. The moment
 * those are exhausted, the caller halts instead of picking a different
 * candidate: this just makes that halt happen exactly once per playback
 * session, so a jittery run of failures can't reopen the source switcher
 * (or re-fire a nav bounce) over and over.
 */
export class AutoFallbackGuard {
  private halted = false;

  get isHalted(): boolean {
    return this.halted;
  }

  /** True until the auto-loop has halted for this session. */
  canRescue(): boolean {
    return !this.halted;
  }

  /**
   * Halt once. Returns true the first time (the caller should act on it --
   * open the source switcher), false on every call after (already halted,
   * nothing new to do).
   */
  halt(): boolean {
    if (this.halted) return false;
    this.halted = true;
    return true;
  }
}
