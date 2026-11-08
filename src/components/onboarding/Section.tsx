import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

export function Section({
  title,
  description,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("flex flex-col gap-4 rounded-3xl border border-border-button-default bg-background-primary-default p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-headline-semibold text-text-primary">{title}</h2>
          {description && <p className="text-body-2-regular text-text-secondary">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
