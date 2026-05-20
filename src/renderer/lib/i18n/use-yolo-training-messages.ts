import { useAppLocale } from "@/components/locale-provider"
import { getYoloTrainingMessages, type YoloTrainingMessages } from "@/lib/i18n/yolo-training-messages"
import type { AppLocale } from "@/lib/i18n/types"
import { useMemo } from "react"

export function useYoloTrainingMessages(): {
  m: YoloTrainingMessages
  locale: AppLocale
} {
  const { locale } = useAppLocale()
  const m = useMemo(() => getYoloTrainingMessages(locale), [locale])
  return { m, locale }
}
