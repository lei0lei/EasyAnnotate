import fs from "node:fs"

const filePath = new URL("../src/renderer/pages/models-training-yolo.tsx", import.meta.url)
let s = fs.readFileSync(filePath, "utf8")

const replacements = [
  [
    `const TASKS: Array<{ id: YoloTaskId; label: string }> = [
  { id: "detect", label: "检测" },
  { id: "segment", label: "分割" },
  { id: "pose", label: "姿态" },
  { id: "obb", label: "OBB" },
  { id: "classify", label: "分类" },
]`,
    `const TASK_IDS: YoloTaskId[] = ["detect", "segment", "pose", "obb", "classify"]`,
  ],
  [
    `function applyWeightValidation(
  result: YoloWeightValidationResponse,
  family: YoloFamilyId,
  task: YoloTaskId,
): {`,
    `function applyWeightValidation(
  result: YoloWeightValidationResponse,
  family: YoloFamilyId,
  task: YoloTaskId,
  weightMismatchFallback: string,
): {`,
  ],
  ['warningText ?? "权重与当前模型族或任务不匹配"', "warningText ?? weightMismatchFallback"],
  [
    `        const v = applyWeightValidation(
          { weight_meta: binding.weightMeta, weight_warnings: binding.weightWarnings },
          family,
          task,
        )`,
    `        const v = applyWeightValidation(
          { weight_meta: binding.weightMeta, weight_warnings: binding.weightWarnings },
          family,
          task,
          m.errors.weightMismatch,
        )`,
  ],
  ['[family, task]', '[family, task, m.errors.weightMismatch, m.errors.uploadedWeightFallback]'],
  [
    'setUploadedWeightLabel(ws.base_model_filename ?? "已上传权重")',
    "setUploadedWeightLabel(ws.base_model_filename ?? m.errors.uploadedWeightFallback)",
  ],
  [
    "const v = applyWeightValidation(result, family, task)",
    "const v = applyWeightValidation(result, family, task, m.errors.weightMismatch)",
  ],
  [
    "[jobSlug, backendOk, family, task, baseModelReady, baseModelBusy]",
    "[jobSlug, backendOk, family, task, baseModelReady, baseModelBusy, m.errors.weightMismatch]",
  ],
  [
    `  const backendChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (backendOk === null) return { label: "正在检测后端…", tone: "pending" }
    if (!backendOk) return { label: "后端 API 未连接，请先在设置中启动本地或连接远程后端", tone: "error" }
    return { label: "后端 API 已连接", tone: "done" }
  }, [backendOk])`,
    `  const backendChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (backendOk === null) return { label: m.checklist.backendChecking, tone: "pending" }
    if (!backendOk) return { label: m.checklist.backendDisconnected, tone: "error" }
    return { label: m.checklist.backendConnected, tone: "done" }
  }, [backendOk, m.checklist])`,
  ],
  [
    `  const jobChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (nameError) return { label: nameError, tone: "error" }
    if (nameDuplicate) return { label: "训练名称已被使用，请重新输入或删除同名项目", tone: "error" }
    if (jobReady) return { label: \`已创建训练任务（external/temp/\${jobSlug}）\`, tone: "done" }
    if (slugPreview) return { label: "填写训练名称后，点右侧 + 创建工作区", tone: "pending" }
    return { label: "请先填写并创建工作区", tone: "pending" }
  }, [nameError, nameDuplicate, jobReady, jobSlug, slugPreview])`,
    `  const jobChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (nameError) return { label: nameError, tone: "error" }
    if (nameDuplicate) return { label: m.checklist.nameDuplicate, tone: "error" }
    if (jobReady) return { label: m.checklist.jobCreated(jobSlug), tone: "done" }
    if (slugPreview) return { label: m.checklist.nameThenCreate, tone: "pending" }
    return { label: m.checklist.createWorkspaceFirst, tone: "pending" }
  }, [nameError, nameDuplicate, jobReady, jobSlug, slugPreview, m.checklist])`,
  ],
  [
    `  const weightChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (!jobReady) return { label: "请先创建工作区", tone: "pending" }
    if (baseModelBusy) return { label: "正在绑定基础模型…", tone: "pending" }
    if (baseModelError) return { label: baseModelError, tone: "error" }
    if (!baseModelReady) {
      if (models.length === 0) {
        return { label: "无 registry 模型，请上传 .pt 权重", tone: "pending" }
      }
      return { label: "请选择列表权重或上传 .pt", tone: "pending" }
    }
    if (!baseModelValid) return { label: "初始权重不可用", tone: "error" }
    if (baseModelWarning) return { label: baseModelWarning, tone: "warn" }
    return { label: "初始权重已就绪", tone: "done" }
  }, [jobReady, baseModelBusy, baseModelError, baseModelReady, baseModelValid, baseModelWarning, models.length])`,
    `  const weightChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (!jobReady) return { label: m.checklist.weightNeedWorkspace, tone: "pending" }
    if (baseModelBusy) return { label: m.checklist.weightBinding, tone: "pending" }
    if (baseModelError) return { label: baseModelError, tone: "error" }
    if (!baseModelReady) {
      if (models.length === 0) {
        return { label: m.checklist.weightNoRegistry, tone: "pending" }
      }
      return { label: m.checklist.weightSelectOrUpload, tone: "pending" }
    }
    if (!baseModelValid) return { label: m.checklist.weightInvalid, tone: "error" }
    if (baseModelWarning) return { label: baseModelWarning, tone: "warn" }
    return { label: m.checklist.weightReady, tone: "done" }
  }, [jobReady, baseModelBusy, baseModelError, baseModelReady, baseModelValid, baseModelWarning, models.length, m.checklist])`,
  ],
  [
    `  const datasetChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (!jobReady) return { label: "请先创建工作区", tone: "pending" }
    if (datasetError) return { label: datasetError, tone: "error" }
    if (dataYaml) {
      const name = datasetZipFilename ? \`（\${datasetZipFilename}）\` : ""
      return { label: \`数据集已就绪\${name}\`, tone: "done" }
    }
    if (isLocalBackend) {
      return { label: "请点击右侧图标选择 ZIP 数据集", tone: "pending" }
    }
    return { label: "请上传 ZIP 数据集", tone: "pending" }
  }, [jobReady, datasetError, dataYaml, datasetZipFilename, isLocalBackend])`,
    `  const datasetChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (!jobReady) return { label: m.checklist.datasetNeedWorkspace, tone: "pending" }
    if (datasetError) return { label: datasetError, tone: "error" }
    if (dataYaml) {
      const name = datasetZipFilename ? \`（\${datasetZipFilename}）\` : ""
      return { label: m.checklist.datasetReady(name), tone: "done" }
    }
    if (isLocalBackend) {
      return { label: m.checklist.datasetPickZip, tone: "pending" }
    }
    return { label: m.checklist.datasetUploadZip, tone: "pending" }
  }, [jobReady, datasetError, dataYaml, datasetZipFilename, isLocalBackend, m.checklist])`,
  ],
  ['setNameError("请填写本次训练名称")', "setNameError(m.errors.nameRequired)"],
  ['setNameError("训练名称无效")', "setNameError(m.errors.nameInvalid)"],
  ['setNameError("训练名称已被使用，请重新输入或删除同名项目")', "setNameError(m.errors.nameDuplicate)"],
  ['setNameError("请先连接后端")', "setNameError(m.errors.connectBackend)"],
  ['setDatasetError("请先创建工作区")', "setDatasetError(m.errors.createWorkspaceFirst)"],
  ['setDatasetError("远程后端请使用上传 ZIP")', "setDatasetError(m.errors.remoteZipUpload)"],
  ['setDatasetError("请先在设置中选择 backend 目录")', "setDatasetError(m.errors.pickBackendDir)"],
  ['title: "选择 YOLO 训练数据集 ZIP"', "title: m.ipc.pickDatasetZipTitle"],
  ['copy.errorMessage || "复制数据集失败"', "copy.errorMessage || m.errors.copyDatasetFailed"],
  [
    'nameError ?? (nameDuplicate ? "训练名称已被使用，请重新输入或删除同名项目" : null)',
    "nameError ?? (nameDuplicate ? m.errors.nameDuplicate : null)",
  ],
  ['aria-label="返回模型训练"', 'aria-label={m.backAria}'],
  [">YOLO 训练</h1>", ">{m.pageTitle}</h1>"],
  [
    `每次训练在 <code className="text-xs">external/temp/&lt;训练名&gt;/</code> 独立目录`,
    "{m.pageSubtitle.split('<训练名>')[0]}<code className=\"text-xs\">external/temp/&lt;训练名&gt;/</code>{m.pageSubtitle.split('<训练名>')[1] ?? ''}",
  ],
]

// Fix subtitle - better use structured message without HTML split
replacements.pop() // remove bad subtitle replacement

const subtitleOld = `              <p className="mt-1 text-sm text-muted-foreground">
                每次训练在 <code className="text-xs">external/temp/&lt;训练名&gt;/</code> 独立目录
              </p>`
const subtitleNew = `              <p className="mt-1 text-sm text-muted-foreground">
                {m.pageSubtitle.includes("<") ? (
                  <>
                    {m.pageSubtitle.split("<")[0]}
                    <code className="text-xs">external/temp/&lt;训练名&gt;/</code>
                    {m.pageSubtitle.split(">")[1]?.replace(/^[^/]*/, "") ?? ""}
                  </>
                ) : (
                  m.pageSubtitle
                )}
              </p>`

// Simpler: change messages to two parts in locale - for now use simple approach
// Update zhCN pageSubtitle to not need code - use two keys in messages later
// For now keep single string without code tag in subtitle for en, zh with code in JSX:

replacements.push([
  subtitleOld,
  `              <p className="mt-1 text-sm text-muted-foreground">
                {locale === "zh-CN" ? (
                  <>
                    每次训练在 <code className="text-xs">external/temp/&lt;训练名&gt;/</code> 独立目录
                  </>
                ) : (
                  m.pageSubtitle
                )}
              </p>`,
])

const jsxReplacements = [
  ['placeholder="输入本次训练名称…"', 'placeholder={m.trainingNamePlaceholder}'],
  ['aria-label="创建训练任务"', 'aria-label={m.createJobAria}'],
  ['>模型族</p>', '>{m.labelFamily}</p>'],
  ['>任务</p>', '>{m.labelTask}</p>'],
  ['>初始权重</p>', '>{m.labelBaseWeight}</p>'],
  ['{TASKS.map((t) => (', '{TASK_IDS.map((id) => ('],
  ['<ToggleGroupItem key={t.id} value={t.id}', '<ToggleGroupItem key={id} value={id}'],
  ['{t.label}', '{m.tasks[id]}'],
  ['">无可用模型（请先 install-resources）</option>', '">{m.noModelsOption}</option>'],
  ['>已上传：{uploadedWeightLabel}</option>', '>{m.uploadedWeightOption(uploadedWeightLabel)}</option>'],
  ['aria-label="上传权重 .pt"', 'aria-label={m.uploadWeightAria}'],
  ['>zip数据</p>', '>{m.labelZipData}</p>'],
  ['placeholder="尚未选择数据集"', 'placeholder={m.zipPlaceholder}'],
  ['aria-label="选择或上传 ZIP 数据集"', 'aria-label={m.uploadZipAria}'],
  ['<p className="text-xs font-medium text-muted-foreground">常用参数</p>', '<p className="text-xs font-medium text-muted-foreground">{m.labelCommonParams}</p>'],
  ['>训练轮数 epochs</span>', '>{m.paramEpochs}</span>'],
  ['title="留空表示不限制"', 'title={m.paramTimeHoursTitle}'],
  ['>训练时间（小时）</span>', '>{m.paramTimeHours}</span>'],
  ['placeholder="不限制"', 'placeholder={m.paramTimePlaceholder}'],
  ['>数据加载 workers</span>', '>{m.paramWorkers}</span>'],
  ['>批大小 batch</span>', '>{m.paramBatch}</span>'],
  ['>输入尺寸 imgsz</span>', '>{m.paramImgsz}</span>'],
  ['>设备</span>', '>{m.paramDevice}</span>'],
  ['title="图像增强"', 'title={m.boardAugment}'],
  ['switchOnLabel={m.switchOn}', 'switchOnLabel={m.switchOn}'],
  ['title="优化器"', 'title={m.boardOptimizer}'],
  ['\n                    训练中…\n', '\n                    {m.trainingInProgress}\n'],
  ['\n                  "开始训练"\n', '\n                  {m.startTraining}\n'],
]

// Fix duplicate 初始权重 on common params card - only replace first two occurrences in labels section
// Line 788 might still say 初始权重 - the jsx replace handles p tags

const boardAugmentBlock = `<YoloAdvancedBoard
            title="图像增强"
            enabled={augmentEnabled}
            onEnabledChange={setAugmentEnabled}
            dimmed={!jobReady}
          >`
const boardAugmentNew = `<YoloAdvancedBoard
            title={m.boardAugment}
            enabled={augmentEnabled}
            onEnabledChange={setAugmentEnabled}
            dimmed={!jobReady}
            switchOnLabel={m.switchOn}
            switchOffLabel={m.switchOff}
          >`

const boardOptBlock = `<YoloAdvancedBoard
            title="优化器"
            enabled={optimizerEnabled}
            onEnabledChange={setOptimizerEnabled}
            dimmed={!jobReady}
          >`
const boardOptNew = `<YoloAdvancedBoard
            title={m.boardOptimizer}
            enabled={optimizerEnabled}
            onEnabledChange={setOptimizerEnabled}
            dimmed={!jobReady}
            switchOnLabel={m.switchOn}
            switchOffLabel={m.switchOff}
          >`

const boolSelect = `<YoloBoolSelect
                    value={optimizerValues[field.key] ?? field.default}
                    onChange={(on) =>
                      setOptimizerValues((prev) => ({ ...prev, [field.key]: on ? 1 : 0 }))
                    }
                  />`
const boolSelectNew = `<YoloBoolSelect
                    value={optimizerValues[field.key] ?? field.default}
                    noLabel={m.boolNo}
                    yesLabel={m.boolYes}
                    onChange={(on) =>
                      setOptimizerValues((prev) => ({ ...prev, [field.key]: on ? 1 : 0 }))
                    }
                  />`

const langToggle = `          <motion.div className="flex items-center gap-3">`
// Add language toggle after opening header flex - find and insert

for (const [from, to] of [...replacements, ...jsxReplacements]) {
  if (s.includes(from)) s = s.split(from).join(to)
}

if (s.includes(boardAugmentBlock)) s = s.replace(boardAugmentBlock, boardAugmentNew)
if (s.includes(boardOptBlock)) s = s.replace(boardOptBlock, boardOptNew)
if (s.includes(boolSelect)) s = s.replace(boolSelect, boolSelectNew)

// Fix wrong second 初始权重 on common params - grep after
s = s.replace(
  `<Card className={cn("border-border/80 shadow-sm", !jobReady && "opacity-60")}>
            <CardContent className="space-y-4 pt-6">
              <p className="text-xs font-medium text-muted-foreground">初始权重</p>
              <motion.div className="grid gap-4 sm:grid-cols-2">`,
  `<Card className={cn("border-border/80 shadow-sm", !jobReady && "opacity-60")}>
            <CardContent className="space-y-4 pt-6">
              <p className="text-xs font-medium text-muted-foreground">{m.labelCommonParams}</p>
              <div className="grid gap-4 sm:grid-cols-2">`,
)

// Add language switcher in header
const headerInsert = `          <motion.div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label={m.backAria}>`
const headerWithLang = `          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label={m.backAria}>`
if (s.includes(headerInsert)) {
  s = s.replace(headerInsert, headerWithLang)
  s = s.replace(
    `            </div>
          </div>

          <Card className="border-border/80 shadow-sm">
            <CardContent className="pt-6">
              <div className="flex gap-2">
                <Input
                  className="min-w-0 flex-1"
                  value={trainingName}`,
    `            </div>
            <motion.div className="ml-auto flex shrink-0 gap-1 rounded-lg border border-border/60 p-0.5">
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
          </div>

          <Card className="border-border/80 shadow-sm">
            <CardContent className="pt-6">
              <div className="flex gap-2">
                <Input
                  className="min-w-0 flex-1"
                  value={trainingName}`,
  )
}

// Remove erroneous motion.div
s = s.replace(/<motion\.div/g, "<div").replace(/<\/motion\.motion.div>/g, "</div>")

fs.writeFileSync(filePath, s, "utf8")
const bad = (s.match(/\?{3,}/g) || []).length
const hasM = s.includes("m.checklist.backendChecking")
console.log({ bad, hasM, wrote: true })
