/**
 * components/profile-provider.tsx — Setup wizard state
 *
 * One AsyncStorage document (`indorse.profile.v1`) holds the operator's
 * display profile (name / bio / photo chosen in `app/setup.tsx` step 1) and
 * the deferred-step flags ("Skip for now") that let the Profile banner count
 * a skipped step as handled.
 *
 * `ready` is false only while the stored document is being read, so screens
 * can avoid flashing an incomplete banner for an operator who already set up.
 * The default context (no provider — every test renders without one) reports
 * `ready: true, profile: null`: a guest who has not set up anything.
 *
 * Writes are fire-and-forget like SettingsProvider: the in-memory state is
 * the source of truth for the session, persistence is best-effort.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { DeferredFlags, OperatorProfile, ProfileInput } from '@/features/profile/types'

const STORE_KEY = 'indorse.profile.v1'

const NO_DEFERRALS: DeferredFlags = { wallet: false, farm: false, access: false, lock: false }

interface ProfileDoc {
  profile: OperatorProfile | null
  deferred: DeferredFlags
}

const EMPTY_DOC: ProfileDoc = { profile: null, deferred: NO_DEFERRALS }

interface ProfileValue {
  /** False until the stored document has been read (default context: true). */
  ready: boolean
  profile: OperatorProfile | null
  deferred: DeferredFlags
  /** Validate + persist the step-1 profile (name is trimmed by the caller's validator). */
  saveProfile: (input: ProfileInput) => void
  /** Persist a "Skip for now" choice from wizard steps 2–5. */
  deferStep: (key: keyof DeferredFlags) => void
  /** Erase the stored profile + deferrals — part of "delete local account data". */
  clearProfile: () => void
}

const ProfileContext = createContext<ProfileValue>({
  ready: true,
  profile: null,
  deferred: NO_DEFERRALS,
  saveProfile: () => undefined,
  deferStep: () => undefined,
  clearProfile: () => undefined,
})

/** Defensive parse — a corrupt document falls back to the empty one. */
function parseDoc(raw: string | null): ProfileDoc {
  if (!raw) return EMPTY_DOC
  try {
    const parsed = JSON.parse(raw) as Partial<ProfileDoc>
    const profile =
      parsed.profile && typeof parsed.profile.name === 'string'
        ? {
            name: parsed.profile.name,
            bio: typeof parsed.profile.bio === 'string' ? parsed.profile.bio : '',
            photoUri: typeof parsed.profile.photoUri === 'string' ? parsed.profile.photoUri : null,
            savedAt: typeof parsed.profile.savedAt === 'number' ? parsed.profile.savedAt : 0,
          }
        : null
    return {
      profile,
      deferred: { ...NO_DEFERRALS, ...(parsed.deferred ?? {}) },
    }
  } catch {
    return EMPTY_DOC
  }
}

export function ProfileProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false)
  const [doc, setDoc] = useState<ProfileDoc>(EMPTY_DOC)
  // Mirror of `doc` updated synchronously in commit(), so rapid successive
  // writes (save then defer) never read a stale snapshot.
  const docRef = useRef<ProfileDoc>(EMPTY_DOC)

  useEffect(() => {
    let live = true
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        // A save/defer that beat the read owns the doc — never clobber it.
        if (!live || docRef.current !== EMPTY_DOC) return
        const loaded = parseDoc(raw)
        docRef.current = loaded
        setDoc(loaded)
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setReady(true)
      })
    return () => {
      live = false
    }
  }, [])

  const commit = useCallback((next: ProfileDoc) => {
    docRef.current = next
    setDoc(next)
    void AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => undefined)
  }, [])

  const saveProfile = useCallback(
    (input: ProfileInput) => {
      commit({
        profile: { name: input.name.trim(), bio: input.bio.trim(), photoUri: input.photoUri, savedAt: Date.now() },
        deferred: docRef.current.deferred,
      })
    },
    [commit],
  )

  const deferStep = useCallback(
    (key: keyof DeferredFlags) => {
      if (docRef.current.deferred[key]) return
      commit({ ...docRef.current, deferred: { ...docRef.current.deferred, [key]: true } })
    },
    [commit],
  )

  // Back to the empty document — persisted immediately by commit().
  const clearProfile = useCallback(() => commit(EMPTY_DOC), [commit])

  const value = useMemo<ProfileValue>(
    () => ({ ready, profile: doc.profile, deferred: doc.deferred, saveProfile, deferStep, clearProfile }),
    [ready, doc, saveProfile, deferStep, clearProfile],
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile(): ProfileValue {
  return useContext(ProfileContext)
}
