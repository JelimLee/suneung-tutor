import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type AnonAuthState = {
  /** True until we've resolved (found or created) a session, or hit an error. */
  loading: boolean
  /** The signed-in user, or null while loading / on error. */
  user: User | null
  /**
   * Human-readable error. Notably set when the project has Anonymous sign-ins
   * DISABLED, in which case the user must enable them in the Supabase dashboard.
   */
  error: string | null
  /** True specifically when anonymous sign-ins are disabled for the project. */
  anonDisabled: boolean
}

// Supabase returns this message (or error code 'anonymous_provider_disabled')
// when the Anonymous sign-ins auth setting is turned off for the project.
function isAnonDisabled(err: {
  message?: string
  code?: string
} | null): boolean {
  if (!err) return false
  if (err.code === 'anonymous_provider_disabled') return true
  return /anonymous sign-ins are disabled/i.test(err.message ?? '')
}

/**
 * Ensures the app has an anonymous session on boot.
 *  - Reuses an existing session (same tab after refresh) if present.
 *  - Otherwise calls signInAnonymously() to mint a fresh per-tab uid.
 * Session persistence uses sessionStorage (see lib/supabase.ts), so new tabs
 * get their own uid while refreshes keep it.
 */
export function useAnonAuth(): AnonAuthState {
  const [state, setState] = useState<AnonAuthState>({
    loading: true,
    user: null,
    error: null,
    anonDisabled: false,
  })

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      // 1. Reuse an existing session if this tab already has one.
      const { data: sessionData } = await supabase.auth.getSession()
      if (cancelled) return

      if (sessionData.session?.user) {
        setState({
          loading: false,
          user: sessionData.session.user,
          error: null,
          anonDisabled: false,
        })
        return
      }

      // 2. No session — create an anonymous one.
      const { data, error } = await supabase.auth.signInAnonymously()
      if (cancelled) return

      if (error) {
        setState({
          loading: false,
          user: null,
          error: error.message,
          anonDisabled: isAnonDisabled(error),
        })
        return
      }

      setState({
        loading: false,
        user: data.user,
        error: null,
        anonDisabled: false,
      })
    }

    void bootstrap()

    // Keep the user in sync if the token refreshes or session changes.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      if (session?.user) {
        setState((prev) => ({ ...prev, user: session.user, loading: false }))
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return state
}
