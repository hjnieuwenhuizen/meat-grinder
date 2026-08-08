import { useState } from 'react'
import { signIn } from '../lib/firebase'

export default function SignIn() {
  const [error, setError] = useState(null)

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="mb-10 text-center">
        <div className="mb-3 inline-flex size-16 items-center justify-center rounded-2xl bg-grind-soft text-3xl">🥩</div>
        <h1 className="text-4xl font-bold uppercase leading-none tracking-tight">
          Meat<span className="text-grind">Grinder</span>
        </h1>
        <p className="mt-3 text-sm text-mist">Grind your macros. Hit your numbers.</p>
      </div>

      <button
        onClick={() => signIn().catch((e) => setError(e.message))}
        className="flex items-center gap-3 rounded-full bg-grind px-6 py-3 font-semibold text-ink transition hover:brightness-110"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M21.35 11.1H12v3.7h5.4c-.5 2.4-2.6 3.7-5.4 3.7a5.9 5.9 0 1 1 0-11.8c1.5 0 2.9.55 3.9 1.5l2.8-2.8A9.9 9.9 0 1 0 12 22c5.7 0 9.5-4 9.5-9.7 0-.4 0-.8-.15-1.2Z" />
        </svg>
        Continue with Google
      </button>

      {error && (
        <p className="mt-6 max-w-sm text-center text-sm text-over">
          {error.includes('operation-not-allowed')
            ? 'Google sign-in is not enabled yet. Enable it in Firebase Console → Authentication → Sign-in method.'
            : error}
        </p>
      )}
    </div>
  )
}
