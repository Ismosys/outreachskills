#!/usr/bin/env node
// X (Twitter) artist scout: the same technique Apify's X scrapers use.
// X's own web app talks to private GraphQL endpoints (/i/api/graphql/<queryId>/<Operation>)
// with a public "web bearer" token plus the logged-in session cookies (auth_token, ct0 -> x-csrf-token).
// We run those exact calls inside the logged-in Agent Reach Chrome profile, so X sees a normal browser
// session. Apify does the same thing at scale with a pool of accounts + residential proxies.
//
// Finds musicians who: tweet about new releases / have a musician bio, link to Spotify / Apple Music /
// YouTube Music / SoundCloud / Bandsintown, show a public email (bio or Linktree), have no own website,
// are active (recent post) and inside a follower range. Output = Artist Reach Drafter paste format.

import { chromium } from 'playwright-core'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/* ---------------- args ---------------- */
const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const flag = (name) => argv.includes(`--${name}`)
const all = (name) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []))
const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean)

const genres = list(arg('genres', 'hip hop,r&b,indie,pop,rock'))
const cities = list(arg('cities', ''))
const mode = arg('mode', 'both') // releases | people | both
const pages = Math.max(1, Math.min(5, Number(arg('pages', '2'))))
const minFollowers = Number(arg('min-followers', '100'))
const maxFollowers = Number(arg('max-followers', '250000'))
const maxDays = Number(arg('max-days', '90'))
const limit = Number(arg('limit', '100'))
const maxRequests = Number(arg('max-requests', '120'))
const out = arg('out', '')
const includeSites = flag('include-sites')
const anyPlatform = flag('any-platform')
const useExclude = !flag('no-exclude')
const allLocations = flag('all-locations')
// X locations are free text. Drop clearly out-of-target places; keep empty/unknown ones.
const OFF_TARGET = /\b(nigeria|naija|lagos|abuja|ibadan|port harcourt|enugu|benin city|ghana|accra|kumasi|kenya|nairobi|uganda|kampala|tanzania|zambia|zimbabwe|harare|cameroon|ivory coast|c[oô]te d.ivoire|senegal|india|mumbai|delhi|bangalore|pakistan|karachi|lahore|bangladesh|dhaka|philippines|manila|indonesia|jakarta|malaysia|brazil|brasil|s[aã]o paulo|rio de janeiro|mexico|m[eé]xico|cdmx|argentina|colombia|bogot[aá]|peru|chile|venezuela|turkey|t[uü]rkiye|istanbul|egypt|cairo|saudi|riyadh|dubai|uae|iran|iraq|russia|moscow|ukraine|china|japan|tokyo|korea|seoul|vietnam|thailand|bangkok)\b/i
const CDP = arg('cdp', 'http://127.0.0.1:9222')
const PROFILE = join(homedir(), '.agent-reach/browser/profile')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/* ---------------- queries ---------------- */
// Release tweets: active artists pushing a streaming link. url: matches the link's domain.
const RELEASE_LINKS = ['url:open.spotify.com', 'url:music.apple.com', 'url:soundcloud.com', 'url:music.youtube.com']
const searches = []
for (const q of all('query')) searches.push({ q, product: 'Latest', kind: 'custom' })
if (!searches.length) {
  const places = cities.length ? cities : ['']
  for (const g of genres) {
    for (const c of places) {
      if (mode !== 'people') {
        searches.push({
          q: `("new single" OR "out now" OR "new song" OR "my new") (${RELEASE_LINKS.join(' OR ')}) ${g}${c ? ` ${c}` : ''} -filter:replies -filter:nativeretweets`,
          product: 'Latest', kind: 'releases', genre: g, city: c
        })
        if (genres.length) searches.push({
          q: `("type beat" OR "beat tape" OR "new beat" OR "beats for sale") (url:beatstars.com OR url:bsta.rs OR url:youtube.com OR url:youtu.be) ${g}${c ? ` ${c}` : ''} -filter:replies -filter:nativeretweets`,
          product: 'Latest', kind: 'releases', genre: g, city: c, role: 'producer'
        })
      }
      if (mode !== 'releases') {
        // People tab matches names + bios.
        searches.push({ q: `${g} artist booking${c ? ` ${c}` : ''}`, product: 'People', kind: 'people', genre: g, city: c })
        searches.push({ q: `${g} singer${c ? ` ${c}` : ''} gmail`, product: 'People', kind: 'people', genre: g, city: c })
        searches.push({ q: `${g} producer beats${c ? ` ${c}` : ''}`, product: 'People', kind: 'people', genre: g, city: c, role: 'producer' })
        searches.push({ q: `${g} band${c ? ` ${c}` : ''} new single`, product: 'People', kind: 'people', genre: g, city: c, role: 'band' })
      }
    }
  }
}

/* ---------------- helpers ---------------- */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|^(example|email|name|test|noreply|no-reply)@|@(example|domain|sentry|wixpress)\./i
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|hey)\./i
const PLATFORM = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.com|twitter\.com|x\.com|t\.co|tiktok\.com|spotify\.com|spoti\.fi|apple\.com|soundcloud\.com|on\.soundcloud\.com|bandcamp\.com|linktr\.ee|beacons\.ai|hoo\.be|solo\.to|lnk\.bio|bio\.link|linkfire\.com|lnk\.to|ffm\.to|ffm\.bio|smarturl\.it|distrokid\.com|bandsintown\.com|songkick\.com|patreon\.com|twitch\.tv|discord\.(gg|com)|threads\.(net|com)|snapchat\.com|amazon\.com|deezer\.com|tidal\.com|audiomack\.com|google\.com|paypal\.(me|com)|cash\.app|venmo\.com|ko-fi\.com|buymeacoffee\.com|stan\.store|komi\.io|laylo\.com|feature\.fm|hyperfollow\.com|bit\.ly|tinyurl\.com|onlyfans\.com|fanlink\.tv|untitled\.stream|push\.fm|song\.link|album\.link|odesli\.co|toneden\.io|show\.co|tr\.ee|snd\.sc)$/i
const LINK_IN_BIO = /(^|\.)(linktr\.ee|beacons\.ai|hoo\.be|solo\.to|lnk\.bio|bio\.link|stan\.store|komi\.io|tr\.ee)$/i
const ALLOWED = [
  [/spotify\.com|spoti\.fi/, 'Spotify'],
  [/music\.apple\.com|itunes\.apple\.com/, 'Apple Music'],
  [/music\.youtube\.com|youtube\.com|youtu\.be/, 'YouTube Music'],
  [/soundcloud\.com|snd\.sc/, 'SoundCloud'],
  [/bandsintown\.com/, 'Bandsintown'],
  [/beatstars\.com|bsta\.rs|airbit\.com|traktrain\.com/, 'BeatStars']
]
const NON_ARTIST = /(records|recordings|lyrics?|playlist|music group|entertainment|promo|radio|\btv\b|news|blog|magazine|mag$|label|media$|podcast|curator|submit|submissions|plugs?$|marketing|agency|studio$|venue|festival|fan ?page|fan ?account|updates|daily|hq$|charts?|archives?|collective$|network$|global|connect|stan |fan(s|base)?\b|reacts?|edits$)/i

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '')
const hostOf = (u) => {
  try {
    return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}
const deob = (t) => String(t || '').replace(/\s*[[(<{]\s*at\s*[\])>}]\s*/gi, '@').replace(/\s*[[(<{]\s*dot\s*[\])>}]\s*/gi, '.')
function bestEmail(text) {
  const found = []
  for (const line of deob(text).split(/\n|\|/)) {
    for (const m of line.match(EMAIL_RE) || []) {
      const e = m.replace(/\.+$/, '').toLowerCase()
      if (BAD_EMAIL.test(e)) continue
      found.push({ e, score: /book|business|manag|contact|inquir|enquir|collab|press|feature|📧|✉/i.test(line) ? 2 : 1 })
    }
  }
  return found.sort((a, b) => b.score - a.score)[0]?.e || ''
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jitter = () => sleep(1800 + Math.random() * 2200) // human-ish pacing between X calls
async function fetchText(url, ms = 10000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(/^https?:/i.test(url) ? url : `https://${url}`, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/130' } })
    return r.ok ? (await r.text()).slice(0, 400000) : ''
  } catch {
    return ''
  } finally {
    clearTimeout(t)
  }
}

/* ---------------- Reverb shared list (read-only) ---------------- */
const taken = { names: new Set(), emails: new Set(), urls: new Set() }
if (useExclude) {
  const p = (process.env.ARTIST_REACH_CONTACTS || join(homedir(), 'Library/Application Support/reverb/artist-reach/contacts.json'))
  if (existsSync(p)) {
    try {
      for (const c of Object.values(JSON.parse(readFileSync(p, 'utf8')).contacts || {})) {
        if (c.email) taken.emails.add(String(c.email).toLowerCase())
        if (c.name) taken.names.add(slug(c.name))
        if (c.profileUrl || c.profile_url) taken.urls.add(String(c.profileUrl || c.profile_url).toLowerCase())
      }
    } catch {
      /* ignore */
    }
  }
}

/* ---------------- X GraphQL operation metadata ---------------- */
// queryIds rotate when X ships a new web build; fa0311/twitter-openapi tracks them (same source opencli uses).
const FALLBACK = {
  SearchTimeline: { queryId: 'vLHjqbDv7TPFMBkIIO1nOA' },
  UserTweets: { queryId: '7_KBXBpG0zBPRN6UCIV0-w' }
}
let OPS = {}
try {
  const r = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json')
  if (r.ok) OPS = await r.json()
} catch {
  /* use fallback */
}
const flags = (v) => (Array.isArray(v) ? Object.fromEntries(v.map((k) => [k, true])) : v && typeof v === 'object' ? v : {})
const op = (name) => {
  const e = OPS[name] || {}
  return { queryId: e.queryId || FALLBACK[name].queryId, features: flags(e.features ?? e.featureSwitches), fieldToggles: flags(e.fieldToggles) }
}
const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

/* ---------------- browser session ---------------- */
let browser
let context
let ownBrowser = false
try {
  browser = await chromium.connectOverCDP(CDP, { timeout: 15000 })
  context = browser.contexts()[0]
} catch {
  // Agent Reach's browser closes itself after 10 idle minutes. Start the same profile as plain Chrome with a
  // debugging port (real keychain, so the saved X login cookies stay readable), then attach to it.
  const { spawn } = await import('node:child_process')
  const { execSync } = await import('node:child_process')
  try { if (execSync(`pgrep -f "user-data-dir=${PROFILE}" || true`).toString().trim()) {
    console.error(JSON.stringify({ ok: false, error: 'PROFILE_BUSY', hint: 'The Agent Reach Chrome profile is open without a debugging port (e.g. after a manual login). Quit that Chrome window (Cmd+Q) and run again.' }))
    process.exit(3)
  } } catch { /* ignore */ }
  spawn(CHROME, [`--user-data-dir=${PROFILE}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222', '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 20 && !browser; i++) {
    await sleep(1000)
    browser = await chromium.connectOverCDP(CDP, { timeout: 5000 }).catch(() => undefined)
  }
  if (!browser) throw new Error('Could not start Chrome with the Agent Reach profile')
  context = browser.contexts()[0]
  ownBrowser = true
}
const page = await context.newPage()
await page.goto('https://x.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined)
await sleep(500)
const ct0 = (await context.cookies('https://x.com')).find((c) => c.name === 'ct0')?.value
const authed = (await context.cookies('https://x.com')).some((c) => c.name === 'auth_token')
if (!ct0 || !authed) {
  console.error(JSON.stringify({ ok: false, error: 'NEED_LOGIN', hint: 'Log in to X in the Agent Reach browser first: agent-reach login twitter' }))
  await page.close().catch(() => undefined)
  process.exit(2)
}

let requests = 0
let rateLimited = false
async function gql(name, variables, method = 'GET') {
  if (requests >= maxRequests || rateLimited) return null
  requests++
  const o = op(name)
  const url = `/i/api/graphql/${o.queryId}/${name}`
  const call = () => page.evaluate(
    async ({ url, method, variables, o, ct0, bearer }) => {
      const headers = {
        authorization: `Bearer ${decodeURIComponent(bearer)}`,
        'x-csrf-token': ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'content-type': 'application/json'
      }
      let full = url
      const init = { method, headers, credentials: 'include' }
      if (method === 'GET') {
        const p = new URLSearchParams({ variables: JSON.stringify(variables), features: JSON.stringify(o.features) })
        if (Object.keys(o.fieldToggles).length) p.set('fieldToggles', JSON.stringify(o.fieldToggles))
        full += `?${p}`
      } else init.body = JSON.stringify({ variables, features: o.features, fieldToggles: o.fieldToggles })
      const r = await fetch(full, init)
      return { status: r.status, reset: r.headers.get('x-rate-limit-reset'), body: r.ok ? await r.json() : null }
    },
    { url, method, variables, o, ct0, bearer: BEARER }
  )
  let res
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try { res = await call() } catch (e) { stats.errors.push(`${name}: ${String(e.message).slice(0, 80)}`); await sleep(3000) }
  }
  if (!res) return null
  if (res.status === 429) {
    rateLimited = true
    stats.rateLimitedAt = new Date().toISOString()
    return null
  }
  if (!res.body) {
    stats.errors.push(`${name} HTTP ${res.status}`)
    return null
  }
  await jitter()
  return res.body
}

function walk(v, fn) {
  if (!v || typeof v !== 'object') return
  fn(v)
  for (const c of Array.isArray(v) ? v : Object.values(v)) if (c && typeof c === 'object') walk(c, fn)
}
function userRow(u) {
  if (!u?.rest_id) return null
  // X moved user fields out of `legacy` in 2026 (profile_bio, relationship_counts, location.location); read both shapes.
  const L = u.legacy || {}
  const B = u.profile_bio || {}
  const ents = B.entities || L.entities || {}
  const links = []
  for (const x of ents.url?.urls || []) if (x.expanded_url) links.push(x.expanded_url)
  for (const x of ents.description?.urls || []) if (x.expanded_url) links.push(x.expanded_url)
  return {
    id: u.rest_id,
    handle: u.core?.screen_name || L.screen_name,
    name: u.core?.name || L.name,
    bio: B.description || L.description || '',
    location: u.location?.location || L.location || '',
    followers: u.relationship_counts?.followers ?? L.followers_count ?? 0,
    links: [...new Set(links)],
    category: u.professional?.category?.[0]?.name || ''
  }
}

/* ---------------- run ---------------- */
const stats = { searches: searches.length, requests: 0, tweets: 0, users: 0, checked: 0, nonArtist: 0, taken: 0, followersOut: 0, outsideLocations: 0, hasWebsite: 0, noPlatformLink: 0, inactive: 0, noEmail: 0, withEmail: 0, errors: [] }
const cands = new Map() // id -> { user, lastPost, release, search }

for (const s of searches) {
  if (cands.size >= limit * 6) break
  let cursor
  for (let p = 0; p < pages; p++) {
    const vars = { rawQuery: s.q, count: 40, querySource: 'typed_query', product: s.product }
    if (cursor) vars.cursor = cursor
    const data = await gql('SearchTimeline', vars, 'POST')
    if (!data) break
    let next
    walk(data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions, (v) => {
      if (v.cursorType === 'Bottom' && v.value) next = v.value
      if (v.tweet_results?.result) {
        const t = v.tweet_results.result.tweet || v.tweet_results.result
        const u = userRow(t.core?.user_results?.result)
        if (!u) return
        stats.tweets++
        const when = Date.parse(t.legacy?.created_at || '')
        const prev = cands.get(u.id)
        if (!prev || (when && (!prev.lastPost || when > prev.lastPost))) {
          cands.set(u.id, { user: u, lastPost: when || prev?.lastPost, release: (t.note_tweet?.note_tweet_results?.result?.text || t.legacy?.full_text || '').replace(/https:\/\/t\.co\/\S+/g, '').trim(), search: s })
        }
      } else if (v.user_results?.result && v.__typename !== 'Tweet' && !v.tweet_results && s.product === 'People') {
        const u = userRow(v.user_results.result)
        if (u && !cands.has(u.id)) cands.set(u.id, { user: u, lastPost: null, release: '', search: s })
      }
    })
    if (!next || next === cursor) break
    cursor = next
  }
}
stats.users = cands.size

const leads = []
for (const c of cands.values()) {
  if (leads.length >= limit || rateLimited) break
  const u = c.user
  stats.checked++
  if (NON_ARTIST.test(u.name) || NON_ARTIST.test(u.handle) || /\b(we (curate|promote)|submit your|dm (for|us) (promo|features)|promotion services?)\b/i.test(u.bio)) { stats.nonArtist++; continue }
  const profileUrl = `https://x.com/${u.handle}`
  if (taken.names.has(slug(u.name)) || taken.urls.has(profileUrl.toLowerCase())) { stats.taken++; continue }
  if (u.followers < minFollowers || u.followers > maxFollowers) { stats.followersOut++; continue }
  if (!allLocations && OFF_TARGET.test(u.location)) { stats.outsideLocations++; continue }

  let links = [...u.links]
  const own = links.find((l) => { const h = hostOf(l); return h && !PLATFORM.test(h) })
  if (own && !includeSites) { stats.hasWebsite++; continue }

  let email = bestEmail(u.bio)
  let emailSource = email ? 'X bio' : ''
  // Linktree-style pages: find streaming links + email
  for (const l of links.filter((x) => LINK_IN_BIO.test(hostOf(x))).slice(0, 2)) {
    const html = await fetchText(l)
    for (const m of html.match(/https?:\/\/[^"'\s<>\\]+/g) || []) {
      const h = hostOf(m)
      if (ALLOWED.some(([re]) => re.test(h)) && !links.includes(m)) links.push(m)
      if (h && !PLATFORM.test(h) && !/linktr|beacons|cloudfront|googleapis|gstatic|sentry|schema\.org|w3\.org|facebook\.net|cdn|static/i.test(h) && !includeSites && /\.(com|net|org|co|io|music|band|ca|uk|au|nz|ie|de|nl|se|fm)$/.test(h)) {
        if (slug(h).includes(slug(u.name).slice(0, 8)) && slug(u.name).length >= 4) { c.ownViaTree = m }
      }
    }
    if (!email) {
      const mm = html.match(/mailto:([^"'?\s<>]+)/i)
      const e = mm ? decodeURIComponent(mm[1]).toLowerCase() : bestEmail(html.replace(/<[^>]+>/g, ' '))
      if (e && !BAD_EMAIL.test(e) && !/linktr|beacons/i.test(e)) { email = e; emailSource = l }
    }
  }
  if (c.ownViaTree) { stats.hasWebsite++; continue }
  const dom = email.split('@')[1] || ''
  const s = slug(u.name)
  if (email && !includeSites && !FREE_MAIL.test(dom)) { stats.hasWebsite++; continue } // label/manager/own domain = has a site
  if (!email) { stats.noEmail++; continue }
  if (taken.emails.has(email)) { stats.taken++; continue }

  // must be on one of the 5 platforms (from bio, Linktree, or the release tweet's link)
  const platformHits = []
  for (const l of links) for (const [re, label] of ALLOWED) if (re.test(hostOf(l)) && !platformHits.find((p) => p.label === label)) platformHits.push({ label, url: l })
  if (!platformHits.length && !anyPlatform) { stats.noPlatformLink++; continue }

  // activity: People-search hits have no post date yet -> read their latest posts
  if (!c.lastPost) {
    const d = await gql('UserTweets', { userId: u.id, count: 10, includePromotedContent: false, withQuickPromoteEligibilityTweetFields: false, withVoice: true })
    walk(d, (v) => {
      const t = v.tweet_results?.result?.tweet || v.tweet_results?.result
      const when = Date.parse(t?.legacy?.created_at || '')
      if (when && (!c.lastPost || when > c.lastPost)) { c.lastPost = when; if (!c.release) c.release = (t.legacy?.full_text || '').replace(/https:\/\/t\.co\/\S+/g, '').trim() }
    })
  }
  const days = c.lastPost ? Math.round((Date.now() - c.lastPost) / 86400000) : null
  if (days == null || days > maxDays) { stats.inactive++; continue }

  stats.withEmail++
  leads.push({
    name: u.name,
    role: c.search.role || (/producer|beats?\b|prod\.|beatmaker/i.test(`${u.name} ${u.bio}`) ? 'producer' : /\bband\b/i.test(u.bio) ? 'band' : 'artist'),
    email,
    email_source: emailSource,
    found_on: platformHits[0]?.label || 'X',
    profile_url: platformHits[0]?.url || profileUrl,
    other_links: [profileUrl, ...links.filter((l) => l !== platformHits[0]?.url)].slice(0, 8),
    city: c.search.city || u.location || '',
    genre: c.search.genre || '',
    latest_release: c.release ? `${c.release.slice(0, 140)} (${new Date(c.lastPost).toISOString().slice(0, 10)})` : '',
    recent_show: '',
    found_pages: ['X', ...platformHits.map((p) => p.label)].slice(0, 5),
    detail: u.bio.slice(0, 200),
    followers: u.followers,
    x_handle: `@${u.handle}`,
    location: u.location,
    last_post_days: days
  })
}

stats.requests = requests
stats.rateLimited = rateLimited
leads.sort((a, b) => b.followers - a.followers)
const result = { stats, leads }
const json = JSON.stringify(result, null, 2)
if (out) writeFileSync(out, json)
console.log(json)
await page.close().catch(() => undefined)
process.exit(0) // just disconnect; Agent Reach browser keeps running
