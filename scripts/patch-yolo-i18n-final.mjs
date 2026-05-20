import fs from "node:fs"

const filePath = new URL("../src/renderer/pages/models-training-yolo.tsx", import.meta.url)
let s = fs.readFileSync(filePath, "utf8")

s = s.replace(
  `if (!backendOk) {
      setNameError(m.errors.nameInvalid)
      return
    }`,
  `if (!backendOk) {
      setNameError(m.errors.connectBackend)
      return
    }`,
)

s = s.replace(
  `<p className="text-xs font-medium text-muted-foreground">{m.labelBaseWeight}</p>
              <motion.div className="grid gap-4 sm:grid-cols-2">`,
  `<p className="text-xs font-medium text-muted-foreground">{m.labelCommonParams}</p>
              <div className="grid gap-4 sm:grid-cols-2">`,
)

// fix if motion.div was never there
s = s.replace(
  `<p className="text-xs font-medium text-muted-foreground">{m.labelBaseWeight}</p>
              <div className="grid gap-4 sm:grid-cols-2">`,
  `<p className="text-xs font-medium text-muted-foreground">{m.labelCommonParams}</p>
              <motion.div className="grid gap-4 sm:grid-cols-2">`,
)
s = s.replace(
  `<p className="text-xs font-medium text-muted-foreground">{m.labelCommonParams}</p>
              <motion.div className="grid gap-4 sm:grid-cols-2">`,
  `<p className="text-xs font-medium text-muted-foreground">{m.labelCommonParams}</p>
              <div className="grid gap-4 sm:grid-cols-2">`,
)

s = s.replace(
  `          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label={m.backAria}>
              <Link to="/models/training">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{m.pageTitle}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {locale === "zh-CN" ? (
                  <>
                    每次训练在 <code className="text-xs">external/temp/&lt;训练名&gt;/</code> 独立目录
                  </>
                ) : (
                  m.pageSubtitle
                )}
              </p>
            </div>
          </div>`,
  `          <div className="flex flex-wrap items-start gap-3">
            <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label={m.backAria}>
              <Link to="/models/training">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{m.pageTitle}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{m.pageSubtitle}</p>
            </div>
            <div className="ml-auto flex shrink-0 gap-1 rounded-lg border border-border/60 p-0.5">
              <Button
                type="button"
                size="sm"
                variant={locale === "zh-CN" ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setLocale("zh-CN")}
              >
                {m.languageZh}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={locale === "en" ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setLocale("en")}
              >
                {m.languageEn}
              </Button>
            </div>
          </div>`,
)

s = s.replace(
  `                ) : (
                  {m.startTraining}
                )}`,
  `                ) : (
                  m.startTraining
                )}`,
)

fs.writeFileSync(filePath, s, "utf8")
console.log("done")
