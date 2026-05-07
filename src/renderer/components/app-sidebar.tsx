import { cn } from "@/lib/utils"
import {
  Activity,
  Cpu,
  FolderKanban,
  GitBranch,
  Home,
  Monitor as MonitorIcon,
  Server,
  Settings,
  User,
  type LucideIcon,
} from "lucide-react"
import { memo } from "react"
import { NavLink } from "react-router-dom"

const nav: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/models", label: "Models", icon: Cpu },
  { to: "/workflows", label: "Workflows", icon: GitBranch },
  { to: "/monitor", label: "Monitor", icon: MonitorIcon },
  { to: "/backends", label: "Backends", icon: Server },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/events", label: "Events", icon: Activity },
]

type AppSidebarProps = {
  collapsed: boolean
}

function AppSidebarInner({ collapsed }: AppSidebarProps) {
  const expanded = !collapsed

  return (
    <aside
      data-ea-app-chrome
      className={cn(
        "relative z-10 flex h-full shrink-0 flex-col overflow-hidden border-r border-border/80",
        "bg-gradient-to-b from-muted/90 via-muted/70 to-muted/50",
        "shadow-[4px_0_24px_-8px_rgba(0,0,0,0.12)] dark:shadow-[4px_0_32px_-8px_rgba(0,0,0,0.45)]",
        "ring-1 ring-border/40 dark:ring-border/20",
        "[contain:layout]",
        "will-change-[width]",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        expanded ? "w-[236px]" : "w-[52px]",
      )}
    >
      <nav
        className={cn(
          "flex flex-1 flex-col gap-1 py-3",
          expanded ? "px-2" : "px-1",
        )}
      >
        {nav.map(({ to, label, icon: Icon, end: endProp }) => (
          <NavLink
            key={to}
            to={to}
            end={endProp ?? false}
            title={label}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                "group/nav flex items-center rounded-lg py-2.5 text-sm font-medium outline-none transition-colors duration-100",
                "focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                expanded ? "gap-3 px-3" : "justify-center px-0",
                "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                isActive &&
                  "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15 dark:bg-primary/15 dark:ring-primary/25",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    "pointer-events-none h-[18px] w-[18px] shrink-0 transition-transform duration-100",
                    "group-hover/nav:scale-105",
                    isActive && "text-primary",
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "min-w-0 truncate",
                    expanded ? "opacity-100" : "sr-only",
                  )}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={cn("mt-auto border-t border-border/50 bg-muted/30", expanded ? "p-2" : "p-1")}>
        <div
          className={cn(
            "flex items-center rounded-lg text-sm text-muted-foreground",
            expanded ? "gap-3 px-2 py-2" : "justify-center px-0 py-1.5",
          )}
          role="presentation"
        >
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full bg-background/80 shadow-inner ring-1 ring-border/60 dark:bg-muted/80",
              expanded ? "h-9 w-9" : "h-8 w-8",
            )}
          >
            <User className={cn("text-muted-foreground", expanded ? "h-4 w-4" : "h-3.5 w-3.5")} aria-hidden />
          </div>
          <span
            className={cn(
              "truncate font-medium text-foreground",
              expanded ? "opacity-100" : "sr-only",
            )}
          >
            User
          </span>
        </div>
      </div>
    </aside>
  )
}

export const AppSidebar = memo(AppSidebarInner)
