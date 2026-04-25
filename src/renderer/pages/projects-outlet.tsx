import { Outlet } from "react-router-dom"

export function ProjectsOutlet() {
  return (
    <div className="min-h-full bg-background">
      <Outlet />
    </div>
  )
}
