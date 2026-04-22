import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function RequestsPage() {
  return (
    <div className="p-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Requests</CardTitle>
          <CardDescription>后台任务、导入导出与远程请求队列。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>No active requests.</p>
          <Separator />
          <p className="text-xs">完成后的历史记录将显示在此处。</p>
        </CardContent>
      </Card>
    </div>
  )
}
