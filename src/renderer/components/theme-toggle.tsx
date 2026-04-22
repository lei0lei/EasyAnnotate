import { useTheme } from "@/components/theme-provider"
import { Toggle } from "@/components/ui/toggle"
import { ipc } from "@/gen/ipc"
import { Moon, Sun } from "lucide-react"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === "dark"

  function setAppTheme(next: "light" | "dark") {
    ipc.app.SetTheme({ theme: next }).then(() => setTheme(next))
  }

  return (
    <Toggle
      pressed={isDark}
      onPressedChange={(pressed) => {
        setAppTheme(pressed ? "dark" : "light")
      }}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="h-7 w-7 min-w-0 rounded-sm p-0 text-muted-foreground hover:bg-accent hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground"
    >
      {isDark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
    </Toggle>
  )
}
