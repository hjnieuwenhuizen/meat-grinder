export const keyOf = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const todayKey = () => keyOf(new Date())

export const fromKey = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (key, n) => {
  const d = fromKey(key)
  d.setDate(d.getDate() + n)
  return keyOf(d)
}

// Monday-start week
export const startOfWeek = (key) => {
  const d = fromKey(key)
  const shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift)
  return keyOf(d)
}

export const weekKeys = (startKey) =>
  Array.from({ length: 7 }, (_, i) => addDays(startKey, i))

export const monthKeys = (year, month) => {
  const days = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: days }, (_, i) =>
    keyOf(new Date(year, month, i + 1)),
  )
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const fmtDay = (key) => {
  const d = fromKey(key)
  return `${DAYS[d.getDay()]} ${d.getDate()}`
}

export const fmtLong = (key) => {
  const d = fromKey(key)
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export const fmtMonth = (year, month) => `${MONTHS[month]} ${year}`
