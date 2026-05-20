import { getAppLocale, setAppLocale } from "@/lib/i18n/locale"
import type { AppLocale } from "@/lib/i18n/types"
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

type LocaleContextValue = {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => getAppLocale())

  const setLocale = useCallback((next: AppLocale) => {
    setAppLocale(next)
    setLocaleState(next)
  }, [])

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useAppLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error("useAppLocale must be used within LocaleProvider")
  }
  return ctx
}
