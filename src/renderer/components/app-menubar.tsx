import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { ipc } from "@/gen/ipc"
import { cn } from "@/lib/utils"
import { Copy, Minus, Square, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

export function AppMenubar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [isMaximized, setIsMaximized] = useState(false)
  const projectActive = pathname === "/" || pathname.startsWith("/project")
  const modelActive = pathname.startsWith("/models")
  const settingsActive = pathname.startsWith("/settings")
  const requestActive = pathname.startsWith("/requests")
  const exportActive = pathname.startsWith("/export")
  const isMac = window.navigator.userAgent.indexOf("Mac") !== -1

  useEffect(() => {
    ipc.app
      .GetWindowState({})
      .then((state) => setIsMaximized(state.isMaximized))
      .catch(() => {})
  }, [])

  return (
    <Menubar className="h-9 w-full border-0 bg-transparent p-0 shadow-none">
      <MenubarMenu>
        <MenubarTrigger
          className={cn("titlebar-no-drag", projectActive && "bg-accent text-accent-foreground")}
        >
          Project
        </MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => navigate("/project")}>Open folder</MenubarItem>
          <MenubarItem onSelect={() => navigate("/project")}>Create project</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={cn("titlebar-no-drag", modelActive && "bg-accent text-accent-foreground")}>
          Model
        </MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => navigate("/models")}>Registered model</MenubarItem>
          <MenubarItem onSelect={() => navigate("/models")}>Train model</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger
          className={cn("titlebar-no-drag", settingsActive && "bg-accent text-accent-foreground")}
        >
          Settings
        </MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => navigate("/settings")}>Shortcut</MenubarItem>
          <MenubarItem onSelect={() => navigate("/settings")}>Remote connection</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger
          className={cn("titlebar-no-drag", requestActive && "bg-accent text-accent-foreground")}
          onClick={() => navigate("/requests")}
        >
          Request
        </MenubarTrigger>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger
          className={cn("titlebar-no-drag", exportActive && "bg-accent text-accent-foreground")}
          onClick={() => navigate("/export")}
        >
          Export
        </MenubarTrigger>
      </MenubarMenu>
      <div className="titlebar-no-drag ml-auto flex items-center gap-2 pl-2">
        <ThemeToggle />
      </div>
      {!isMac && (
        <div className="titlebar-no-drag flex items-center gap-1">
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
        </div>
      )}
    </Menubar>
  )
}
