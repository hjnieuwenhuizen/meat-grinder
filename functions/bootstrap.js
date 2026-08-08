// Fallback for when Garmin rate-limits logins from cloud IPs:
// log in from YOUR machine, then paste the printed tokens into the app
// (Settings → Garmin → Advanced → "Connect with tokens").
//
// Usage: node bootstrap.js
const readline = require('readline')
const { GarminConnect } = require('garmin-connect')

const ask = (q, hidden = false) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    if (hidden) {
      const onData = (char) => {
        if (['\n', '\r', ''].includes(char.toString())) return
        readline.moveCursor(process.stdout, -1, 0)
        process.stdout.write('*')
      }
      process.stdin.on('data', onData)
      rl.question(q, (a) => { process.stdin.off('data', onData); rl.close(); console.log(); resolve(a.trim()) })
    } else {
      rl.question(q, (a) => { rl.close(); resolve(a.trim()) })
    }
  })

;(async () => {
  const username = await ask('Garmin email: ')
  const password = await ask('Garmin password: ', true)

  console.log('Logging in to Garmin…')
  const client = new GarminConnect({ username, password })
  await client.login()
  await client.getUserProfile()
  const t = client.exportToken()

  console.log('\nLogin OK. Copy the JSON below and paste it into the app:')
  console.log('Settings → Garmin → Advanced → Connect with tokens\n')
  console.log(JSON.stringify({ oauth1: t.oauth1, oauth2: t.oauth2 }))
})().catch((e) => {
  console.error('Failed:', e.message)
  process.exit(1)
})
