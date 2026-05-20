import { loadAppConfig } from "@/lib/app-config-storage"
import { Navigate, Outlet, useLocation } from "react-router-dom"

export function ModelsOutlet() {
  const location = useLocation()
  const isModelsIndex = location.pathname === "/models" || location.pathname === "/models/"
  const defaultPage = loadAppConfig().pageFlow.models.defaultPage

  if (isModelsIndex && defaultPage !== "hub") {
    return <Navigate to={`/models/${defaultPage}`} replace />
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <Outlet />
    </div>
  )
}
