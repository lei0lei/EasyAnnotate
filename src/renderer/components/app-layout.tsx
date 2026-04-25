import { AppSidebar } from "@/components/app-sidebar"
import { AppTitlebar } from "@/components/app-titlebar"
import { STORAGE_KEYS } from "@/lib/storage/keys"
import { startTransition, useCallback, useEffect, useState } from "react"
import { Outlet } from "react-router-dom"

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === "1"
  } catch {
    return false
  }
}

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, sidebarCollapsed ? "1" : "0")
      } catch {
        /* ignore */
      }
    })
    return () => cancelAnimationFrame(id)
  }, [sidebarCollapsed])

  const toggleSidebar = useCallback(() => {
    startTransition(() => {
      setSidebarCollapsed((c) => !c)
    })
  }, [])

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background">
      <AppTitlebar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />
      <div className="flex min-h-0 flex-1">
        <AppSidebar collapsed={sidebarCollapsed} />
        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
