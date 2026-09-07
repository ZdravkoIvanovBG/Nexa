export function GamesIcon({ active = false }: { active?: boolean }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ overflow: "visible" }}
    >
      <path
        d="M7 8.5h10a4 4 0 0 1 4 4l.7 5.2a2 2 0 0 1-3.5 1.6L16.5 17h-9l-1.7 2.3a2 2 0 0 1-3.5-1.6L3 12.5a4 4 0 0 1 4-4z"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="none"
      />
      <path
        d="M7.5 11v3.2M6 12.6h3"
        stroke={active ? "var(--color-accent)" : "currentColor"}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <g className={active ? "animate-games-blip" : ""}>
        <circle
          cx="16.2"
          cy="11.4"
          r="0.95"
          fill={active ? "var(--color-accent)" : "currentColor"}
          fillOpacity="0.85"
        />
        <circle
          cx="14"
          cy="13.4"
          r="0.95"
          fill={active ? "var(--color-accent)" : "currentColor"}
          fillOpacity="0.85"
        />
      </g>
    </svg>
  );
}
