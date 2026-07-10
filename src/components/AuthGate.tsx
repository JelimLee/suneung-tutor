import type { ReactNode } from 'react'
import { useAnonAuth } from '../lib/useAnonAuth'

/**
 * Wraps the app behind an anonymous auth session.
 *  - While the session is resolving: minimal loading screen.
 *  - If anonymous sign-ins are disabled (or another auth error): a clear
 *    on-screen instruction instead of silently failing.
 *  - Once signed in: renders children, plus an unobtrusive uid footer so the
 *    new-tab-vs-refresh behavior can be visually confirmed during testing.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading, user, error, anonDisabled } = useAnonAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-sm text-ink-muted">세션을 준비하는 중…</p>
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream px-6">
        <div className="max-w-md rounded-2xl border border-cream-200 bg-white/70 p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-ink">
            로그인을 시작할 수 없어요
          </h1>
          {anonDisabled ? (
            <p className="mt-3 text-sm text-ink-muted">
              Supabase 프로젝트에서 <b>Anonymous sign-ins</b>가 꺼져 있습니다.
              대시보드의 Authentication → Providers → Anonymous sign-ins를 켠 뒤
              새로고침하세요.
            </p>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              인증 중 오류가 발생했습니다: {error}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {children}
      <footer className="pointer-events-none fixed bottom-2 right-3 z-50 select-none text-[11px] text-ink-muted/70">
        uid: {user.id.slice(0, 8)}
      </footer>
    </>
  )
}
