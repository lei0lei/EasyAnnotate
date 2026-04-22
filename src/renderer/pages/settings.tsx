import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export default function SettingsPage() {
  return (
    <div className="p-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>通用选项、快捷键与外观。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none" htmlFor="workspace-root">
              Workspace root
            </label>
            <Input id="workspace-root" placeholder="D:\datasets\…" disabled />
          </div>
          <Button disabled>Save</Button>
        </CardContent>
      </Card>
    </div>
  )
}
