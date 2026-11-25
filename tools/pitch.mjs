#!/usr/bin/env node
// Turn a scout's leads JSON into finished pitches — without the Reverb desktop app.
//
//   node tools/pitch.mjs leads.json --name "Emmanuel" [--out pitches] [--record]
//
// Writes <out>.json (subject + body per lead, ready for any mail tool) and <out>.md
// (readable, copy-paste into Gmail). With --record it also appends every lead to the
// local "never twice" list that the scouts read, so nobody is ever pitched twice:
//   ~/.claude/artist-reach/contacts.json   (override with $ARTIST_REACH_CONTACTS)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const flag = (n) => argv.includes(`--${n}`)

const input = argv.find((a) => !a.startsWith('--') && /\.json$/i.test(a))
if (!input) {
  console.error('Usage: node tools/pitch.mjs <leads.json> --name "Your Name" [--out pitches] [--record]')
  process.exit(1)
}

const senderName = arg('name', '')
const outBase = resolve(arg('out', input.replace(/\.json$/i, '') + '-pitches'))

/* ---------- pitch templates ---------- */
const SHARED_JS = [
  process.env.ARTIST_REACH_PITCH_JS,
  join(homedir(), '.claude/artist-reach/shared.js'),
  join(dirname(fileURLToPath(import.meta.url)), '..', 'pitch', 'shared.js'),
].find((p) => p && existsSync(p))
if (!SHARED_JS) {
  console.error('No pitch templates found. Run ./install.sh, or set ARTIST_REACH_PITCH_JS=/path/to/pitch/shared.js')
  process.exit(1)
}
const sandbox = { self: {} }
vm.runInNewContext(readFileSync(SHARED_JS, 'utf8'), sandbox)
const ARD = sandbox.self.ARD

/* ---------- leads in ---------- */
const raw = JSON.parse(readFileSync(input, 'utf8'))
const leads = Array.isArray(raw) ? raw : raw.leads || raw.items || []
if (!leads.length) { console.error(`No leads in ${input}`); process.exit(1) }

const items = ARD.toItems(leads)
const ready = items.filter((i) => i.status !== 'skipped')
const skipped = items.filter((i) => i.status === 'skipped')

const out = ready.map((i) => ({
  name: i.name,
  email: i.email,
  role: i.role || 'artist',
  variant: i.variant,
  patreon: !!i.patreon,
  foundOn: i.foundOn,
  profileUrl: i.profileUrl,
  subject: ARD.signOff(i.subject, senderName),
  body: ARD.signOff(i.body, senderName)
}))

writeFileSync(`${outBase}.json`, JSON.stringify(out, null, 2))
writeFileSync(
  `${outBase}.md`,
  out.map((i) => `## ${i.name} — ${i.email}\n\n**Subject:** ${i.subject}\n\n${i.body}\n`).join('\n---\n\n')
)

/* ---------- record them so they are never pitched twice ---------- */
let recorded = 0
if (flag('record')) {
  const p = process.env.ARTIST_REACH_CONTACTS || join(homedir(), '.claude/artist-reach/contacts.json')
  mkdirSync(dirname(p), { recursive: true })
  let store = { contacts: {} }
  try { store = JSON.parse(readFileSync(p, 'utf8')) } catch {}
  store.contacts = store.contacts || {}
  for (const i of out) {
    if (store.contacts[i.email]) continue
    store.contacts[i.email] = { name: i.name, email: i.email, profileUrl: i.profileUrl || '', addedAt: new Date().toISOString(), by: 'pitch.mjs' }
    recorded++
  }
  writeFileSync(p, JSON.stringify(store, null, 2))
}

console.log(JSON.stringify({
  ok: true,
  pitched: out.length,
  skipped: skipped.map((i) => ({ name: i.name, email: i.email, reason: i.reason })),
  recorded,
  byVariant: out.reduce((a, i) => ({ ...a, [i.variant || 'given']: (a[i.variant || 'given'] || 0) + 1 }), {}),
  files: [`${outBase}.json`, `${outBase}.md`],
  note: senderName ? undefined : 'No --name given, so the pitches still end with [Your Name].'
}, null, 2))
