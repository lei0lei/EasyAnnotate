import { useCallback, useEffect } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { getProject, listTaskFiles, readImageFile, type ProjectItem, type TaskFileItem } from "@/lib/projects-api"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
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
  setAnnotationDoc: Dispatch<SetStateAction<XAnyLabelFile | null>>
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
    setAnnotationDoc,
    setHiddenShapeIndexes,
    setHiddenClassLabels,
    setLabelsTab,
    setStageSize,
  } = params

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
    setImageScale(1)
    setImageOffset({ x: 0, y: 0 })
    setIsPanning(false)
    panStartRef.current = null
    setImageNaturalSize({ width: 0, height: 0 })
    dispatchTool({ type: "clearRectPoints" })
    setSelectedShapeIndex(null)
    dispatchTool({ type: "resetForNewFile" })
    setAnnotationDoc(null)
    clearToolTransientInteractions()
    setHiddenShapeIndexes([])
    setHiddenClassLabels([])
    setLabelsTab("layers")
  }, [clearToolTransientInteractions, currentFilePath, dispatchTool, panStartRef, setAnnotationDoc, setHiddenClassLabels, setHiddenShapeIndexes, setImageNaturalSize, setImageOffset, setImageScale, setIsPanning, setLabelsTab, setSelectedShapeIndex])

  useEffect(() => {
    const target = stageRef.current
    if (!target) return
    const update = () => {
      const rect = target.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(target)
    return () => observer.disconnect()
  }, [setStageSize, stageRef])

  return { reloadTaskFiles }
}
