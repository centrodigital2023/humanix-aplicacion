export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-cyber overflow-hidden">
        <div className="absolute inset-0 bg-[var(--background-image-gradient-bio)] opacity-40" />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="relative h-5 w-5 text-biosensor"
          aria-hidden="true"
        >
          <path
            d="M3 12h3l2-5 4 10 2-5h7"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-biosensor animate-pulse-ring" />
      </div>
      <span className="font-display text-xl font-bold tracking-tight">
        Human<span className="text-biosensor">i</span>x
      </span>
    </div>
  );
}
