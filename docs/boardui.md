# BoardUI in Shiplog

The UI uses the free (MIT) tier of [BoardUI](https://www.boardui.com): React 19, Tailwind v4 and React Aria. The components are source-owned under `src/components/{base,application,foundations}`, with styles in `src/styles` and helpers in `src/utils`. Nothing was bought, and no Pro license is used.

Setup: `yarn dlx boardui@latest init --yes`, then `yarn dlx boardui@latest add --yes <names>`.

## Free components in use

| BoardUI component | Where |
| --- | --- |
| button, icon-button, link-button | everywhere |
| badge | sidebar Inbox count |
| chip | significance pills, drift score, statuses |
| tabs | DraftCard channel tabs, Memory tabs |
| textarea | DraftCard editor, Memory brief |
| input | DraftCard nudge/answer/reject inputs, Settings |
| dropdown | Approve menu, project switcher, account menu |
| toast (+ notification) | `showLearnedToast`, inbox feedback; `<Toaster>` in the root layout |
| table (+ @tanstack/react-table) | Timeline |
| segmented-control | Timeline filter, Settings |
| select, switch, switch-card | Settings, Memory voice rules |
| theme-toggle | sidebar, landing header |
| agent-thinking | regenerate loading state, landing demo |
| composer-loader | regenerate composer and editor glow |
| sidebar (pattern) | `src/components/shell/AppSidebar.tsx` is adapted from `application/dashboard/dashboard-sidebar.tsx` |

`sidebar`, `data-table` and `settings-modal` were installed because other components depend on them. Their files are kept as references but are not rendered. They use demo content, so remove them once nothing imports them.

## Built with plain Tailwind because the BoardUI version is Pro or missing

| Need | BoardUI equivalent | What we did |
| --- | --- | --- |
| Agent progress (brief building) | Agent Progress (Pro) | Not built yet. Use AgentThinking for now. |
| Schedule calendar | Calendar (Pro) | Not built. The "pick a time" option uses a native `datetime-local` input. |
| Project dashboard charts | Contributions / chart cards (Pro) | Simple stat tiles on the Projects page. |
| Token budget | Agent Limits (Pro) | Not built. |
| Composer Panel | Pro block | Small custom nudge composer inside the free ComposerLoader. |
| App sidebar content | Free sidebar is a hard-coded demo | Shiplog's own `AppSidebar`, built in the same style. |

## Theming

- Dark mode is class-based (`.dark` on `<html>`). An inline script in `src/app/layout.tsx` applies the stored theme, or the OS theme on the first visit, before paint.
- The brand accent is violet. `src/app/globals.css` overrides the `--color-accent-*` ramp.
- Fonts: Inter (`--font-inter`) and JetBrains Mono (`.font-code`).
