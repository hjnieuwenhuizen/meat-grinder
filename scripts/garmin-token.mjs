#!/usr/bin/env node
// Meat Grinder — Garmin token generator.
//
// Garmin often blocks logins from cloud servers, but logins from your own
// computer work fine. This script logs in locally and prints session tokens
// you paste into the app: Settings → Garmin → Advanced → Connect with tokens.
//
// Requirements: Node.js 18+ (nodejs.org)
//
// Run it:
//   mkdir garmin-token && cd garmin-token
//   npm init -y && npm i garmin-connect
//   curl -O https://YOUR-APP-URL/garmin-token.mjs   (or download via browser)
//   node garmin-token.mjs
//
// (From a repo checkout: npm install, then `node public/garmin-token.mjs`.)

import readline from 'node:readline'
import { GarminConnect } from 'garmin-connect'

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

const username = await ask('Garmin email: ')
const password = await ask('Garmin password: ', true)

console.log('Logging in to Garmin…')
const client = new GarminConnect({ username, password })
await client.login()
await client.getUserProfile()
const t = client.exportToken()

console.log('\n✅ Login OK. Copy EVERYTHING below (one line) and paste it into the app:')
console.log('Settings → Garmin → Advanced → Connect with tokens\n')
console.log(JSON.stringify({ oauth1: t.oauth1, oauth2: t.oauth2 }))
