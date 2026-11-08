"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  RiArrowUpDownLine,
  RiBrainLine,
  RiCheckLine,
  RiCloseLine,
  RiFolder3Line,
  RiGithubLine,
  RiHistoryLine,
  RiInbox2Line,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiAddLine,
  RiSettings4Line,
  RiSideBarFill,
} from "@remixicon/react";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import {
  Dropdown,
  DropdownDivider,
  DropdownGroup,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { LogoMark } from "@/components/brand/Logo";
import { cx } from "@/utils/cx";

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export type NavEntry = { href: string; label: string; icon: IconComponent; badge?: number };
export type SidebarProject = { id: string; name: string; repoCount: number; paused?: boolean };
export type SidebarAccount = { name: string; email: string; initials: string; avatarUrl?: string };

function buildNav(inboxCount: number): NavEntry[] {
  return [
    { href: "/inbox", label: "Inbox", icon: RiInbox2Line, badge: inboxCount },
    { href: "/timeline", label: "Timeline", icon: RiHistoryLine },
    { href: "/projects", label: "Projects", icon: RiFolder3Line },
    { href: "/memory", label: "Memory", icon: RiBrainLine },
    { href: "/settings", label: "Settings", icon: RiSettings4Line },
  ];
}

/** Text slot that blurs and shrinks away as the rail collapses (BoardUI Sidebar pattern). */
function Collapsible({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <span
      className={cx(
        "flex min-w-0 items-center overflow-hidden transition-[max-width,opacity,filter] duration-300 ease-in-out",
        collapsed ? "max-w-0 opacity-0 blur-[3px]" : "max-w-full opacity-100 blur-0",
      )}
    >
      {children}
    </span>
  );
}

function NavItem({ entry, selected, collapsed, onNavigate }: { entry: NavEntry; selected: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = entry.icon;
  return (
    <Link
      href={entry.href}
      onClick={onNavigate}
      aria-current={selected ? "page" : undefined}
      title={collapsed ? entry.label : undefined}
      className={cx(
        "flex items-center justify-between overflow-hidden rounded-2lg p-2 outline-none",
        "transition-[width,background-color] duration-300 ease-in-out focus-visible:ring-2 focus-visible:ring-border-focus-ring",
        collapsed ? "w-9" : "w-full",
        selected
          ? "bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected"
          : "hover:bg-background-secondary-hover",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className={cx("size-5 shrink-0", selected ? "text-white" : "text-foreground-icon-secondary")} aria-hidden />
        <Collapsible collapsed={collapsed}>
          <span className={cx("text-body-medium whitespace-nowrap", selected ? "text-white" : "text-text-secondary")}>
            {entry.label}
          </span>
        </Collapsible>
      </span>
      {entry.badge ? (
        <Collapsible collapsed={collapsed}>
          <Badge color={selected ? "primary" : "neutral"}>{entry.badge}</Badge>
        </Collapsible>
      ) : null}
    </Link>
  );
}

function ProjectSwitcher({
  projects,
  currentId,
  collapsed,
  onSelect,
}: {
  projects: SidebarProject[];
  currentId: string;
  collapsed: boolean;
  onSelect?: (id: string) => void;
}) {
  const current = projects.find((p) => p.id === currentId) ?? projects[0];
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label="Switch project"
        className={cx(
          "flex items-center gap-2 overflow-hidden rounded-xl transition-[width,background-color] duration-300 ease-in-out",
          collapsed ? "w-9 justify-center" : "w-full bg-background-tertiary-default p-2 hover:bg-background-tertiary-hover",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background-primary-default text-caption-1-semibold text-text-primary shadow-xs">
          {current?.name.slice(0, 1).toUpperCase()}
        </span>
        <Collapsible collapsed={collapsed}>
          <span className="flex min-w-0 flex-col items-start">
            <span className="text-caption-1-medium text-text-tertiary">Project</span>
            <span className="truncate text-body-medium text-text-primary">{current?.name}</span>
          </span>
        </Collapsible>
        {!collapsed && <RiArrowUpDownLine className="ms-auto size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />}
      </DropdownTrigger>
      <DropdownPopover aria-label="Projects" placement="bottom start" className="w-[240px]">
        <DropdownGroup label="Projects">
          {projects.map((p) => (
            <DropdownItem key={p.id} selected={p.id === current?.id} onSelect={() => onSelect?.(p.id)}>
              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span className="truncate text-body-medium text-text-primary">{p.name}</span>
                <span className="text-caption-1-regular text-text-tertiary">
                  {p.repoCount} repo{p.repoCount === 1 ? "" : "s"}
                  {p.paused ? " · paused" : ""}
                </span>
              </span>
              {p.id === current?.id && <RiCheckLine className="size-4 text-accent-600" aria-hidden />}
            </DropdownItem>
          ))}
        </DropdownGroup>
        <DropdownDivider />
        <Link href="/projects" className="flex items-center gap-2 rounded-2lg p-2 text-body-medium text-text-secondary hover:bg-background-primary-hover">
          <RiAddLine className="size-5 text-foreground-icon-secondary" aria-hidden />
          New project
        </Link>
      </DropdownPopover>
    </Dropdown>
  );
}

function AccountFooter({ account, collapsed, onSignOut }: { account: SidebarAccount; collapsed: boolean; onSignOut?: () => void }) {
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label="Account"
        className={cx(
          "flex items-center gap-2 overflow-hidden rounded-xl border-2 border-transparent transition-[width,background-color] duration-300 ease-in-out hover:border-border-button-hover",
          collapsed ? "size-9 justify-center" : "w-full bg-background-tertiary-default py-2 pe-3 ps-2",
        )}
      >
        <Avatar size="md" color="blue" src={account.avatarUrl} initials={account.initials} alt={account.name} />
        <Collapsible collapsed={collapsed}>
          <span className="flex min-w-0 flex-col items-start">
            <span className="truncate text-body-medium text-text-primary">{account.name}</span>
            <span className="truncate text-caption-1-regular text-text-secondary">{account.email}</span>
          </span>
        </Collapsible>
      </DropdownTrigger>
      <DropdownPopover aria-label="Account menu" placement="top start" className="w-[240px]">
        <DropdownGroup>
          <a
            href="https://github.com/krushiraj/shiplog/issues"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-2lg p-2 text-body-medium text-text-primary hover:bg-background-primary-hover"
          >
            <RiGithubLine className="size-5 text-foreground-icon-secondary" aria-hidden />
            Feedback on GitHub
          </a>
          <DropdownItem onSelect={onSignOut}>
            <RiLogoutBoxRLine className="size-5 text-foreground-icon-secondary" aria-hidden />
            <span className="text-body-medium text-text-primary">Sign out</span>
          </DropdownItem>
        </DropdownGroup>
      </DropdownPopover>
    </Dropdown>
  );
}

export type AppSidebarProps = {
  /** Pending drafts, shown as the Inbox badge. */
  inboxCount: number;
  projects: SidebarProject[];
  currentProjectId: string;
  account: SidebarAccount;
  onProjectChange?: (id: string) => void;
  onSignOut?: () => void;
  mobile?: boolean;
  onClose?: () => void;
};

/** Shiplog app navigation, adapted from BoardUI's floating dashboard Sidebar. */
export function AppSidebar({ inboxCount, projects, currentProjectId, account, onProjectChange, onSignOut, mobile = false, onClose }: AppSidebarProps) {
  const pathname = usePathname();
  const [collapsedState, setCollapsed] = useState(false);
  const collapsed = mobile ? false : collapsedState;
  const nav = buildNav(inboxCount);

  return (
    <aside
      className={cx(
        "flex h-full shrink-0 flex-col justify-between overflow-hidden rounded-3xl border border-border-button-white bg-background-secondary-default shadow-sidebar",
        "transition-[width] duration-300 ease-in-out",
        collapsed ? "w-[60px] px-[11px] py-3" : "w-[260px] p-3",
      )}
    >
      <div className="flex min-h-0 flex-col gap-4">
        <div className={cx("flex items-center", collapsed ? "flex-col-reverse gap-3" : "justify-between")}>
          <Link href="/" className="flex items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring" aria-label="Shiplog home">
            <LogoMark className={collapsed ? "size-9" : undefined} />
            <Collapsible collapsed={collapsed}>
              <span className="text-headline-semibold text-text-primary">Shiplog</span>
            </Collapsible>
          </Link>
          <button
            type="button"
            aria-label={mobile ? "Close menu" : collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={mobile ? onClose : () => setCollapsed(!collapsedState)}
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover"
          >
            {mobile ? (
              <RiCloseLine className="size-5" aria-hidden />
            ) : (
              <RiSideBarFill className={cx("size-5 transition-transform duration-300", !collapsed && "-scale-x-100")} aria-hidden />
            )}
          </button>
        </div>

        <ProjectSwitcher projects={projects} currentId={currentProjectId} collapsed={collapsed} onSelect={onProjectChange} />

        <nav className="flex flex-col gap-1" aria-label="Main">
          {nav.map((entry) => (
            <NavItem
              key={entry.href}
              entry={entry}
              collapsed={collapsed}
              selected={pathname === entry.href || pathname.startsWith(`${entry.href}/`)}
              onNavigate={mobile ? onClose : undefined}
            />
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-3">
        {collapsed ? <ThemeToggle collapsed /> : <ThemeToggle appearance="sidebar-segmented" />}
        <AccountFooter account={account} collapsed={collapsed} onSignOut={onSignOut} />
      </div>
    </aside>
  );
}

/** Desktop rail + mobile drawer around the page content. */
export function AppShell({ children, ...sidebar }: AppSidebarProps & { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh w-full bg-background-full">
      <div className="sticky top-0 hidden h-dvh p-3 lg:block">
        <AppSidebar {...sidebar} />
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="relative h-full w-fit p-3 shiplog-rise">
            <AppSidebar {...sidebar} mobile onClose={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-separator-border bg-background-full/85 px-4 py-3 backdrop-blur lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="flex size-9 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover"
          >
            <RiMenuLine className="size-5" aria-hidden />
          </button>
          <span className="flex items-center gap-2">
            <LogoMark className="size-7" />
            <span className="text-headline-semibold text-text-primary">Shiplog</span>
          </span>
          <span className="size-9" />
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
