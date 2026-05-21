/**
 * 扩散式标注：候选框与后处理方案（配置页持久化，任务页读取）。
 */
import {
  DIFFUSION_CANDIDATE_BOX_STRATEGIES,
  DIFFUSION_REFINE_POST_STRATEGIES,
  type DiffusionCandidateBoxStrategy,
  type DiffusionRefinePostStrategy,
} from "@/lib/diffusion-pipeline-strategies"

const STORAGE_KEY_BOX = "ea-diffusion-candidate-box-strategy"
const STORAGE_KEY_POST = "ea-diffusion-refine-post-strategy"
const CHANGE_EVENT = "ea-diffusion-pipeline-prefs-change"

const DEFAULT_BOX: DiffusionCandidateBoxStrategy = "peak_score_extent"
const DEFAULT_POST: DiffusionRefinePostStrategy = "center_point_dino_mask_iou"

function isBoxStrategy(v: string): v is DiffusionCandidateBoxStrategy {
  return (DIFFUSION_CANDIDATE_BOX_STRATEGIES as readonly string[]).includes(v)
}

function isPostStrategy(v: string): v is DiffusionRefinePostStrategy {
  return (DIFFUSION_REFINE_POST_STRATEGIES as readonly string[]).includes(v)
}

function readBoxStrategy(): DiffusionCandidateBoxStrategy {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BOX)?.trim()
    if (raw === "peak_adaptive") {
      return DEFAULT_BOX
    }
    if (raw && isBoxStrategy(raw)) return raw
  } catch {
    // ignore
  }
  return DEFAULT_BOX
}

function readPostStrategy(): DiffusionRefinePostStrategy {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POST)?.trim()
    if (raw && isPostStrategy(raw)) return raw
  } catch {
    // ignore
  }
  return DEFAULT_POST
}

export const diffusionPipelinePrefs = {
  getCandidateBoxStrategy(): DiffusionCandidateBoxStrategy {
    return readBoxStrategy()
  },
  setCandidateBoxStrategy(strategy: DiffusionCandidateBoxStrategy): void {
    try {
      localStorage.setItem(STORAGE_KEY_BOX, strategy)
      window.dispatchEvent(new Event(CHANGE_EVENT))
    } catch {
      // ignore
    }
  },
  getRefinePostStrategy(): DiffusionRefinePostStrategy {
    return readPostStrategy()
  },
  setRefinePostStrategy(strategy: DiffusionRefinePostStrategy): void {
    try {
      localStorage.setItem(STORAGE_KEY_POST, strategy)
      window.dispatchEvent(new Event(CHANGE_EVENT))
    } catch {
      // ignore
    }
  },
  subscribe(onChange: () => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_BOX || e.key === STORAGE_KEY_POST || e.key === null) onChange()
    }
    const onLocal = () => onChange()
    window.addEventListener("storage", onStorage)
    window.addEventListener(CHANGE_EVENT, onLocal)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(CHANGE_EVENT, onLocal)
    }
  },
}
