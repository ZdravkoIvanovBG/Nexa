export function GamepadIcon({ active = false }: { active?: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <g
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M7.5 7 L16.5 7 Q21 7 21.4 12 L21.7 16 Q22 19.5 19 19.5 Q17.5 19.5 16.4 17.8 L15.4 16 L8.6 16 L7.6 17.8 Q6.5 19.5 5 19.5 Q2 19.5 2.3 16 L2.6 12 Q3 7 7.5 7 Z" />
        <path d="M7.5 10 L7.5 13.5" />
        <path d="M5.75 11.75 L9.25 11.75" />
      </g>
      <circle
        cx="15.6"
        cy="10.9"
        r="1.15"
        fill="var(--color-accent)"
        className={active ? "animate-home-hearth" : "opacity-0"}
      />
      <circle
        cx="17.6"
        cy="12.9"
        r="1.15"
        fill="var(--color-accent)"
        className={active ? "animate-home-hearth" : "opacity-0"}
        style={active ? { animationDelay: "480ms" } : undefined}
      />
    </svg>
  );
}
