import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-3xl">💥</div>
        <h1 className="text-lg font-semibold">Something broke</h1>
        <pre className="max-h-48 max-w-full overflow-auto rounded-lg border border-edge bg-panel p-3 text-left text-xs text-over">
          {String(this.state.error?.stack || this.state.error)}
        </pre>
        <button
          onClick={() => location.reload()}
          className="rounded-full bg-grind px-6 py-2.5 font-semibold text-ink"
        >
          Reload
        </button>
      </div>
    )
  }
}
