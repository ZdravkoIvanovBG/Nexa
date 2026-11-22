/** An arcade joystick: the Game Library, beside Games' gamepad. Same grid and stroke. */
export function GameLibraryIcon({ active = false }: { active?: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <g
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <circle cx="12" cy="6.2" r="3.2" />
        <path d="M12 9.4 L12 15" />
        <path d="M6.4 17.75 L8.6 17.75" />
        <path d="M5.5 15 L18.5 15 Q21 15 21 17.5 L21 18 Q21 20.5 18.5 20.5 L5.5 20.5 Q3 20.5 3 18 L3 17.5 Q3 15 5.5 15 Z" />
      </g>
      <circle
        cx="16.9"
        cy="17.75"
        r="1.15"
        fill="var(--color-accent)"
        className={active ? "animate-home-hearth" : "opacity-0"}
      />
    </svg>
  );
}
