import { useCallback, useEffect } from "react"
import { getImageFileInfo, readImageAnnotation, writeImageAnnotation } from "@/lib/projects-api"
import { type XAnyLabelFile, normalizeXAnyLabelDoc } from "@/lib/xanylabeling-format"
import type { ShapeDragAction } from "@/pages/project-task-detail/types"
import type { AnnotationDocRef, ImageFileInfo, ImageSize } from "@/pages/project-task-detail/hook-shared"
import { normalizeDocPointsToInt } from "@/pages/project-task-detail/utils"

type UseTaskDataSyncParams = {
  activeImagePath: string
  imageNaturalSize: ImageSize
  annotationDoc: XAnyLabelFile | null
  shapeDragAction: ShapeDragAction | null
  annotationDocRef: AnnotationDocRef
  setAnnotationDoc: (value: XAnyLabelFile | null | ((prev: XAnyLabelFile | null) => XAnyLabelFile | null)) => void
  setPanelDoc: (value: XAnyLabelFile | null) => void
  setImageFileInfo: (value: ImageFileInfo) => void
}

export function useTaskDataSync(params: UseTaskDataSyncParams) {
  const {
    activeImagePath,
    imageNaturalSize,
    annotationDoc,
    shapeDragAction,
    annotationDocRef,
    setAnnotationDoc,
    setPanelDoc,
    setImageFileInfo,
  } = params

  useEffect(() => {
    let alive = true
    if (!activeImagePath || imageNaturalSize.width <= 0 || imageNaturalSize.height <= 0) return
    void readImageAnnotation(activeImagePath).then((result) => {
      if (!alive) return
      if (result.errorMessage) return
      const doc = normalizeXAnyLabelDoc({
        imagePath: activeImagePath,
        imageWidth: imageNaturalSize.width,
        imageHeight: imageNaturalSize.height,
        rawJsonText: result.exists ? result.jsonText : "",
      })
      setAnnotationDoc(normalizeDocPointsToInt(doc))
    })
    return () => {
      alive = false
    }
  }, [activeImagePath, imageNaturalSize.height, imageNaturalSize.width, setAnnotationDoc])

  useEffect(() => {
    annotationDocRef.current = annotationDoc
  }, [annotationDoc, annotationDocRef])

  useEffect(() => {
    if (!shapeDragAction) setPanelDoc(annotationDoc)
  }, [annotationDoc, setPanelDoc, shapeDragAction])

  useEffect(() => {
    let alive = true
    if (!activeImagePath) {
      setImageFileInfo({ exists: false, sizeBytes: 0, format: "", channelCount: 0, extension: "", errorMessage: "" })
      return
    }
    void getImageFileInfo(activeImagePath).then((result) => {
      if (!alive) return
      setImageFileInfo(result)
    })
    return () => {
      alive = false
    }
  }, [activeImagePath, setImageFileInfo])

  const persistAnnotation = useCallback(
    (nextDoc: XAnyLabelFile) => {
      if (!activeImagePath) return
      const normalized = normalizeDocPointsToInt(nextDoc)
      void writeImageAnnotation({
        imagePath: activeImagePath,
        jsonText: JSON.stringify(normalized, null, 2),
      })
    },
    [activeImagePath],
  )

  return { persistAnnotation }
}
