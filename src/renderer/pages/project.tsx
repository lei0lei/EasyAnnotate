import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ProjectPage() {
  return (
    <div className="p-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Project</CardTitle>
          <CardDescription>工程、数据集与导出目录将放在这里。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button disabled>Open folder</Button>
          <Button variant="outline" disabled>
            New project
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
