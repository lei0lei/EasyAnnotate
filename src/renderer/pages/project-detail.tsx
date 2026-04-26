import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getProject, type ProjectItem } from "@/lib/projects-api"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { ArrowLeft, Plus, Tag, X } from "lucide-react"
import { FormEvent, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<ProjectItem | undefined>(undefined)
  const [name, setName] = useState("")
  const [projectInfo, setProjectInfo] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState("")

  useEffect(() => {
    let alive = true
    if (!projectId) return
    void getProject(projectId).then((item) => {
      if (!alive) return
      setProject(item)
      setName(item?.name ?? "")
      setProjectInfo(item?.projectInfo ?? "")
      setTags([])
    })
    return () => {
      alive = false
    }
  }, [projectId])

  function handleAddTag(e: FormEvent) {
    e.preventDefault()
    const value = newTag.trim()
    if (!value) return
    if (tags.includes(value)) {
      setNewTag("")
      return
    }
    setTags((current) => [...current, value])
    setNewTag("")
  }

  function handleRemoveTag(tag: string) {
    setTags((current) => current.filter((t) => t !== tag))
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6 pb-12">
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回我的项目">
          <Link to="/projects/mine">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">类似 CVAT 的项目信息面板（顶部悬浮）。</p>
        </div>
      </div>

      <Card className="sticky top-0 z-10 border-border/80 bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base font-medium">项目信息</CardTitle>
              <CardDescription>
                {project
                  ? `${project.storageType === "remote" ? `remote://${project.remoteIp}:${project.remotePort}` : project.localPath} · ${projectId}`
                  : `未知项目 · ${projectId ?? "—"}`}
              </CardDescription>
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button type="button" variant="outline" size="sm">
                  Action
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-card p-1 text-sm text-card-foreground shadow-md"
                  sideOffset={6}
                  align="end"
                >
                  <DropdownMenu.Item
                    className="cursor-default select-none rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                    onSelect={() => {
                      window.alert("导出项目（占位）")
                    }}
                  >
                    导出项目
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="cursor-default select-none rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                    onSelect={() => {
                      window.alert("导出标注（占位）")
                    }}
                  >
                    导出标注
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="project-name-edit" className="text-sm font-medium text-foreground">
                项目名
              </label>
              <Input
                id="project-name-edit"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入项目名"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="project-info-edit" className="text-sm font-medium text-foreground">
                项目信息
              </label>
              <textarea
                id="project-info-edit"
                value={projectInfo}
                onChange={(e) => setProjectInfo(e.target.value)}
                placeholder="输入项目信息"
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1 text-sm font-medium text-foreground">
              <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
              标签编辑
            </div>
            <form className="flex flex-wrap gap-2" onSubmit={handleAddTag}>
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="输入标签后回车或点添加"
                className="w-full sm:w-72"
                spellCheck={false}
              />
              <Button type="submit" variant="outline" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" aria-hidden />
                添加标签
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              {tags.length === 0 ? (
                <span className="text-xs text-muted-foreground">暂无标签</span>
              ) : (
                tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent"
                    onClick={() => handleRemoveTag(tag)}
                    aria-label={`删除标签 ${tag}`}
                  >
                    {tag}
                    <X className="h-3 w-3 text-muted-foreground" aria-hidden />
                  </button>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-dashed border-border/80 bg-muted/10 shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">项目工作台</CardTitle>
          <CardDescription>数据集、标注、导出等将在此展开</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">占位 — 后续接项目内导航与功能模块。</p>
        </CardContent>
      </Card>
    </div>
  )
}
