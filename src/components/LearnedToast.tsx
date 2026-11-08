"use client";

import { RiSparkling2Fill } from "@remixicon/react";
import { toast } from "@/components/base/toast/toast";

export type LearnedToastOptions = {
  /** The rule in plain words, e.g. `you cut "super"`. */
  lesson: string;
  detail?: string;
  onAccept?: () => void;
  onUndo?: () => void;
};

/** "Shiplog learned: …" toast with Accept / Undo. Accepting makes the rule live immediately. */
export function showLearnedToast({ lesson, detail, onAccept, onUndo }: LearnedToastOptions) {
  return toast(`Shiplog learned: ${lesson}`, {
    description: detail ?? "Accept to apply it to every future draft, or undo to forget it.",
    icon: RiSparkling2Fill,
    status: "information",
    duration: 9000,
    actions: [
      { label: "Accept", variant: "primary", onClick: onAccept },
      { label: "Undo", variant: "secondary", onClick: onUndo },
    ],
  });
}
