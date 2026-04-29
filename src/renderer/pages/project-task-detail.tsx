import { ProjectTaskDetailContent } from "@/pages/project-task-detail/content"
import { useParams } from "react-router-dom"

export default function ProjectTaskDetailPage() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>()
  return <ProjectTaskDetailContent projectId={projectId} taskId={taskId} />
}
