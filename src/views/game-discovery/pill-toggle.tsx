/** Segmented pill toggle, styled like the filter page's Movies/Shows switch. */
export function PillToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-full bg-elevated/50 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          className={`h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
            option.value === value ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
