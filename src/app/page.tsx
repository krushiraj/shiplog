import Link from "next/link";
import {
  RiArrowRightLine,
  RiChatCheckLine,
  RiEyeLine,
  RiGitRepositoryLine,
  RiLightbulbFlashLine,
  RiLockLine,
  RiShieldKeyholeLine,
  RiCodeSSlashLine,
  RiPlayCircleLine,
} from "@remixicon/react";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { ButtonLink } from "@/components/base/buttons/button";
import { Logo } from "@/components/brand/Logo";
import { WritingDemo } from "@/components/landing/WritingDemo";

const STEPS = [
  {
    icon: RiGitRepositoryLine,
    title: "Watch your repos",
    body: "Install the GitHub App on the repos you pick. Commits, merged PRs and releases flow in. Nothing else.",
  },
  {
    icon: RiLightbulbFlashLine,
    title: "Understands what changed",
    body: "Every change becomes a card: what, why, how and impact. When the why is a guess, it says so and asks you.",
    tags: ["what", "why", "how", "impact"],
  },
  {
    icon: RiChatCheckLine,
    title: "Posts in your voice, after you approve",
    body: "Drafts land in your inbox for LinkedIn, X and Threads. Approve and it posts through Buffer at a good time. Every edit teaches it your voice.",
  },
];

const PRIVACY = [
  { icon: RiEyeLine, text: "Diffs are read only to understand the change." },
  { icon: RiShieldKeyholeLine, text: "Secrets are scrubbed before anything reaches the model." },
  { icon: RiCodeSSlashLine, text: "Your code is never quoted in a post unless you allow it." },
];

export default function Home() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-background-full">
      <div className="shiplog-grid pointer-events-none absolute inset-x-0 top-0 h-[720px]" aria-hidden />
      <div className="shiplog-glow pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2" aria-hidden />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/" aria-label="Shiplog home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/privacy" className="hidden rounded-lg px-3 py-2 text-body-medium text-text-secondary hover:text-text-primary sm:block">
            Privacy
          </Link>
          <ThemeToggle appearance="segmented" size="small" />
          <ButtonLink href="/api/auth/buffer/start" variant="secondary" size="small" className="hidden sm:inline-flex">
            Sign in
          </ButtonLink>
        </nav>
      </header>

      <main className="relative z-10 flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pt-10 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div className="flex flex-col items-start gap-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-border-button-default bg-background-primary-default px-3 py-1 text-caption-1-medium text-text-secondary shadow-xs">
              <span className="size-1.5 rounded-full bg-accent-500" aria-hidden />
              Build in public, without writing the posts
            </span>
            <h1 className="text-display-3-semibold tracking-tight text-balance text-text-primary sm:text-display-2-semibold">
              Your commits, turned into posts{" "}
              <span className="bg-linear-to-r from-accent-500 to-accent-700 bg-clip-text text-transparent dark:from-accent-300 dark:to-accent-500">in your voice</span>, on your schedule.
            </h1>
            <p className="max-w-xl text-title-3-regular text-text-secondary">
              Shiplog reads what you shipped, works out why it matters, and drafts build-in-public posts that sound like you. You approve. It posts through Buffer.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href="/demo" leadingIcon={RiPlayCircleLine} className="h-11 px-4">
                Try the demo
              </ButtonLink>
              <ButtonLink href="/api/auth/buffer/start" variant="secondary" trailingIcon={RiArrowRightLine} className="h-11 px-4">
                Sign in with Buffer
              </ButtonLink>
            </div>
            <p className="text-caption-1-regular text-text-tertiary">The demo needs no account. It runs on Shiplog&apos;s own commits.</p>
          </div>

          <WritingDemo className="mx-auto w-full max-w-md lg:max-w-none" />
        </section>

        {/* How it works */}
        <section className="border-y border-separator-border bg-background-primary-default/60">
          <div className="mx-auto w-full max-w-6xl px-5 py-20">
            <div className="mb-10 flex flex-col gap-2">
              <span className="text-caption-1-semibold uppercase tracking-widest text-accent-600">How it works</span>
              <h2 className="text-title-1-semibold tracking-tight text-text-primary">From git push to a post you&apos;d actually write</h2>
            </div>
            <ol className="grid gap-4 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="relative flex flex-col gap-4 rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300">
                      <step.icon className="size-5" aria-hidden />
                    </span>
                    <span className="font-code text-title-2-medium text-text-placeholder">0{i + 1}</span>
                  </div>
                  <h3 className="text-headline-semibold text-text-primary">{step.title}</h3>
                  <p className="text-body-regular text-text-secondary">{step.body}</p>
                  {step.tags && (
                    <div className="flex flex-wrap gap-1.5">
                      {step.tags.map((t) => (
                        <span key={t} className="font-code rounded-md bg-background-secondary-default px-2 py-0.5 text-caption-1-medium text-text-secondary">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Privacy */}
        <section className="mx-auto w-full max-w-6xl px-5 py-20">
          <div className="grid items-center gap-8 rounded-3xl border border-border-button-default bg-background-secondary-default p-8 md:grid-cols-[1fr_1.2fr]">
            <div className="flex flex-col gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-background-primary-default shadow-xs">
                <RiLockLine className="size-5 text-foreground-icon-primary" aria-hidden />
              </span>
              <h2 className="text-title-2-semibold tracking-tight text-text-primary">Your code stays yours</h2>
              <p className="text-body-regular text-text-secondary">
                Turn diff reading off per project and Shiplog works from commit messages and PR titles only.{" "}
                <Link href="/privacy" className="text-accent-600 underline-offset-4 hover:underline">Read the privacy policy</Link>.
              </p>
            </div>
            <ul className="flex flex-col gap-3">
              {PRIVACY.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 rounded-2xl bg-background-primary-default p-4 shadow-xs">
                  <Icon className="size-5 shrink-0 text-accent-600" aria-hidden />
                  <span className="text-body-medium text-text-primary">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-separator-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-caption-1-medium text-text-tertiary sm:flex-row">
          <span>Built for Buffer Commit</span>
          <span className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-text-primary">Privacy</Link>
            <a href="https://github.com/krushiraj/shiplog" target="_blank" rel="noreferrer" className="hover:text-text-primary">GitHub</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
