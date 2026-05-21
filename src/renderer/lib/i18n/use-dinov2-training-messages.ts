import { useAppLocale } from "@/components/locale-provider"
import { getDinov2TrainingMessages, type Dinov2TrainingMessages } from "@/lib/i18n/dinov2-training-messages"
import type { AppLocale } from "@/lib/i18n/types"
import { useMemo } from "react"

export function useDinov2TrainingMessages(): {
  m: Dinov2TrainingMessages
  locale: AppLocale
} {
  const { locale } = useAppLocale()
  const m = useMemo(() => getDinov2TrainingMessages(locale), [locale])
  return { m, locale }
}
