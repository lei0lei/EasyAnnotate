import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ipc } from "@/gen/ipc"
import {
  checkOnnx2TensorRtTool,
  copyOnnxToTensorRtOutputDir,
  startTensorRtConversion,
  waitTensorRtConversionJob,
} from "@/lib/tensorrt-conversion-api"
import { cn } from "@/lib/utils"
import { ArrowLeft, FolderOpen, Loader2, Upload } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

export default function ModelsTrainingTensorRtPage() {
  const [outputDir, setOutputDir] = useState("")
  const [selectingOutputDir, setSelectingOutputDir] = useState(false)
  const [onnxFileName, setOnnxFileName] = useState("")
  const [onnxBusy, setOnnxBusy] = useState(false)
  const [onnxError, setOnnxError] = useState<string | null>(null)

  const [toolReady, setToolReady] = useState<boolean | null>(null)
  const [toolExePath, setToolExePath] = useState("")

  const [converting, setConverting] = useState(false)
  const [convertMessage, setConvertMessage] = useState("")
  const [convertError, setConvertError] = useState<string | null>(null)
  const [enginePath, setEnginePath] = useState<string | null>(null)
  const [convertLogPath, setConvertLogPath] = useState<string | null>(null)
  const [convertStartedAt, setConvertStartedAt] = useState<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)

  const refreshToolStatus = useCallback(() => {
    void checkOnnx2TensorRtTool()
      .then((checked) => {
        setToolReady(checked.exeExists)
        setToolExePath(checked.exePath)
      })
      .catch(() => {
        setToolReady(false)
        setToolExePath("")
      })
  }, [])

  useEffect(() => {
    refreshToolStatus()
  }, [refreshToolStatus])

  useEffect(() => {
    if (!converting || convertStartedAt === null) return
    const tick = () => setElapsedSec(Math.floor((Date.now() - convertStartedAt) / 1000))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [converting, convertStartedAt])

  const canStartConversion = useMemo(
    () => Boolean(toolReady && outputDir.trim() && onnxFileName.trim()),
    [toolReady, outputDir, onnxFileName],
  )

  const handleSelectOutputDir = useCallback(async () => {
    setSelectingOutputDir(true)
    try {
      const result = await ipc.app.SelectDirectory({
        title: "TensorRT 模型保存路径",
        defaultPath: outputDir,
      })
      if (result.errorMessage) {
        window.alert(`无法打开目录选择窗口：${result.errorMessage}`)
        return
      }
      if (!result.canceled && result.path?.trim()) {
        setOutputDir(result.path.trim())
        setOnnxFileName("")
        setOnnxError(null)
        setEnginePath(null)
        setConvertError(null)
        setConvertMessage("")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`无法打开目录选择窗口：${message}`)
    } finally {
      setSelectingOutputDir(false)
    }
  }, [outputDir])

  const handleUploadOnnx = useCallback(async () => {
    if (!outputDir.trim()) {
      setOnnxError("请先选择 TensorRT 模型保存路径")
      return
    }
    setOnnxBusy(true)
    setOnnxError(null)
    setEnginePath(null)
    setConvertError(null)
    setConvertMessage("")
    try {
      const picked = await ipc.app.SelectFiles({
        title: "选择 ONNX 文件",
        defaultPath: "",
      })
      if (picked.canceled || !picked.paths[0]) return
      const sourcePath = picked.paths[0]
      const copied = await copyOnnxToTensorRtOutputDir(sourcePath, outputDir.trim())
      setOnnxFileName(copied.fileName)
    } catch (error) {
      setOnnxFileName("")
      setOnnxError(error instanceof Error ? error.message : String(error))
    } finally {
      setOnnxBusy(false)
    }
  }, [outputDir])

  const handleStartConversion = useCallback(async () => {
    if (!canStartConversion) return
    setConverting(true)
    setConvertError(null)
    setConvertMessage("正在启动转换…")
    setEnginePath(null)
    setConvertLogPath(null)
    setConvertStartedAt(Date.now())
    setElapsedSec(0)
    try {
      const jobId = await startTensorRtConversion(outputDir.trim(), onnxFileName.trim())
      const job = await waitTensorRtConversionJob(jobId, {
        pollMs: 2000,
        onUpdate: (next) => {
          setConvertMessage(next.message || "正在转换，请稍候…")
          if (next.logPath) {
            setConvertLogPath(next.logPath)
          }
          if (next.startedAt) {
            const parsed = Date.parse(next.startedAt)
            if (Number.isFinite(parsed)) {
              setConvertStartedAt(parsed)
            }
          }
        },
      })
      setConvertMessage(job.message || "转换完成")
      setEnginePath(job.enginePath || null)
      setConvertLogPath(job.logPath || null)
    } catch (error) {
      setConvertError(error instanceof Error ? error.message : String(error))
    } finally {
      setConverting(false)
    }
  }, [canStartConversion, onnxFileName, outputDir])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回模型训练">
          <Link to="/models/training">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">TensorRT 模型转换</h1>
          <p className="mt-1 text-sm text-muted-foreground">将 ONNX 模型转换为 TensorRT engine 文件</p>
        </div>
      </div>

      <Card className={cn("border-border/80 shadow-sm", toolReady === false && "border-destructive/40")}>
        <CardContent className="flex flex-wrap items-center gap-2 py-4 text-sm">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              toolReady === null ? "bg-muted-foreground/50" : toolReady ? "bg-emerald-500" : "bg-red-500",
            )}
          />
          {toolReady === null
            ? "正在检测 onnx2tensorRT 工具…"
            : toolReady
              ? `工具已就绪：${toolExePath}`
              : "未找到 onnx2TensorRT.exe，请先在设置中配置 onnx2tensorRT 路径"}
          <Button type="button" variant="outline" size="sm" className="ml-auto" asChild>
            <Link to="/settings">设置</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardContent className="space-y-3 pt-6">
          <p className="text-xs font-medium text-muted-foreground">TensorRT 模型保存路径</p>
          <div className="flex gap-2">
            <Input
              readOnly
              className="h-9 min-w-0 flex-1 bg-muted/30 font-mono text-xs"
              value={outputDir}
              placeholder="请选择保存目录"
            />
            <Button
              type="button"
              variant="outline"
              className="h-9 shrink-0 gap-1.5"
              disabled={selectingOutputDir}
              onClick={() => void handleSelectOutputDir()}
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
              {selectingOutputDir ? "选择中..." : "选择目录"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className={cn("border-border/80 shadow-sm", !outputDir.trim() && "opacity-60")}>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">ONNX 文件</p>
            <span className="text-[11px] text-muted-foreground">上传后将复制到保存路径</span>
          </div>
          <div className="flex gap-2">
            <Input
              readOnly
              className="h-9 min-w-0 flex-1 bg-muted/30"
              value={onnxFileName}
              placeholder="请选择 .onnx 文件"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="上传 ONNX 文件"
              disabled={!outputDir.trim() || onnxBusy}
              onClick={() => void handleUploadOnnx()}
            >
              {onnxBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            </Button>
          </div>
          {onnxError ? <p className="text-sm text-destructive">{onnxError}</p> : null}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <Button
            type="button"
            className="w-full"
            disabled={!canStartConversion || converting}
            onClick={() => void handleStartConversion()}
          >
            {converting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                转换中…
              </>
            ) : (
              "开始转换"
            )}
          </Button>
          {!toolReady ? (
            <p className="text-xs text-muted-foreground">请先在设置中配置有效的 onnx2tensorRT 路径。</p>
          ) : null}
          {!outputDir.trim() ? (
            <p className="text-xs text-muted-foreground">请选择 TensorRT 模型保存路径。</p>
          ) : null}
          {outputDir.trim() && !onnxFileName.trim() ? (
            <p className="text-xs text-muted-foreground">请上传 ONNX 文件。</p>
          ) : null}
          {converting ? (
            <p className="text-xs text-muted-foreground">
              转换进行中，已耗时 {elapsedSec}s。后台子进程运行中，日志写入保存路径下的 .log 文件，通常需要数分钟，请保持应用窗口打开。
            </p>
          ) : null}
          {convertMessage ? <p className="text-sm text-foreground">{convertMessage}</p> : null}
          {convertError ? (
            <pre className="whitespace-pre-wrap break-words text-sm text-destructive">{convertError}</pre>
          ) : null}
          {enginePath ? (
            <p className="break-all font-mono text-xs text-muted-foreground">输出文件：{enginePath}</p>
          ) : null}
          {convertLogPath ? (
            <p className="break-all font-mono text-xs text-muted-foreground">转换日志：{convertLogPath}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
