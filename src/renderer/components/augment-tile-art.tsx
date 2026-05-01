import { useId } from "react"

/**
 * Roboflow 风格的数据增强 tile 图示：小型抽象插画，非单一 Lucide 图标。
 * 按中文名称匹配；未知名称使用中性几何占位。
 */
export function AugmentTileArt({ name }: { name: string }) {
  const uid = useId().replace(/:/g, "")
  const base = "relative h-full w-full overflow-hidden rounded-md bg-gradient-to-br from-muted/80 to-muted/40"
  const svgWrap = "absolute inset-0 flex items-center justify-center p-2"

  switch (name) {
    case "反转": {
      const gidL = `aug-flipL-${uid}`
      const gidR = `aug-flipR-${uid}`
      return (
        <div className={base}>
          <div className={svgWrap}>
            <svg
              viewBox="0 0 72 48"
              className="h-auto max-h-full w-full max-w-[96%] text-foreground/85"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden
            >
              <defs>
                <linearGradient id={gidL} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0.72" />
                </linearGradient>
                <linearGradient id={gidR} x1="1" y1="0" x2="0" y2="0">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0.38" />
                </linearGradient>
              </defs>
              <rect x="4" y="10" width="30" height="28" rx="3" fill={`url(#${gidL})`} />
              <rect x="38" y="10" width="30" height="28" rx="3" fill={`url(#${gidR})`} />
              <path d="M36 8v32" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.35" />
              <path d="M14 22h8M14 26h12M14 30h6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" />
              <path d="M50 22h8M46 26h12M50 30h6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.35" transform="scale(-1,1) translate(-72,0)" />
            </svg>
          </div>
        </div>
      )
    }

    case "90°旋转":
      return (
        <div className={base}>
          <div className={svgWrap}>
            <svg viewBox="0 0 64 56" className="h-full w-full max-h-[3.25rem]" aria-hidden>
              <rect
                x="22"
                y="14"
                width="26"
                height="26"
                rx="3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeOpacity="0.45"
                transform="rotate(22 35 27)"
              />
              <path
                d="M48 10 A18 18 0 0 1 54 28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeOpacity="0.55"
                strokeLinecap="round"
              />
              <polygon points="54,6 58,14 50,12" fill="currentColor" fillOpacity="0.5" />
            </svg>
          </div>
        </div>
      )

    case "裁剪":
      return (
        <div className={base}>
          <div className={svgWrap}>
            <svg viewBox="0 0 72 52" className="h-full w-full max-h-[3.25rem]" aria-hidden>
              <rect x="8" y="8" width="56" height="36" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" strokeDasharray="4 3" />
              <rect x="22" y="14" width="36" height="26" rx="3" className="fill-primary/25 stroke-primary/60" strokeWidth="1.5" />
              <path d="M22 14H8M22 40H8M50 14H64M50 40H64" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.35" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )

    case "旋转":
      return (
        <div className={base}>
          <div className={svgWrap}>
            <svg viewBox="0 0 72 52" className="h-full w-full max-h-[3.25rem]" aria-hidden>
              <rect x="20" y="12" width="34" height="28" rx="4" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.4" strokeOpacity="0.45" transform="rotate(-12 37 26)" />
              <path d="M12 38 Q36 8 60 38" fill="none" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )

    case "shear":
      return (
        <div className={base}>
          <div className={svgWrap}>
            <svg viewBox="0 0 72 52" className="h-full w-full max-h-[3.25rem]" aria-hidden>
              <polygon points="14,38 58,32 62,18 18,24" className="fill-primary/20 stroke-primary/55" strokeWidth="1.5" />
              <polygon points="16,40 56,35 60,22 20,27" fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity="0.25" />
            </svg>
          </div>
        </div>
      )

    case "灰度":
      return (
        <div className={base}>
          <div className="absolute inset-2 rounded-md bg-gradient-to-r from-neutral-700 via-neutral-400 to-neutral-200 opacity-90" />
          <div className="absolute bottom-2 left-2 right-2 h-1 rounded-full bg-background/50" />
        </div>
      )

    case "hue":
      return (
        <div className={base}>
          <div className="absolute inset-2 rounded-md bg-gradient-to-r from-rose-400 via-amber-300 to-sky-500 opacity-85" />
          <div className="absolute inset-3 rounded-sm border border-white/20" />
        </div>
      )

    case "饱和度":
      return (
        <div className={base}>
          <div className={svgWrap}>
            <svg viewBox="0 0 72 48" className="h-full w-full max-h-[3.25rem]" aria-hidden>
              <rect x="8" y="14" width="22" height="22" rx="3" className="fill-sky-500/80" />
              <rect x="36" y="14" width="28" height="22" rx="3" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeOpacity="0.35" />
            </svg>
          </div>
        </div>
      )

    case "亮度":
      return (
        <div className={base}>
          <div className="absolute inset-0 bg-gradient-to-br from-amber-100/30 via-transparent to-transparent" />
          <div className={svgWrap}>
            <svg viewBox="0 0 64 48" className="h-full w-full max-h-[3.25rem]" aria-hidden>
              <circle cx="32" cy="24" r="10" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.45" />
              {[0, 45, 90, 135].map((deg) => (
                <line
                  key={deg}
                  x1="32"
                  y1="24"
                  x2="32"
                  y2="8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeOpacity="0.35"
                  strokeLinecap="round"
                  transform={`rotate(${deg} 32 24)`}
                />
              ))}
            </svg>
          </div>
        </div>
      )

    case "曝光":
      return (
        <div className={base}>
          <div
            className="absolute inset-2 rounded-md opacity-95"
            style={{
              background: "radial-gradient(circle at 30% 25%, rgba(253,230,138,0.95) 0%, rgba(254,243,199,0.45) 35%, transparent 65%)",
            }}
          />
          <div className="absolute inset-3 rounded-sm bg-white/30 blur-[2px]" />
        </div>
      )

    case "模糊":
      return (
        <div className={base}>
          <div className="absolute inset-3 rounded-md bg-primary/25 blur-[3px]" />
          <div className="absolute inset-4 rounded-md border border-primary/30 bg-primary/10 blur-[1px]" />
          <div className="absolute inset-5 rounded-sm border border-foreground/10" />
        </div>
      )

    case "噪声":
      return (
        <div className={base}>
          <svg viewBox="0 0 72 48" className="h-full w-full max-h-[3.25rem] opacity-80" aria-hidden>
            {[
              [10, 12, 0.35],
              [22, 28, 0.45],
              [34, 10, 0.55],
              [48, 32, 0.38],
              [58, 16, 0.5],
              [16, 36, 0.42],
              [40, 22, 0.48],
              [54, 40, 0.36],
            ].map(([x, y, o], i) => (
              <circle key={i} cx={x} cy={y} r="1.4" fill="currentColor" fillOpacity={o} />
            ))}
          </svg>
        </div>
      )

    case "cutout":
      return (
        <div className={base}>
          <div className={svgWrap}>
            <svg viewBox="0 0 72 52" className="h-full w-full max-h-[3.25rem]" aria-hidden>
              <rect x="10" y="10" width="52" height="32" rx="4" className="fill-primary/25" />
              <rect x="28" y="18" width="18" height="14" rx="2" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeOpacity="0.35" strokeDasharray="3 2" />
            </svg>
          </div>
        </div>
      )

    case "mosaic":
      return (
        <div className={base}>
          <div className="absolute inset-3 grid grid-cols-4 grid-rows-3 gap-px rounded-md overflow-hidden border border-border/40">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className={i % 3 === 0 ? "bg-primary/35" : i % 3 === 1 ? "bg-muted-foreground/25" : "bg-primary/15"}
              />
            ))}
          </div>
        </div>
      )

    case "运动模糊":
      return (
        <div className={base}>
          <div className="absolute inset-4 flex flex-col justify-center gap-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-70"
                style={{ transform: `translateX(${(i - 3) * 4}px)` }}
              />
            ))}
          </div>
        </div>
      )

    case "相机增益":
      return (
        <div className={base}>
          <div className="absolute inset-4 flex items-end justify-between gap-1">
            {[0.35, 0.55, 0.9, 0.65, 0.45, 0.8, 0.5].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm bg-primary/50" style={{ height: `${h * 100}%` }} />
            ))}
          </div>
        </div>
      )

    default:
      return (
        <div className={base}>
          <div className="absolute inset-3 rounded-md border border-dashed border-foreground/15 bg-foreground/[0.04]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="grid grid-cols-2 gap-1 opacity-50">
              <div className="h-5 w-5 rounded-sm bg-primary/40" />
              <div className="h-5 w-5 rounded-sm bg-primary/20" />
              <div className="h-5 w-5 rounded-sm bg-primary/25" />
              <div className="h-5 w-5 rounded-sm bg-primary/35" />
            </div>
          </div>
        </div>
      )
  }
}
