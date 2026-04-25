import { Outlet } from "react-router-dom"

export function WorkflowsOutlet() {
  return (
    <div className="min-h-full bg-background">
      <Outlet />
    </div>
  )
}
