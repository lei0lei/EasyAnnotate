import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, type AppLocale } from "@/lib/i18n/types"

export function getAppLocale(): AppLocale {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY)
    return v === "en" ? "en" : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

export function setAppLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
}
