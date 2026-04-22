import { ThemeProvider } from "@/components/theme-provider"
import { AppLayout } from "@/components/app-layout"
import WelcomePage from "@/pages/welcome"
import ProjectPage from "@/pages/project"
import ModelsPage from "@/pages/models"
import SettingsPage from "@/pages/settings"
import RequestsPage from "@/pages/requests"
import ExportPage from "@/pages/export"
import { Navigate, Route, Routes } from "react-router-dom"

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/project" element={<ProjectPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ThemeProvider>
  )
}
