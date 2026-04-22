import { AppMenubar } from "@/components/app-menubar"
import { Outlet } from "react-router-dom"

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="titlebar-drag shrink-0 border-b bg-muted/40 px-2 py-1.5">
        <AppMenubar />
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
