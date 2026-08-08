export const keyOf = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const todayKey = (): string => keyOf(new Date())

export const fromKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (key: string, n: number): string => {
  const d = fromKey(key)
  d.setDate(d.getDate() + n)
  return keyOf(d)
}

// Monday-start week
export const startOfWeek = (key: string): string => {
  const d = fromKey(key)
  const shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift)
  return keyOf(d)
}

export const weekKeys = (startKey: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(startKey, i))

export const monthKeys = (year: number, month: number): string[] => {
  const days = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: days }, (_, i) => keyOf(new Date(year, month, i + 1)))
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const fmtDay = (key: string): string => {
  const d = fromKey(key)
  return `${DAYS[d.getDay()]} ${d.getDate()}`
}

export const fmtLong = (key: string): string => {
  const d = fromKey(key)
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export const fmtMonth = (year: number, month: number): string => `${MONTHS[month]} ${year}`

export const fmtShort = (key: string): string => {
  const d = fromKey(key)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}
