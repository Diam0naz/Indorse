/**
 * lib/i18n.tsx — Tiny runtime translation layer
 *
 * `t('settings.export')` returns the active language's string, with optional
 * `{param}` interpolation. English is the fallback, and the translators are
 * typed against `MessageKey`, so TypeScript reports any key that has not been
 * translated yet.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { en, type MessageKey } from './translations/en'
import { es } from './translations/es'
import { fr } from './translations/fr'

export type Lang = 'en' | 'es' | 'fr'
export type { MessageKey }

export const LANGUAGES: { code: Lang; native: string; label: string }[] = [
  { code: 'en', native: 'English', label: 'English' },
  { code: 'es', native: 'Español', label: 'Spanish' },
  { code: 'fr', native: 'Français', label: 'French' },
]

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, es, fr }
const STORAGE_KEY = 'indorse.language'

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

interface LanguageValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Translate
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

const translateIn =
  (lang: Lang): Translate =>
  (key, params) =>
    interpolate(DICTS[lang][key] ?? en[key], params)

const LanguageContext = createContext<LanguageValue>({
  lang: 'en',
  setLang: () => undefined,
  t: translateIn('en'),
})

export function LanguageProvider({ children }: PropsWithChildren) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && (stored === 'en' || stored === 'es' || stored === 'fr')) setLangState(stored)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined)
  }, [])

  const value = useMemo<LanguageValue>(() => ({ lang, setLang, t: translateIn(lang) }), [lang, setLang])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useI18n(): LanguageValue {
  return useContext(LanguageContext)
}

/** Shorthand for the common case: `const t = useT()`. */
export function useT(): Translate {
  return useContext(LanguageContext).t
}
