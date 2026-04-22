import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ExportPage() {
  return (
    <div className="p-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>导出标注结果、数据包与报告。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button disabled>Export labels</Button>
          <Button variant="outline" disabled>
            Export report
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
