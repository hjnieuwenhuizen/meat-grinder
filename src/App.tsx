import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth, logOut } from './lib/firebase'
import { useSettings, useFoods } from './hooks/useData'
import { useFamily, useScoreBackfill } from './hooks/useFamily'
import { kickSync } from './hooks/useSync'
import SignIn from './components/SignIn'
import Today from './components/Today'
import Reports from './components/Reports'
import Foods from './components/Foods'
import Goals from './components/Goals'
import Compete from './components/Compete'
import GoalWizard from './components/GoalWizard'

const TABS = ['Diary', 'Compete', 'Reports', 'Library', 'Settings'] as const
type Tab = (typeof TABS)[number]

// hash routing (#diary, #reports, …) so refresh and back/forward keep the tab
const tabFromHash = (): Tab =>
  TABS.find((t) => t.toLowerCase() === location.hash.replace('#', '').toLowerCase()) ?? 'Diary'

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [tab, setTabState] = useState<Tab>(tabFromHash)

  useEffect(() => onAuthStateChanged(auth, setUser), [])

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setTab = (t: Tab) => {
    location.hash = t.toLowerCase()
  }

  if (user === undefined) return null
  if (!user) return <SignIn />

  return <Shell user={user} tab={tab} setTab={setTab} />
}

function Shell({ user, tab, setTab }: { user: User; tab: Tab; setTab: (t: Tab) => void }) {
  const { settings, save, isNew } = useSettings(user.uid)
  const [wizardDismissed, setWizardDismissed] = useState(false)
  const foodsApi = useFoods(user.uid)
  const fam = useFamily(user.uid)
  const publish = useMemo(
    () => ({ code: fam.code ?? null, global: fam.global }),
    [fam.code, fam.global],
  )
  useScoreBackfill(user.uid, settings, publish)

  // freshest data on open and whenever the app comes back to the foreground:
  // Garmin (server throttles to one real sync per 10 min) + phone Health Connect
  useEffect(() => {
    kickSync(user.uid)
    const onVis = () => {
      if (document.visibilityState === 'visible') kickSync(user.uid)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [user.uid])

  if (!settings) {
    return <div className="flex min-h-dvh items-center justify-center text-mist">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-[env(safe-area-inset-top)] sm:pb-8 lg:max-w-6xl lg:px-6">
      <header className="flex items-center justify-between py-5">
        <h1 className="text-xl font-bold uppercase tracking-tight">
          Meat<span className="text-grind">Grinder</span>
        </h1>
        <div className="flex items-center gap-4">
          <nav className="hidden gap-1 rounded-full border border-edge bg-panel p-1 sm:flex">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  tab === t ? 'bg-grind text-ink' : 'text-mist hover:text-bone'
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
          <button onClick={logOut} title={user.email ?? undefined} className="text-xs text-mist hover:text-bone">
            Sign out
          </button>
        </div>
      </header>

      {/* first sign-in: interview → macros, instead of silent defaults */}
      {isNew && !wizardDismissed && (
        <GoalWizard onSave={(next) => save(next)} onClose={() => setWizardDismissed(true)} />
      )}

      {tab === 'Diary' && <Today uid={user.uid} settings={settings} foods={foodsApi.foods} addFood={foodsApi.addFood} updateFood={foodsApi.updateFood} publish={publish} saveSettings={save} />}
      {tab === 'Compete' && <Compete user={user} fam={fam} />}
      {tab === 'Reports' && <Reports uid={user.uid} settings={settings} />}
      {tab === 'Library' && <Foods uid={user.uid} settings={settings} {...foodsApi} />}
      {tab === 'Settings' && <Goals uid={user.uid} settings={settings} save={save} />}

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-edge bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3.5 text-xs font-semibold uppercase tracking-wider transition ${
              tab === t ? 'text-grind' : 'text-mist'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>
    </div>
  )
}
