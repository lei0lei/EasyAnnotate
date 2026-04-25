import { Outlet } from "react-router-dom"

export function ModelsOutlet() {
  return (
    <div className="min-h-full bg-background">
      <Outlet />
    </div>
  )
}
