import { ThemeProvider } from "@/components/theme-provider"
import { STORAGE_KEYS } from "@/lib/storage/keys"
import { AppLayout } from "@/components/app-layout"
import BackendsPage from "@/pages/backends"
import EventsPage from "@/pages/events"
import HomePage from "@/pages/home"
import ModelsAutoPage from "@/pages/models-auto"
import ModelsHubPage from "@/pages/models-hub"
import { ModelsOutlet } from "@/pages/models-outlet"
import ModelsTrainingPage from "@/pages/models-training"
import ProjectDetailPage from "@/pages/project-detail"
import ProjectExportPage from "@/pages/project-export"
import ProjectTaskAppendImagesPage from "@/pages/project-task-append-images"
import ProjectTaskCreatePage from "@/pages/project-task-create"
import ProjectTaskDetailPage from "@/pages/project-task-detail"
import ProjectsCreatePage from "@/pages/projects-create"
import ProjectsCreateConfigPage from "@/pages/projects-create-config"
import ProjectsHubPage from "@/pages/projects-hub"
import ProjectsImportPage from "@/pages/projects-import"
import ProjectsMinePage from "@/pages/projects-mine"
import { ProjectsOutlet } from "@/pages/projects-outlet"
import { MonitorDetailOutlet } from "@/pages/monitor-detail-outlet"
import MonitorEditorPage from "@/pages/monitor-editor"
import MonitorHubPage from "@/pages/monitor-hub"
import { MonitorOutlet } from "@/pages/monitor-outlet"
import MonitorPreviewPage from "@/pages/monitor-preview"
import WorkflowEditorPage from "@/pages/workflow-editor"
import WorkflowsHubPage from "@/pages/workflows-hub"
import { WorkflowsOutlet } from "@/pages/workflows-outlet"
import SettingsPage from "@/pages/settings"
import { Navigate, Route, Routes } from "react-router-dom"

export default function App() {
  return (
    <ThemeProvider storageKey={STORAGE_KEYS.theme}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="projects" element={<ProjectsOutlet />}>
            <Route index element={<ProjectsHubPage />} />
            <Route path="new" element={<ProjectsCreatePage />} />
            <Route path="new/config" element={<ProjectsCreateConfigPage />} />
            <Route path="import" element={<ProjectsImportPage />} />
            <Route path="mine" element={<ProjectsMinePage />} />
            <Route path=":projectId/export" element={<ProjectExportPage />} />
            <Route path=":projectId/tasks/new" element={<ProjectTaskCreatePage />} />
            <Route path=":projectId/tasks/:taskId/append-images" element={<ProjectTaskAppendImagesPage />} />
            <Route path=":projectId/tasks/:taskId/export" element={<ProjectExportPage />} />
            <Route path=":projectId/tasks/:taskId" element={<ProjectTaskDetailPage />} />
            <Route path=":projectId" element={<ProjectDetailPage />} />
          </Route>
          <Route path="workflows" element={<WorkflowsOutlet />}>
            <Route index element={<WorkflowsHubPage />} />
            <Route path=":workflowId" element={<WorkflowEditorPage />} />
          </Route>
          <Route path="models" element={<ModelsOutlet />}>
            <Route index element={<ModelsHubPage />} />
            <Route path="auto" element={<ModelsAutoPage />} />
            <Route path="training" element={<ModelsTrainingPage />} />
          </Route>
          <Route path="monitor" element={<MonitorOutlet />}>
            <Route index element={<MonitorHubPage />} />
            <Route path=":monitorId" element={<MonitorDetailOutlet />}>
              <Route index element={<MonitorEditorPage />} />
              <Route path="preview" element={<MonitorPreviewPage />} />
            </Route>
          </Route>
          <Route path="backends" element={<BackendsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ThemeProvider>
  )
}
