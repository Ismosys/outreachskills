#!/usr/bin/env node
// Save pitches as Gmail drafts across several Gmail accounts over IMAP.
// Nothing is ever sent: you review each draft in Gmail and hit Send yourself.
//
//   node tools/draft-gmail.mjs --test                      check every account's login
//   node tools/draft-gmail.mjs leads-pitches.json          draft, spread over all accounts
//   node tools/draft-gmail.mjs pitches.json --senders "a@gmail.com,b@gmail.com"
//
// Accounts live in ~/.claude/artist-reach/senders.json ($ARTIST_REACH_SENDERS to move it):
//   [{ "name": "Your Name", "email": "you@gmail.com", "appPassword": "abcd efgh ijkl mnop",
//      "dailyCap": 25, "enabled": true }]
// Each needs 2-Step Verification on the Google account and an app password from
// https://myaccount.google.com/apppasswords  — never your normal Gmail password.
//
// One shared queue: every inbox pulls the next pitch until its daily cap is used, so accounts
// fill evenly and a dead login doesn't strand its share. Anyone already in an inbox's Sent or
// Drafts is skipped there and offered to another inbox instead.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { connect as netConnect } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { connect as tlsConnect } from 'node:tls'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const flag = (n) => argv.includes(`--${n}`)
const list = (s) => (s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)

const DIR = process.env.ARTIST_REACH_HOME || join(homedir(), '.claude/artist-reach')
const SENDERS_FILE = process.env.ARTIST_REACH_SENDERS || join(DIR, 'senders.json')
const DAYLOG_FILE = join(DIR, 'daylog.json')
const HOST = arg('host', 'imap.gmail.com')
const PORT = Number(arg('port', '993'))
const SECURE = !flag('insecure')
const DRY = flag('dry-run')
const today = () => new Date().toISOString().slice(0, 10)
const log = (m) => process.stderr.write(`[${new Date().toTimeString().slice(0, 8)}] ${m}\n`)

/* ----------------------------------------------------------------- IMAP ---- */
// Minimal IMAP: LOGIN with an app password, find Drafts (RFC 6154 \Drafts),
// SEARCH Sent/Drafts, APPEND, LOGOUT. No dependencies.
class Imap {
  constructor(opts) { this.opts = opts; this.buf = ''; this.waiters = []; this.tag = 0; this.closedErr = null; this.sock = null }

  async connect() {
    const { host, port, secure } = this.opts
    this.sock = await new Promise((resolve, reject) => {
      const s = secure === false ? netConnect({ host, port }) : tlsConnect({ host, port, servername: host })
      const timer = setTimeout(() => { s.destroy(); reject(new Error(`timed out connecting to ${host}`)) }, this.opts.timeoutMs ?? 20000)
      s.once(secure === false ? 'connect' : 'secureConnect', () => { clearTimeout(timer); resolve(s) })
      s.once('error', (e) => { clearTimeout(timer); reject(e) })
    })
    this.sock.setEncoding('utf8')
    this.sock.setTimeout(60000, () => this.sock?.destroy(new Error('IMAP connection timed out')))
    this.sock.on('data', (d) => { this.buf += d; this.wake() })
    const end = (e) => { this.closedErr = e ?? new Error('IMAP connection closed'); this.wake() }
    this.sock.on('error', end)
    this.sock.on('close', () => end())
    const greeting = await this.line()
    if (!/^\* (OK|PREAUTH)/i.test(greeting)) throw new Error(`unexpected IMAP greeting: ${greeting.slice(0, 80)}`)
  }

  wake() { const w = this.waiters; this.waiters = []; for (const f of w) f() }

  async line() {
    for (;;) {
      const i = this.buf.indexOf('\r\n')
      if (i >= 0) { const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2); return l }
      if (this.closedErr) throw this.closedErr
      await new Promise((r) => this.waiters.push(r))
    }
  }

  write(s) { if (!this.sock) throw new Error('not connected'); this.sock.write(s) }

  async command(cmd, onContinue) {
    const t = `A${++this.tag}`
    this.write(`${t} ${cmd}\r\n`)
    const untagged = []
    for (;;) {
      const l = await this.line()
      if (l.startsWith('+') && onContinue) { onContinue(); continue }
      if (l.startsWith(`${t} `)) {
        const rest = l.slice(t.length + 1)
        if (/^OK/i.test(rest)) return untagged
        const e = new Error(rest.replace(/^(NO|BAD)\s*/i, '').trim() || rest)
        e.imap = true
        throw e
      }
      untagged.push(l)
    }
  }

  login(user, pass) { return this.command(`LOGIN ${q(user)} ${q(pass)}`) }

  async boxes() {
    const lines = await this.command('LIST "" "*"')
    return lines
      .map((l) => l.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/i))
      .filter(Boolean)
      .map((m) => ({ flags: m[1], name: unq(m[2].trim()) }))
  }

  async drafts() {
    const b = await this.boxes()
    const hit = b.find((x) => /\\Drafts\b/i.test(x.flags)) ?? b.find((x) => /(^|\/)drafts?$/i.test(x.name))
    if (!hit) throw new Error('could not find the Drafts folder')
    return hit.name
  }

  async special(flagName) {
    const b = await this.boxes()
    return b.find((x) => new RegExp(`\\\\${flagName}\\b`, 'i').test(x.flags))?.name || ''
  }

  /** True when any message in `mailbox` is addressed to `email` (read-only). */
  async hasMailTo(mailbox, email) {
    if (!mailbox) return false
    await this.command(`EXAMINE ${q(mailbox)}`)
    const lines = await this.command(`SEARCH TO ${q(email)}`)
    return lines.some((l) => /^\* SEARCH \d/.test(l))
  }

  async append(mailbox, raw) {
    const msg = raw.replace(/\r?\n/g, '\r\n')
    const bytes = Buffer.byteLength(msg, 'utf8')
    await this.command(`APPEND ${q(mailbox)} (\\Draft \\Seen) {${bytes}}`, () => this.write(`${msg}\r\n`))
  }

  async logout() {
    try { if (this.sock && !this.closedErr) await this.command('LOGOUT') } catch { /* ignore */ }
    finally { this.sock?.destroy(); this.sock = null }
  }
}

const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const unq = (s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\(["\\])/g, '$1') : s)

/* ----------------------------------------------------------------- MIME ---- */
// RFC 2047 for non-ASCII headers; base64 body so any character survives.
const needsEnc = (s) => /[^\x20-\x7e]/.test(s)
const encHeader = (s) => (needsEnc(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s)
const encAddr = (name, email) => (name ? `${encHeader(name).includes('=?') ? encHeader(name) : `"${name.replace(/"/g, '')}"`} <${email}>` : email)

function mime({ fromName, fromEmail, to, subject, text }) {
  const body = Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
  const id = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${fromEmail.split('@')[1] || 'localhost'}>`
  return [
    `From: ${encAddr(fromName, fromEmail)}`,
    `To: ${to}`,
    `Subject: ${encHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body
  ].join('\r\n')
}

/* -------------------------------------------------------------- accounts ---- */
if (!existsSync(SENDERS_FILE)) {
  console.error(`No Gmail accounts configured. Create ${SENDERS_FILE}:

[
  {
    "name": "Your Name",
    "email": "you@gmail.com",
    "appPassword": "abcd efgh ijkl mnop",
    "dailyCap": 25,
    "enabled": true
  }
]

The app password comes from https://myaccount.google.com/apppasswords (needs 2-Step
Verification on that Google account). See docs/gmail-setup.md.`)
  process.exit(1)
}

let accounts
try {
  accounts = JSON.parse(readFileSync(SENDERS_FILE, 'utf8'))
  if (!Array.isArray(accounts)) accounts = accounts.senders || []
} catch (e) {
  console.error(`${SENDERS_FILE} is not valid JSON (${e.message}).`)
  process.exit(1)
}

const wanted = new Set(list(arg('senders', '')))
const senders = accounts
  .filter((s) => s && s.email && s.appPassword && s.enabled !== false)
  .filter((s) => !wanted.size || wanted.has(String(s.email).trim().toLowerCase()))
  .map((s, i) => ({
    id: String(s.id || s.email || i),
    name: String(s.name || '').trim(),
    email: String(s.email).trim(),
    appPassword: String(s.appPassword).replace(/\s+/g, ''),
    dailyCap: Number.isFinite(s.dailyCap) ? Number(s.dailyCap) : 25
  }))

if (!senders.length) {
  console.error(wanted.size ? `None of --senders matched an enabled account in ${SENDERS_FILE}.` : `No enabled accounts in ${SENDERS_FILE}.`)
  process.exit(1)
}

/* ---------------------------------------------------------------- daylog ---- */
// How many drafts each inbox already got today, so caps hold across several runs.
mkdirSync(dirname(DAYLOG_FILE), { recursive: true })
let daylog = {}
try { daylog = JSON.parse(readFileSync(DAYLOG_FILE, 'utf8')) } catch {}
if (daylog.day !== today()) daylog = { day: today(), counts: {} }
daylog.counts = daylog.counts || {}
const saveDaylog = () => writeFileSync(DAYLOG_FILE, JSON.stringify(daylog, null, 2))
const usedToday = (email) => daylog.counts[email.toLowerCase()] || 0

async function open(s) {
  const c = new Imap({ host: HOST, port: PORT, secure: SECURE })
  try { await c.connect() } catch (e) { throw new Error(`${s.email}: could not connect to ${HOST} (${e.message}).`) }
  try {
    await c.login(s.email, s.appPassword)
  } catch (e) {
    await c.logout()
    throw new Error(
      e.imap && /auth|credential|password|invalid|login/i.test(e.message)
        ? `${s.email}: Gmail rejected the app password. Create a new one at myaccount.google.com/apppasswords — it needs 2-Step Verification on that account, and is unavailable if 2SV uses only security keys or Advanced Protection. Use the 16 characters, not your normal password. (IMAP itself needs no setting: Gmail has it on for everyone since 2025.)`
        : `${s.email}: sign-in failed (${e.message}).`
    )
  }
  const draftsPath = await c.drafts()
  return { c, draftsPath }
}

/* ------------------------------------------------------------------ test ---- */
if (flag('test')) {
  const results = []
  for (const s of senders) {
    try {
      const { c, draftsPath } = await open(s)
      const sent = await c.special('Sent')
      await c.logout()
      results.push({ email: s.email, ok: true, drafts: draftsPath, sent, dailyCap: s.dailyCap, usedToday: usedToday(s.email), roomToday: Math.max(0, s.dailyCap - usedToday(s.email)) })
      log(`ok   ${s.email} → ${draftsPath} (${Math.max(0, s.dailyCap - usedToday(s.email))} of ${s.dailyCap} left today)`)
    } catch (e) {
      results.push({ email: s.email, ok: false, error: e.message })
      log(`FAIL ${e.message}`)
    }
  }
  console.log(JSON.stringify({ accounts: results.length, working: results.filter((r) => r.ok).length, results }, null, 2))
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}

/* ---------------------------------------------------------------- pitches ---- */
const input = argv.find((a) => !a.startsWith('--') && /\.json$/i.test(a))
if (!input) {
  console.error('Usage: node tools/draft-gmail.mjs <pitches.json> [--senders "a@gmail.com,..."] [--test] [--dry-run]')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(input, 'utf8'))
const all = (Array.isArray(raw) ? raw : raw.items || raw.leads || [])
  .filter((i) => i && i.email && i.subject && i.body && i.status !== 'skipped')
const seen = new Set()
const queue = all.filter((i) => { const e = i.email.toLowerCase(); if (seen.has(e)) return false; seen.add(e); return true })

if (!queue.length) {
  console.error(`No pitches with an email, subject and body in ${input}. Run tools/pitch.mjs on your leads first.`)
  process.exit(1)
}

const room = new Map(senders.map((s) => [s.id, Math.max(0, s.dailyCap - usedToday(s.email))]))
const totalRoom = [...room.values()].reduce((a, b) => a + b, 0)
log(`${queue.length} pitches; ${senders.length} inbox(es), room today: ${senders.map((s) => `${s.email} ${room.get(s.id)}`).join(', ')} = ${totalRoom}`)
if (!totalRoom) {
  console.error('Every account has hit its daily cap. Try tomorrow, add an account, or raise a cap in ' + SENDERS_FILE)
  process.exit(1)
}

const result = { drafted: [], skipped: [], failed: [], left: [] }

if (DRY) {
  // Show the plan and one rendered message, touching nothing.
  const plan = new Map(senders.map((s) => [s.email, []]))
  const line = [...queue]
  let i = 0
  const cap = new Map(room)
  while (line.length) {
    let placed = false
    for (let t = 0; t < senders.length; t++) {
      const s = senders[(i + t) % senders.length]
      if ((cap.get(s.id) ?? 0) > 0) { plan.get(s.email).push(line.shift().email); cap.set(s.id, cap.get(s.id) - 1); i = (i + t + 1) % senders.length; placed = true; break }
    }
    if (!placed) break
  }
  console.log(JSON.stringify({
    dryRun: true,
    plan: Object.fromEntries([...plan].map(([k, v]) => [k, v.length])),
    perInbox: Object.fromEntries(plan),
    left: line.map((i) => i.email),
    sample: mime({ fromName: senders[0].name, fromEmail: senders[0].email, to: queue[0].email, subject: queue[0].subject, text: queue[0].body })
  }, null, 2))
  process.exit(0)
}

/* One shared line; each inbox takes the next pitch until its cap is used. */
const line = [...queue]
await Promise.all(senders.map(async (s) => {
  if ((room.get(s.id) ?? 0) <= 0 || !line.length) return
  let conn
  try { conn = await open(s) } catch (e) { log(e.message); return } // the others keep taking from the line
  const { c, draftsPath } = conn
  let sentPath = null
  try {
    while ((room.get(s.id) ?? 0) > 0 && line.length) {
      const it = line.shift()
      try {
        if (sentPath === null) sentPath = await c.special('Sent')
        if ((await c.hasMailTo(sentPath, it.email)) || (await c.hasMailTo(draftsPath, it.email))) {
          result.skipped.push({ email: it.email, reason: `already in ${s.email}'s Sent or Drafts` })
          continue
        }
        const name = s.name || '[Your Name]'
        await c.append(draftsPath, mime({
          fromName: s.name,
          fromEmail: s.email,
          to: it.email,
          subject: String(it.subject).trim(),
          text: String(it.body).replace(/\[Your Name\]|\{\{\s*sender_name\s*\}\}|\{sender_name\}/gi, name)
        }))
        daylog.counts[s.email.toLowerCase()] = usedToday(s.email) + 1
        saveDaylog()
        room.set(s.id, room.get(s.id) - 1)
        result.drafted.push({ email: it.email, inbox: s.email })
      } catch (e) {
        result.failed.push({ email: it.email, inbox: s.email, error: e.message })
      }
    }
  } finally {
    await c.logout()
  }
}))

const allFull = senders.every((s) => (room.get(s.id) ?? 0) <= 0)
for (const it of line) result.left.push({ email: it.email, reason: allFull ? 'daily caps reached — run again tomorrow' : "couldn't sign in to that inbox" })

const perInbox = result.drafted.reduce((a, d) => ({ ...a, [d.inbox]: (a[d.inbox] || 0) + 1 }), {})
log(`Drafted ${result.drafted.length} (${Object.entries(perInbox).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), skipped ${result.skipped.length}, failed ${result.failed.length}, left ${result.left.length}`)
console.log(JSON.stringify({ drafted: result.drafted.length, perInbox, skipped: result.skipped, failed: result.failed, left: result.left, note: 'Nothing was sent. Review the drafts in Gmail and send them yourself.' }, null, 2))
