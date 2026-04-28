import { Button } from "@/components/ui/button"
import { ProjectTagsEditor } from "@/components/project-tags-editor"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { ProjectTag } from "@/lib/projects-api"
import { ArrowLeft } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"

export default function ProjectsCreatePage() {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [projectInfo, setProjectInfo] = useState("")
  const [projectType, setProjectType] = useState("detect")
  const [storageType, setStorageType] = useState("local")
  const [tags, setTags] = useState<ProjectTag[]>([])

  const canSubmit = name.trim().length > 0

  function handleCreate() {
    if (!canSubmit) {
      window.alert("请先填写项目名称。")
      return
    }
    navigate("/projects/new/config", {
      state: {
        name: name.trim(),
        projectInfo: projectInfo.trim(),
        projectType,
        storageType,
        tags,
      },
    })
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8 pb-12">
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Projects">
          <Link to="/projects">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">创建项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">填写项目基本信息后进入下一步配置</p>
        </div>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-medium">项目信息</CardTitle>
          <CardDescription>名称、说明、类型与存储方式</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="project-create-name" className="text-sm font-medium text-foreground">
              名称
            </label>
            <Input
              id="project-create-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：Retail Counter v3"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="project-create-info" className="text-sm font-medium text-foreground">
              项目信息
            </label>
            <textarea
              id="project-create-info"
              value={projectInfo}
              onChange={(e) => setProjectInfo(e.target.value)}
              placeholder="填写项目用途、数据来源、标注范围等"
              className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          <ProjectTagsEditor title="初始标签" tags={tags} onChange={setTags} />

          <div className="space-y-2">
            <label htmlFor="project-create-type" className="text-sm font-medium text-foreground">
              类型
            </label>
            <select
              id="project-create-type"
              value={projectType}
              onChange={(e) => setProjectType(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="detect">detect</option>
              <option value="segment">segment</option>
              <option value="detect-obb">detect-obb</option>
              <option value="classfy">classfy</option>
            </select>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">选择存储</p>
            <div className="flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="project-storage-type"
                  value="local"
                  checked={storageType === "local"}
                  onChange={(e) => setStorageType(e.target.value)}
                />
                本地存储
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="project-storage-type"
                  value="remote"
                  checked={storageType === "remote"}
                  onChange={(e) => setStorageType(e.target.value)}
                />
                远程存储
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" onClick={handleCreate}>
              下一步
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link to="/projects">取消</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
