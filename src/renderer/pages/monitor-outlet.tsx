import { Outlet } from "react-router-dom"

export function MonitorOutlet() {
  return (
    <div className="min-h-full bg-background">
      <Outlet />
    </div>
  )
}
