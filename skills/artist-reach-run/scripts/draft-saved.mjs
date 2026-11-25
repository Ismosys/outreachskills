#!/usr/bin/env node
// Re-draft a saved run whose drafting step didn't happen (e.g. Reverb was closed).
// Only items still "reserved" on Reverb's shared list are sent; already-drafted ones are skipped.
//   node draft-saved.mjs ../runs/<file>.json   (default: the newest run)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const runsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs')
const file = process.argv[2] || join(runsDir, readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort((a, b) => statSync(join(runsDir, b)).mtimeMs - statSync(join(runsDir, a)).mtimeMs)[0])
const REVERB = join(homedir(), 'Library/Application Support/reverb/artist-reach')
const reg = JSON.parse(readFileSync(join(REVERB, 'contacts.json'), 'utf8'))
const run = JSON.parse(readFileSync(file, 'utf8'))
const items = run.items.filter((i) => (reg.contacts[i.email.toLowerCase()] || {}).status === 'reserved')
console.error(`${file}: ${run.items.length} pitches, ${items.length} still waiting to be drafted`)
if (!items.length) process.exit(0)

const H = { 'X-ARD-Token': reg.token, 'Content-Type': 'application/json' }
const urlsOf = (email) => { const l = run.leads.find((x) => String(x.email).toLowerCase() === email.toLowerCase()) || {}; return [l.profile_url, ...(l.other_links || [])].filter(Boolean) }
const r = await fetch('http://127.0.0.1:47821/ard/jobs', { method: 'POST', headers: H, body: JSON.stringify({ by: 'claude-scout', signOff: '', senderEmails: [], items: items.map((i) => ({ name: i.name, email: i.email, subject: i.subject, body: i.body, urls: urlsOf(i.email) })) }) })
const { jobId, error } = await r.json()
if (!jobId) { console.error(error); process.exit(1) }
let p
do {
  await new Promise((res) => setTimeout(res, 3000))
  p = await (await fetch(`http://127.0.0.1:47821/ard/jobs/${jobId}`, { headers: H })).json()
} while (!p.finished)
const byInbox = p.items.reduce((a, i) => { if (i.status === 'drafted') a[i.by] = (a[i.by] || 0) + 1; return a }, {})
console.log(JSON.stringify({ drafted: p.drafted, skipped: p.skipped, failed: p.failed, left: p.left, error: p.error, byInbox, problems: p.items.filter((i) => i.status !== 'drafted').map((i) => `${i.email}: ${i.status} ${i.reason}`) }, null, 2))
