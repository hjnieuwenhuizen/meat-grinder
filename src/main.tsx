import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

// stale-version fix: re-check for a new build every 30 min and whenever
// the app comes back to the foreground; autoUpdate then swaps it in
registerSW({
  onRegisteredSW(_url, reg) {
    if (!reg) return
    setInterval(() => reg.update(), 30 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update()
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
