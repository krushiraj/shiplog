import { cx } from "@/utils/cx";

/** Shiplog mark: three commits on a branch that bends up into a sail. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-linear-to-b from-accent-500 to-accent-700 text-white shadow-xs",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 19h14" />
        <path d="M7 15.5 12 4l5 11.5" opacity={0.55} />
        <circle cx="7" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="12" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="17" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-title-3-semibold tracking-tight text-text-primary">Shiplog</span>
    </span>
  );
}
