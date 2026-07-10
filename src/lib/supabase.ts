import { createClient } from '@supabase/supabase-js'

// Reads from Vite env vars. Only the public URL + anon key belong here.
// Never place service-role or ANTHROPIC/OPENAI keys in client code.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  // Non-fatal during T0 scaffolding; Supabase wiring lands in later tasks.
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set. ' +
      'Copy .env.example to .env and fill them in.',
  )
}

// Use sessionStorage (per-tab) rather than the default localStorage so that:
//  - a REFRESH in the same tab keeps the same anonymous uid (session persists);
//  - a NEW TAB starts with no session and therefore gets a separate uid.
// localStorage would be shared across tabs, causing new tabs to reuse the uid.
const authStorage =
  typeof window !== 'undefined' ? window.sessionStorage : undefined

export const supabase = createClient(
  supabaseUrl ?? 'http://localhost:54321',
  supabaseAnonKey ?? 'public-anon-key-placeholder',
  {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
)
