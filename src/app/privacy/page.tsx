import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "Privacy · Shiplog" };

const STORED = [
  ["Buffer access tokens", "Encrypted at rest. Used only to read your channels and schedule posts you approved."],
  ["Repo metadata and diff summaries", "Repo names, commit and PR titles, and short change cards (what, why, how, impact). Diffs are read to understand a change, after secrets are scrubbed. Raw diffs are not kept."],
  ["Drafts and posts", "The drafts Shiplog writes, your edits, and links to the posts that went out."],
  ["Voice rules", "The rules learned from your edits (for example, never say \"super\") and the sample posts you chose."],
] as const;

export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background-full">
      <header className="mx-auto w-full max-w-3xl px-5 py-6">
        <Link href="/" aria-label="Shiplog home"><Logo /></Link>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-5 pb-20">
        <div className="flex flex-col gap-2">
          <h1 className="text-title-1-semibold tracking-tight text-text-primary">Privacy policy</h1>
          <p className="text-body-regular text-text-secondary">Last updated 8 November 2026. Short and plain, on purpose.</p>
        </div>

        <section className="flex flex-col gap-4">
          <h2 className="text-title-3-semibold text-text-primary">What we store</h2>
          <dl className="flex flex-col divide-y divide-separator-border rounded-3xl border border-border-button-default bg-background-primary-default">
            {STORED.map(([term, desc]) => (
              <div key={term} className="flex flex-col gap-1 p-5">
                <dt className="text-body-semibold text-text-primary">{term}</dt>
                <dd className="text-body-regular text-text-secondary">{desc}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex flex-col gap-3 text-body-regular text-text-secondary">
          <h2 className="text-title-3-semibold text-text-primary">What we don&apos;t do</h2>
          <p>We never sell your data or share it with advertisers. Your code is never quoted in a post unless you turn that on for a project. To write change cards and drafts, scrubbed excerpts are sent to our AI provider, which does not train on them.</p>
        </section>

        <section className="flex flex-col gap-3 text-body-regular text-text-secondary">
          <h2 className="text-title-3-semibold text-text-primary">Deleting your data</h2>
          <p>You can delete a project or your whole account at any time from Settings. That removes your tokens, change cards, drafts and voice rules. Posts already published live on in your social accounts and in Buffer.</p>
        </section>

        <section className="flex flex-col gap-3 text-body-regular text-text-secondary">
          <h2 className="text-title-3-semibold text-text-primary">Contact</h2>
          <p>
            Questions or requests: open an issue at{" "}
            <a href="https://github.com/krushiraj/shiplog/issues" target="_blank" rel="noreferrer" className="text-accent-600 underline-offset-4 hover:underline">
              github.com/krushiraj/shiplog
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
