import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ModelsPage() {
  return (
    <div className="p-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>模型列表、版本与推理参数将放在这里。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button disabled>Refresh</Button>
          <Button variant="outline" disabled>
            Add model
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
