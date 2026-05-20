import { cn } from "@/lib/utils"

export type PageTabItem = {
  id: string
  label: string
  disabled?: boolean
}

type PageTabsProps = {
  tabs: PageTabItem[]
  activeId: string
  onChange: (id: string) => void
  className?: string
}

export function PageTabs({ tabs, activeId, onChange, className }: PageTabsProps) {
  return (
    <div className={cn("border-b border-border/80", className)} role="tablist" aria-label="Tabs">
      <div className="flex flex-wrap gap-0">
        {tabs.map((tab) => {
          const selected = activeId === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`tabpanel-${tab.id}`}
              disabled={tab.disabled}
              className={cn(
                "relative -mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                tab.disabled && "pointer-events-none opacity-40",
              )}
              onClick={() => onChange(tab.id)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
