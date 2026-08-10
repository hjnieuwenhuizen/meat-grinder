import { useState, type InputHTMLAttributes, type ReactNode } from 'react'

export function CopyButton({ text, label = 'Copy for LLM' }: { text: string | (() => string); label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(typeof text === 'function' ? text() : text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
      className="flex items-center gap-1.5 rounded-full border border-edge bg-raise px-3 py-1.5 text-xs font-medium text-mist transition hover:border-grind/50 hover:text-bone"
    >
      {done ? (
        <><Check className="size-3.5 text-grind" /> Copied</>
      ) : (
        <><Clipboard className="size-3.5" /> {label}</>
      )}
    </button>
  )
}

const MODAL_SIZES = {
  md: 'max-w-md',
  lg: 'max-w-md sm:max-w-2xl',
  xl: 'max-w-md sm:max-w-4xl',
} as const

export function Modal({ title, onClose, children, size = 'md' }: {
  title: string
  onClose: () => void
  children: ReactNode
  size?: keyof typeof MODAL_SIZES
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6">
      <div className={`max-h-[80dvh] w-full ${MODAL_SIZES[size]} overflow-y-auto rounded-b-2xl border border-edge bg-panel p-5 pt-[calc(1.25rem+env(safe-area-inset-top))] shadow-2xl sm:max-h-[88dvh] sm:rounded-2xl sm:p-6`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1 text-mist hover:text-bone">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-mist">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-bone outline-none transition focus:border-grind/60"
      />
    </label>
  )
}

export function Ring({
  value, goal, color, okOver = false, size = 84, stroke = 7, children,
}: {
  value: number; goal: number; color: string; okOver?: boolean
  size?: number; stroke?: number; children?: ReactNode
}) {
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0
  const over = goal > 0 && value > goal && !okOver
  const rad = (size - stroke) / 2
  const circ = 2 * Math.PI * rad
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke="var(--color-edge)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={rad} fill="none"
          stroke={over ? 'var(--color-over)' : color}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

export const Panel = ({ className = '', children }: { className?: string; children: ReactNode }) => (
  <div className={`rounded-2xl border border-edge bg-panel ${className}`}>{children}</div>
)

/* --- inline icons --- */
const svg = (path: ReactNode) =>
  function Icon({ className = '' }: { className?: string }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className={className}>
        {path}
      </svg>
    )
  }

export const Clipboard = svg(<><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>)
export const Check = svg(<path d="M20 6 9 17l-5-5" />)
export const X = svg(<path d="M18 6 6 18M6 6l12 12" />)
export const Plus = svg(<path d="M12 5v14M5 12h14" />)
export const Trash = svg(<><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>)
export const ChevronLeft = svg(<path d="m15 18-6-6 6-6" />)
export const ChevronRight = svg(<path d="m9 18 6-6-6-6" />)
export const Pencil = svg(<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />)
