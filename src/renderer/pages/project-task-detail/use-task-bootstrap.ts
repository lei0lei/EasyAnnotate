/**
 * 模块：project-task-detail/use-task-bootstrap
 * 职责：处理页面初始化与切图加载（文件拉取、图片加载、临时态重置）。
 * 边界：负责首屏与切换流程，不负责绘制交互细节。
 */
import { useCallback, useEffect, useRef } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { getProject, listTaskFiles, readImageFile, type ProjectItem, type TaskFileItem } from "@/lib/projects-api"
import { guessMimeType } from "@/pages/project-task-detail/utils"

type ToolResetAction = { type: "clearRectPoints" } | { type: "resetForNewFile" }

type UseTaskBootstrapParams = {
  projectId?: string
  taskId?: string
  files: TaskFileItem[]
  imagePathCandidates: string[]
  currentFilePath: string
  stageRef: MutableRefObject<HTMLDivElement | null>
  panStartRef: MutableRefObject<{ x: number; y: number; originX: number; originY: number } | null>
  clearToolTransientInteractions: () => void
  dispatchTool: (action: ToolResetAction) => void
  setProject: Dispatch<SetStateAction<ProjectItem | undefined>>
  setError: Dispatch<SetStateAction<string | null>>
  setFiles: Dispatch<SetStateAction<TaskFileItem[]>>
  setCurrentIndex: Dispatch<SetStateAction<number>>
  setImageObjectUrl: Dispatch<SetStateAction<string>>
  setActiveImagePath: Dispatch<SetStateAction<string>>
  setIsImageLoading: Dispatch<SetStateAction<boolean>>
  setImageLoadError: Dispatch<SetStateAction<boolean>>
  setImageScale: Dispatch<SetStateAction<number>>
  setImageOffset: Dispatch<SetStateAction<{ x: number; y: number }>>
  setIsPanning: Dispatch<SetStateAction<boolean>>
  setImageNaturalSize: Dispatch<SetStateAction<{ width: number; height: number }>>
  setSelectedShapeIndex: Dispatch<SetStateAction<number | null>>
  resetDocForNewFile: () => void
  setHiddenShapeIndexes: Dispatch<SetStateAction<number[]>>
  setHiddenClassLabels: Dispatch<SetStateAction<string[]>>
  setLabelsTab: Dispatch<SetStateAction<"layers" | "classes">>
  setStageSize: Dispatch<SetStateAction<{ width: number; height: number }>>
}

export function useTaskBootstrap(params: UseTaskBootstrapParams) {
  const {
    projectId,
    taskId,
    files,
    imagePathCandidates,
    currentFilePath,
    stageRef,
    panStartRef,
    clearToolTransientInteractions,
    dispatchTool,
    setProject,
    setError,
    setFiles,
    setCurrentIndex,
    setImageObjectUrl,
    setActiveImagePath,
    setIsImageLoading,
    setImageLoadError,
    setImageScale,
    setImageOffset,
    setIsPanning,
    setImageNaturalSize,
    setSelectedShapeIndex,
    resetDocForNewFile,
    setHiddenShapeIndexes,
    setHiddenClassLabels,
    setLabelsTab,
    setStageSize,
  } = params
  const dispatchToolRef = useRef(dispatchTool)
  const resetDocForNewFileRef = useRef(resetDocForNewFile)
  const clearToolTransientInteractionsRef = useRef(clearToolTransientInteractions)
  const lastResetFilePathRef = useRef<string | null>(null)

  useEffect(() => {
    dispatchToolRef.current = dispatchTool
  }, [dispatchTool])

  useEffect(() => {
    resetDocForNewFileRef.current = resetDocForNewFile
  }, [resetDocForNewFile])

  useEffect(() => {
    clearToolTransientInteractionsRef.current = clearToolTransientInteractions
  }, [clearToolTransientInteractions])

  const reloadTaskFiles = useCallback(async () => {
    if (!projectId || !taskId) return
    const result = await listTaskFiles({ projectId, taskId })
    if (result.errorMessage) {
      setError(result.errorMessage)
      setFiles([])
      return
    }
    setError(null)
    setFiles(result.files)
  }, [projectId, taskId, setError, setFiles])

  useEffect(() => {
    let alive = true
    if (!projectId) return
    void getProject(projectId).then((item) => {
      if (!alive) return
      setProject(item)
    })
    return () => {
      alive = false
    }
  }, [projectId, setProject])

  useEffect(() => {
    let alive = true
    if (!projectId || !taskId) return
    void listTaskFiles({ projectId, taskId }).then((result) => {
      if (!alive) return
      if (result.errorMessage) {
        setError(result.errorMessage)
        setFiles([])
        return
      }
      setError(null)
      setFiles(result.files)
    })
    return () => {
      alive = false
    }
  }, [projectId, taskId, setError, setFiles])

  useEffect(() => {
    setCurrentIndex((index) => {
      if (files.length === 0) return 0
      return Math.min(index, files.length - 1)
    })
  }, [files, setCurrentIndex])

  useEffect(() => {
    let alive = true
    let objectUrl = ""

    const loadImage = async () => {
      if (imagePathCandidates.length === 0) {
        setImageObjectUrl("")
        setActiveImagePath("")
        setImageLoadError(true)
        return
      }
      setIsImageLoading(true)
      setImageLoadError(false)
      setImageObjectUrl("")

      for (const candidate of imagePathCandidates) {
        const result = await readImageFile(candidate)
        if (!alive) return
        if (result.errorMessage || !result.content || result.content.length === 0) continue
        const bytes = result.content
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: guessMimeType(candidate) }))
        setImageObjectUrl(objectUrl)
        setActiveImagePath(candidate)
        setIsImageLoading(false)
        return
      }

      setIsImageLoading(false)
      setImageLoadError(true)
      setActiveImagePath("")
    }

    void loadImage()

    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imagePathCandidates, setActiveImagePath, setImageLoadError, setImageObjectUrl, setIsImageLoading])

  useEffect(() => {
    if (lastResetFilePathRef.current === currentFilePath) return
    lastResetFilePathRef.current = currentFilePath
    setImageScale(1)
    setImageOffset({ x: 0, y: 0 })
    setIsPanning(false)
    panStartRef.current = null
    setImageNaturalSize({ width: 0, height: 0 })
    dispatchToolRef.current({ type: "clearRectPoints" })
    setSelectedShapeIndex(null)
    dispatchToolRef.current({ type: "resetForNewFile" })
    resetDocForNewFileRef.current()
    clearToolTransientInteractionsRef.current()
    setHiddenShapeIndexes([])
    setHiddenClassLabels([])
    setLabelsTab("layers")
  }, [currentFilePath, panStartRef, setHiddenClassLabels, setHiddenShapeIndexes, setImageNaturalSize, setImageOffset, setImageScale, setIsPanning, setLabelsTab, setSelectedShapeIndex])

  useEffect(() => {
    let observer: ResizeObserver | null = null
    let rafId = 0
    let disposed = false

    const update = () => {
      const target = stageRef.current
      if (!target) return
      const rect = target.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }

    const attachObserver = () => {
      if (disposed) return
      const target = stageRef.current
      if (!target) {
        rafId = window.requestAnimationFrame(attachObserver)
        return
      }
      update()
      observer = new ResizeObserver(update)
      observer.observe(target)
      window.addEventListener("resize", update)
    }

    attachObserver()

    return () => {
      disposed = true
      if (rafId) window.cancelAnimationFrame(rafId)
      observer?.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [setStageSize, stageRef, currentFilePath])

  return { reloadTaskFiles }
}
