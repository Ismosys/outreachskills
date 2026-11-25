#!/usr/bin/env node
// One-command Artist Reach run: scout YouTube/YouTube Music + X in parallel until N new artists without a website
// (with a public email) are found, reserve them on Reverb's shared "never twice" list, write a pitch for each,
// and have Reverb save the drafts across all its Gmail accounts (IMAP, ~1 s per draft). Nothing is ever sent.
//
//   node run.mjs --target 100 [--genres "..."] [--cities "..."] [--minutes 25] [--x-requests 150] [--no-x]
//                [--senders "a@gmail.com,b@gmail.com"] [--no-draft]

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const flag = (n) => argv.includes(`--${n}`)
const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean)
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILLS = join(homedir(), '.claude/skills')
const YT = join(SKILLS, 'youtube-artist-scout/scripts/scout.mjs')
const XS = join(SKILLS, 'x-artist-scout/scripts/scout.mjs')
const PS = join(SKILLS, 'podcast-scout/scripts/scout.mjs')
const PAT = join(SKILLS, 'patreon-scout/scripts/scout.mjs')
const usePatreon = !flag('no-patreon')
const REVERB = process.env.ARTIST_REACH_DIR || join(homedir(), 'Library/Application Support/reverb/artist-reach')
// Pitch templates. First one that exists wins:
//   $ARTIST_REACH_PITCH_JS  →  ~/.claude/artist-reach/shared.js (put there by install.sh)
//   →  the Reverb checkout's Chrome-extension copy (only on the machine Reverb was built on)
const SHARED_JS = [
  process.env.ARTIST_REACH_PITCH_JS,
  join(homedir(), '.claude/artist-reach/shared.js'),
  join(homedir(), 'Desktop/VS Code Projects/Reverb/artist-reach-extension/shared.js'),
].find((p) => p && existsSync(p))
const BRIDGE = 'http://127.0.0.1:47821'

const target = Number(arg('target', '200'))
const minutes = Number(arg('minutes', '90'))
const xRequests = Number(arg('x-requests', '150'))
const useX = !flag('no-x')
// Producers publish emails far more often than artists, so cap their share or they crowd out artists and bands.
const producerShare = Number(arg('producer-share', '0.25'))
// Independent podcasters (Apple Podcasts RSS: owner email, no own site, Patreon detected). 0 turns them off.
const podcastShare = flag('no-podcasts') ? 0 : Number(arg('podcast-share', '0.3'))
const PODCAST_TERMS = shuffle(list(arg('podcast-terms', 'indie comedy podcast,comedy duo podcast,true crime sisters,true crime friends,unsolved mysteries podcast,paranormal podcast,horror movie podcast,film review podcast,tv recap podcast,anime podcast,video game podcast,tabletop rpg actual play,d&d podcast,book club podcast,fantasy book podcast,history podcast,local history podcast,music podcast indie,hip hop podcast,metal podcast,wrestling podcast,football fan podcast,soccer fan podcast,nba fan podcast,fantasy football podcast,golf podcast,fishing podcast,hunting podcast,running podcast,fitness podcast,mental health podcast,parenting podcast,mom podcast,dad podcast,relationship podcast,dating podcast,lgbtq podcast,faith conversations podcast,spirituality podcast,witchcraft podcast,astrology podcast,sci-fi podcast,star wars podcast,marvel podcast,disney podcast,nerd culture podcast,beer podcast,food podcast,travel podcast,small business podcast,entrepreneur podcast,real estate investing podcast,personal finance podcast,crypto podcast,tech news podcast,cars podcast,motorsport podcast,gardening podcast,pets podcast,storytelling podcast,audio drama,improv podcast,pop culture podcast,reality tv podcast,celebrity gossip podcast,nostalgia podcast 90s,conspiracy podcast,science podcast,space podcast,nature podcast')))
const roles = arg('roles', 'artists,bands,producers,patreon')
const doDraft = !flag('no-draft')
const senderEmails = list(arg('senders', ''))
const genres = shuffle(list(arg('genres', 'hip hop,rap,drill,trap,r&b,soul,neo soul,gospel,christian,indie,indie rock,indie pop,bedroom pop,pop,alternative,punk,pop punk,emo,hardcore,grunge,shoegaze,post punk,singer songwriter,folk,americana,country,blues,jazz,funk,reggae,electronic,house,techno,drum and bass,synthwave,lo-fi,ambient,metal,metalcore,rock')))
const cities = shuffle(list(arg('cities', 'Los Angeles,New York,Atlanta,Chicago,Houston,Dallas,Austin,San Antonio,Nashville,Memphis,New Orleans,Miami,Tampa,Orlando,Charlotte,Raleigh,Richmond,Washington DC,Baltimore,Philadelphia,Pittsburgh,Boston,Providence,Detroit,Cleveland,Columbus,Cincinnati,Indianapolis,Milwaukee,Minneapolis,St Louis,Kansas City,Omaha,Denver,Salt Lake City,Phoenix,Tucson,Las Vegas,San Diego,San Francisco,Oakland,Sacramento,Portland,Seattle,Boise,Albuquerque,Oklahoma City,Louisville,Birmingham Alabama,Toronto,Montreal,Vancouver,Calgary,Edmonton,Ottawa,Winnipeg,Halifax,Hamilton,London,Manchester,Birmingham,Liverpool,Leeds,Sheffield,Newcastle,Nottingham,Bristol,Brighton,Cardiff,Glasgow,Edinburgh,Belfast,Leicester,Coventry,Southampton,Dublin,Cork,Galway,Sydney,Melbourne,Brisbane,Perth,Adelaide,Gold Coast,Canberra,Auckland,Wellington,Christchurch,Amsterdam,Rotterdam,Berlin,Hamburg,Stockholm,Copenhagen,Oslo,Antwerp')))
const YT_WORKERS = Number(arg('yt-workers', '10'))
const deadline = Date.now() + minutes * 60_000

const log = (m) => process.stderr.write(`[${new Date().toTimeString().slice(0, 8)}] ${m}\n`)
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '')

/* ---------- Reverb bridge ---------- */
const token = (() => { try { return JSON.parse(readFileSync(join(REVERB, 'contacts.json'), 'utf8')).token } catch { return '' } })()
async function bridge(path, method = 'GET', body) {
  const r = await fetch(BRIDGE + path, { method, headers: { 'X-ARD-Token': token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `bridge HTTP ${r.status}`)
  return j
}
let bridgeOk = false
try { await bridge('/ard/status'); bridgeOk = true } catch (e) { log(`Reverb not reachable (${e.message}). Leads will be saved but not reserved or drafted. Open Reverb and re-run.`) }
let senders = []
if (bridgeOk) {
  senders = (await bridge('/ard/senders')).senders
  const use = senderEmails.length ? senders.filter((s) => senderEmails.includes(s.email)) : senders
  log(`Gmail accounts in Reverb: ${use.length} (room today: ${use.reduce((a, s) => a + s.room, 0)} drafts)`)
}

/* ---------- pitch writer (same template as the Chrome extension) ---------- */
const sandbox = { self: {} }
if (!SHARED_JS) {
  log('No pitch templates found. Run install.sh from the outreachskills repo, or set ARTIST_REACH_PITCH_JS=/path/to/pitch/shared.js')
  process.exit(1)
}
vm.runInNewContext(readFileSync(SHARED_JS, 'utf8'), sandbox)
const ARD = sandbox.self.ARD

/* ---------- collect leads ---------- */
const leads = []
const seenEmail = new Set()
const seenName = new Set()
const stats = { youtubeBatches: 0, xRuns: 0, fromYouTube: 0, fromX: 0, takenOnShared: 0, dupes: 0 }
const children = new Set()

async function accept(rows, src) {
  const fresh = []
  for (const r of rows) {
    const e = String(r.email || '').toLowerCase()
    if (!e || seenEmail.has(e) || seenName.has(slug(r.name))) { stats.dupes++; continue }
    const capOf = (role, share) => r.role === role && leads.filter((l) => l.role === role).length + fresh.filter((f) => f.role === role).length >= Math.round(target * share)
    if (capOf('podcaster', podcastShare)) { stats.podcastersOverCap = (stats.podcastersOverCap || 0) + 1; continue }
    if (!podcastsDone && r.role !== 'podcaster' && leads.filter((l) => l.role !== 'podcaster').length + fresh.filter((f) => f.role !== 'podcaster').length >= target - Math.round(target * podcastShare)) { stats.musiciansOverCap = (stats.musiciansOverCap || 0) + 1; continue }
    if (r.role === 'producer' && leads.filter((l) => l.role === 'producer').length + fresh.filter((f) => f.role === 'producer').length >= Math.round(target * producerShare)) { stats.producersOverCap = (stats.producersOverCap || 0) + 1; continue }
    seenEmail.add(e); seenName.add(slug(r.name))
    fresh.push(r)
  }
  if (!fresh.length) return
  let ok = fresh
  if (bridgeOk) {
    const res = (await bridge('/ard/reserve', 'POST', { by: 'claude-scout', items: fresh.map((r) => ({ name: r.name, email: r.email, urls: [r.profile_url, ...(r.other_links || [])].filter(Boolean) })) })).results
    ok = fresh.filter((_, i) => res[i]?.ok)
    stats.takenOnShared += fresh.length - ok.length
  }
  for (const r of ok) {
    if (leads.length >= target) break
    leads.push({ ...r, _src: src })
    if (src === 'YouTube') stats.fromYouTube++
    else if (src === 'Podcasts') stats.fromPodcasts = (stats.fromPodcasts || 0) + 1
    else if (src === 'Patreon') stats.fromPatreon = (stats.fromPatreon || 0) + 1
    else stats.fromX++
    if (r.patreon) stats.onPatreon = (stats.onPatreon || 0) + 1
  }
  log(`${src}: +${ok.length} → ${leads.length}/${target}`)
}

function runScript(file, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [file, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.add(p)
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', () => {
      children.delete(p)
      try { resolve(JSON.parse(out)) } catch { resolve({ leads: [], error: (err || out).slice(-300) }) }
    })
  })
}

const done = () => leads.length >= target || Date.now() > deadline
const pairs = []
for (const g of genres) for (const c of cities) pairs.push([g, c])
shuffle(pairs) // every genre×city combination (hundreds), so a run never runs out of searches before the target

async function ytWorker(w) {
  while (!done() && pairs.length) {
    const batch = pairs.splice(0, 2) // 2 genre×city pairs ≈ 6 queries ≈ 2 min
    stats.youtubeBatches++
    const res = await runScript(YT, ['--genres', [...new Set(batch.map((b) => b[0]))].join(','), '--cities', [...new Set(batch.map((b) => b[1]))].join(','), '--pages', '2', '--roles', roles, '--min-subs', arg('min-subs', '100'), '--limit', String(target), '--countries', 'US,GB,CA,AU,NZ,IE,NL,DE,SE,DK,NO,BE,FI'])
    if (res.error) log(`YouTube worker ${w}: ${res.error.split('\n')[0]}`)
    await accept(res.leads || [], 'YouTube')
  }
}
async function xWorker() {
  const perRun = Math.min(60, xRequests)
  let used = 0
  while (!done() && used < xRequests) {
    const g = genres.splice(0, 3)
    if (!g.length) break
    genres.push(...g)
    stats.xRuns++
    const res = await runScript(XS, ['--genres', g.join(','), '--mode', 'releases', '--pages', '2', '--max-requests', String(Math.min(perRun, xRequests - used)), '--limit', String(target)])
    used += res.stats?.requests || perRun
    if (res.error) { log(`X: ${res.error.split('\n')[0]}`); break }
    await accept(res.leads || [], 'X')
    if (res.stats?.rateLimited) { log('X rate limit reached, stopping X for this run'); break }
  }
}

// Patreon creators (patreon.com public API). Low yield (~0.5% of creators publish an email and have no site), so it
// runs alongside the others as a bonus source; its leads count toward the same role caps.
async function patreonWorker() {
  const qs = shuffle([...genres.flatMap((g) => [`${g} band`, `${g} singer`, `${g} musician`]), ...PODCAST_TERMS.slice()])
  while (!done() && qs.length) {
    const batch = qs.splice(0, 4)
    stats.patreonRuns = (stats.patreonRuns || 0) + 1
    const res = await runScript(PAT, ['--queries', batch.join(','), '--limit', '40'])
    if (res.error) { log(`Patreon: ${res.error.split('\n')[0]}`); if (/failed|fetch/i.test(res.error)) break }
    await accept(res.leads || [], 'Patreon')
  }
}

let podcastsDone = podcastShare === 0
async function podcastWorker() {
  const want = Math.round(target * podcastShare)
  while (!done() && PODCAST_TERMS.length && leads.filter((l) => l.role === 'podcaster').length < want) {
    const terms = PODCAST_TERMS.splice(0, 3)
    stats.podcastRuns = (stats.podcastRuns || 0) + 1
    const res = await runScript(PS, ['--terms', terms.join(','), '--countries', 'US,GB,CA,AU,IE,NZ', '--limit', String(want - leads.filter((l) => l.role === 'podcaster').length + 5)])
    if (res.error) log(`Podcasts: ${res.error.split('\n')[0]}`)
    await accept(res.leads || [], 'Podcasts')
  }
  podcastsDone = true // out of terms or quota met: musicians may fill any remaining places
}

log(`Scouting for ${target} artists (max ${minutes} min): ${YT_WORKERS} YouTube workers${useX ? ` + X (${xRequests} requests)` : ''}`)
const timer = setInterval(() => { if (done()) for (const c of children) c.kill('SIGTERM') }, 2000)
await Promise.all([...Array.from({ length: YT_WORKERS }, (_, i) => ytWorker(i + 1)), useX ? xWorker() : Promise.resolve(), podcastShare > 0 ? podcastWorker() : Promise.resolve(), usePatreon ? patreonWorker() : Promise.resolve()])
clearInterval(timer)

/* ---------- pitches + save ---------- */
const items = ARD.toItems(leads).filter((i) => i.status !== 'skipped')
const runsDir = join(HERE, '..', 'runs')
if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true })
const file = join(runsDir, `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`)
writeFileSync(file, JSON.stringify({ stats, leads, items: items.map(({ name, email, subject, body, foundOn, profileUrl, role, variant, patreon }) => ({ name, email, role, variant, patreon, subject, body, foundOn, profileUrl })) }, null, 2))
log(`Found ${leads.length} new leads (YouTube ${stats.fromYouTube}, X ${stats.fromX}, podcasts ${stats.fromPodcasts || 0}, Patreon search ${stats.fromPatreon || 0}, on Patreon ${stats.onPatreon || 0}). Saved: ${file}`)

/* ---------- draft through Reverb ---------- */
let draft = null
// Reverb may have been closed during a long scout: wait up to 10 min for it before giving up.
if (doDraft && bridgeOk && items.length) {
  for (let i = 0; i < 120; i++) {
    try { await bridge('/ard/status'); break } catch {
      if (i === 0) log('Reverb is not reachable — open the Reverb app; waiting up to 10 minutes to draft…')
      if (i === 119) { log(`Gave up waiting. Draft later with: node draft-saved.mjs "${file}"`); bridgeOk = false }
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}
if (doDraft && bridgeOk && items.length) {
  const { jobId } = await bridge('/ard/jobs', 'POST', { by: 'claude-scout', signOff: '', senderEmails, items: items.map((q) => ({ name: q.name, email: q.email, subject: q.subject, body: q.body, urls: ARD.urlsOf(q) })) })
  log(`Drafting ${items.length} pitches across Gmail accounts…`)
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000))
    draft = await bridge(`/ard/jobs/${jobId}`)
    if (draft.finished) break
  }
  log(`Drafts: ${draft.drafted} saved, ${draft.skipped} skipped (already emailed), ${draft.failed} failed, ${draft.left} left for tomorrow (daily limits)`)
}

console.log(JSON.stringify({
  stats,
  found: leads.length,
  file,
  drafts: draft && { drafted: draft.drafted, skipped: draft.skipped, failed: draft.failed, left: draft.left, error: draft.error, byInbox: draft.items.reduce((a, i) => { if (i.status === 'drafted') a[i.by] = (a[i.by] || 0) + 1; return a }, {}) },
  byVariant: items.reduce((a, i) => { a[i.variant || 'custom'] = (a[i.variant || 'custom'] || 0) + 1; return a }, {}),
  onPatreon: leads.filter((l) => l.patreon).length,
  byRole: leads.reduce((a, l) => { const k = l.role || 'artist'; a[k] = (a[k] || 0) + 1; return a }, {}),
  leads: leads.map((l) => ({ name: l.name, role: l.role || 'artist', patreon: !!l.patreon, email: l.email, source: l._src, found_on: l.found_on, followers: l.followers ?? l.subscribers, where: l.country || l.location || l.city }))
}, null, 2))
process.exit(0)
