import type { RemixiconComponentType } from "@remixicon/react";
import { ButtonLink } from "@/components/base/buttons/button";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: RemixiconComponentType;
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border-button-default px-6 py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-background-secondary-default">
        <Icon className="size-6 text-foreground-icon-secondary" aria-hidden />
      </span>
      <h2 className="text-title-3-semibold text-text-primary">{title}</h2>
      <p className="max-w-sm text-body-regular text-text-secondary">{description}</p>
      {action && (
        <ButtonLink href={action.href} variant="secondary">
          {action.label}
        </ButtonLink>
      )}
    </div>
  );
}
