import { Button } from "@/components/ui/button"
import { useAppLocale } from "@/components/locale-provider"

export function LocaleToggle() {
  const { locale, setLocale } = useAppLocale()
  const isZh = locale === "zh-CN"

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0 rounded-sm text-xs font-medium tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label={isZh ? "Switch to English" : "Switch to Chinese"}
      onClick={() => setLocale(isZh ? "en" : "zh-CN")}
    >
      {isZh ? "ZH" : "EN"}
    </Button>
  )
}
