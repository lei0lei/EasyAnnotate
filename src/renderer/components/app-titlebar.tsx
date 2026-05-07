import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { ipc } from "@/gen/ipc"
import { cn } from "@/lib/utils"
import { Copy, Minus, PanelLeftClose, PanelRightOpen, Square, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

type AppTitlebarProps = {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onHeightChange?: (height: number) => void
}

export function AppTitlebar({ sidebarCollapsed, onToggleSidebar, onHeightChange }: AppTitlebarProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const isMac = window.navigator.userAgent.indexOf("Mac") !== -1
  const headerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    void ipc.app
      .GetWindowState({})
      .then((state) => setIsMaximized(state.isMaximized))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const el = headerRef.current
    if (!el || !onHeightChange) return
    const syncHeight = () => onHeightChange(el.getBoundingClientRect().height)
    syncHeight()
    const observer = new ResizeObserver(() => syncHeight())
    observer.observe(el)
    return () => observer.disconnect()
  }, [onHeightChange])

  // Align toggle icon center with sidebar nav icons: collapsed rail 52px (nav px-1 + centered 18px icon), expanded (nav px-2 + link pl-3 + half icon).
  const sidebarToggleOffset = sidebarCollapsed ? "ml-3" : "ml-[15px]"

  return (
    <header
      ref={headerRef}
      data-ea-app-chrome
      className="titlebar-drag flex h-9 shrink-0 items-center border-b border-border bg-muted/30 pr-2 pl-0"
    >
      <span
        role="button"
        tabIndex={0}
        className={cn(
          "titlebar-no-drag flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          sidebarToggleOffset,
        )}
        onClick={onToggleSidebar}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggleSidebar()
          }
        }}
        aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
      >
        {sidebarCollapsed ? (
          <PanelRightOpen className="h-[18px] w-[18px]" aria-hidden />
        ) : (
          <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />
        )}
      </span>
      <div className="min-h-0 min-w-0 flex-1" aria-hidden />
      <div className="titlebar-no-drag flex shrink-0 items-center gap-1">
        <ThemeToggle />
        {!isMac && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-sm"
              onClick={() => {
                void ipc.app.MinimizeWindow({})
              }}
              aria-label="Minimize"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-sm"
              onClick={() => {
                void ipc.app.ToggleMaximizeWindow({}).then((state) => {
                  setIsMaximized(state.isMaximized)
                })
              }}
              aria-label={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-sm hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => {
                void ipc.app.CloseWindow({})
              }}
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </header>
  )
}
