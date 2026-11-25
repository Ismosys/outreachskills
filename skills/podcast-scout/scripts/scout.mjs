#!/usr/bin/env node
// Podcast scout: independent podcasters with NO website of their own and a public email,
// in English-speaking storefronts. Apple's free iTunes Search API -> each show's public RSS feed
// (owner email in <itunes:email>, website in <link>, Patreon in <podcast:funding> or the show notes).
// Output: JSON { stats, leads } on stdout, leads in the Artist Reach format (role "podcaster").
//
//   node scout.mjs --terms "comedy,true crime" [--countries US,GB,CA,AU,IE,NZ] [--limit 50]
//                  [--active-days 60] [--min-episodes 8] [--patreon-only]

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const flag = (n) => argv.includes(`--${n}`)
const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean)

const terms = list(arg('terms', 'comedy podcast'))
const countries = list(arg('countries', 'US,GB,CA,AU,IE,NZ'))
const LIMIT = Number(arg('limit', '50'))
const ACTIVE_DAYS = Number(arg('active-days', '60'))
const MIN_EPISODES = Number(arg('min-episodes', '8'))
const PATREON_ONLY = flag('patreon-only')
// Apple ranks the biggest shows first; independents sit further down the results.
const SKIP_TOP = Number(arg('skip-top', '30'))
const MAX_EPISODES = Number(arg('max-episodes', '700'))

// Hosting / aggregator pages = no website of their own.
const HOSTS = /(^|\.)(anchor\.fm|spotify\.com|spotifyforcreators\.com|creators\.spotify\.com|podcasters\.spotify\.com|spreaker\.com|podbean\.com|buzzsprout\.com|libsyn\.com|simplecast\.com|captivate\.fm|transistor\.fm|podomatic\.com|soundcloud\.com|acast\.com|shows\.acast\.com|redcircle\.com|fireside\.fm|blubrry\.com|blubrry\.net|megaphone\.fm|art19\.com|omny\.fm|omnystudio\.com|audioboom\.com|pinecast\.com|apple\.com|apple\.co|linktr\.ee|beacons\.ai|bit\.ly|podtail\.com|podchaser\.com|riverside\.fm|zencast\.fm|podcastpage\.io|podpage\.com|rss\.com|iheart\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|patreon\.com|twitter\.com|x\.com|substack\.com|feedburner\.com|podnews\.net|castos\.com|whooshkaa\.com|hubhopper\.com|pod\.link|podlink\.to|lnk\.to|feeds\.\w+)$/i
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|hey)\./i
// Host-generated relay addresses are not a real inbox the podcaster reads.
const RELAY_MAIL = /@(anchor\.fm|spotify\.com|buzzsprout\.com|podbean\.com|libsyn\.com|spreaker\.com|redcircle\.com|acast\.com|megaphone\.fm|simplecast\.com|captivate\.fm|transistor\.fm|riverside\.fm|rss\.com|example\.com)$|^(no-?reply|noreply|donotreply|podcasts?@|feeds?@)/i
const OFF_TARGET = /nigeria|lagos|abuja|naija|9ja|ghana|accra|kenya|nairobi|india|mumbai|delhi|pakistan|bangladesh|philippines|manila|uganda|rwanda|zambia|zimbabwe|tanzania|cameroon|south africa|johannesburg|brasil|brazil|indonesia|malaysia/i
// Networks, companies, churches and media brands are not independent podcasters.
const NOT_INDIE = /\b(network|networks|media|studios?|productions?|digital|presents|podcasts? inc|headgum|wave|dear media|amazon|all things comedy|evergreen|glassbox|lipstick nancy|sirius|siriusxm|spotify studios|cumulus|audacy|cadence13|podcastone|kast|earwolf|stitcher|gimlet|the ringer|ringer|barstool|crooked|pushkin|lemonada|wonder media|shondaland|higher ground|exactly right|big money players|paramount|nbc|cnn|fox|sony|universal|warner|studio71|night owl|team coco|rooster teeth|goalhanger|global|bauer|audioboom studios|somethin' else|keep it light|meateater|ramble|odyssey|qcode|realm|pod people|wondery|tenderfoot|campside|imperative|ballen|rotten mango|parcast|simon & schuster|penguin|harpercollins|forbes|cbs|hbo|netflix|espn|nfl|nba|radio|fm\b|news|iheart|npr|bbc|abc|cbc|wondery|audible|church|ministr(y|ies)|sermons?|parish|university|college|school district|council|government|official podcast of|inc\.?$|llc$|ltd$|plc$)\b/i
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const stats = { searched: 0, shows: 0, checked: 0, kept: 0, noEmail: 0, relayEmail: 0, hasWebsite: 0, inactive: 0, tooNew: 0, notEnglish: 0, offTarget: 0, notIndie: 0, notPatreon: 0, taken: 0, feedError: 0, patreon: 0 }

// Reverb's shared "never twice" list (read-only here; the runner reserves).
let taken = {}
try { taken = JSON.parse(readFileSync((process.env.ARTIST_REACH_CONTACTS || join(homedir(), 'Library/Application Support/reverb/artist-reach/contacts.json')), 'utf8')).contacts || {} } catch {}

async function get(url, ms = 15000, as = 'text') {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return as === 'json' ? await r.json() : await r.text()
  } finally { clearTimeout(t) }
}
const decode = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const first = (xml, re) => { const m = xml.match(re); return m ? decode(m[1]) : '' }
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, '').toLowerCase() } catch { return '' } }

function parse(xml) {
  const parts = xml.split(/<item[\s>]/i)
  const head = parts[0]
  const items = parts.slice(1, 4).join(' ')
  const email = (first(head, /<itunes:email>([\s\S]*?)<\/itunes:email>/i) || first(head, /<googleplay:email>([\s\S]*?)<\/googleplay:email>/i) || first(head, /<managingEditor>([^<(]+)/i)).toLowerCase().trim()
  let link = ''
  for (const m of head.matchAll(/<link>\s*([^<]+?)\s*<\/link>/gi)) if (/^https?:\/\//i.test(m[1])) { link = m[1].trim(); break }
  const funding = [...head.matchAll(/<podcast:funding[^>]*url="([^"]+)"/gi)].map((m) => m[1])
  const patreonUrl = funding.find((u) => /patreon\.com/i.test(u)) || ((head + items).match(/https?:\/\/(?:www\.)?patreon\.com\/(?!login|signup|join\b)[\w-]+/i) || [])[0] || ''
  const dates = [...xml.matchAll(/<pubDate>\s*([^<]+)\s*<\/pubDate>/gi)].map((m) => Date.parse(m[1])).filter((t) => !Number.isNaN(t))
  return {
    email,
    link,
    title: first(head, /<title>([\s\S]*?)<\/title>/i),
    author: first(head, /<itunes:author>([\s\S]*?)<\/itunes:author>/i) || first(head, /<itunes:owner>[\s\S]*?<itunes:name>([\s\S]*?)<\/itunes:name>/i),
    language: first(head, /<language>([\s\S]*?)<\/language>/i).toLowerCase(),
    description: first(head, /<description>([\s\S]*?)<\/description>/i).slice(0, 600),
    latestEpisode: first(parts[1] || '', /<title>([\s\S]*?)<\/title>/i),
    lastEp: dates.length ? Math.max(...dates) : NaN,
    episodes: parts.length - 1,
    patreonUrl
  }
}

// Search every term in every storefront, dedupe by feed URL.
const shows = new Map()
for (const term of terms) for (const cc of countries) {
  stats.searched++
  try {
    const j = await get(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=podcast&limit=200&country=${cc}`, 20000, 'json')
    for (const r of (j.results || []).slice(SKIP_TOP)) if (r.feedUrl && !shows.has(r.feedUrl)) shows.set(r.feedUrl, { ...r, term, cc })
  } catch {}
}
stats.shows = shows.size

// Some feeds use a sentence as the title ("X is a paranormal podcast with..."): keep the show's name only.
const showName = (t) => { let n = String(t || '').split(/\s+(?:is an?|[-–—|])\s+/i)[0].trim(); if (n.length > 45 && n.includes(':')) n = n.split(':')[0].trim(); return n.replace(/[.!]+$/, '') }
const leads = []
const seen = new Set()
const queue = [...shows.values()].sort(() => Math.random() - 0.5)
const cutoff = Date.now() - ACTIVE_DAYS * 86400000

async function check(s) {
  stats.checked++
  if (NOT_INDIE.test(s.artistName || '') || NOT_INDIE.test(s.collectionName || '')) return void stats.notIndie++
  let f
  try { f = parse(await get(s.feedUrl)) } catch { return void stats.feedError++ }
  if (!EMAIL_RE.test(f.email)) return void stats.noEmail++
  if (RELAY_MAIL.test(f.email)) return void stats.relayEmail++
  if (seen.has(f.email)) return
  if (taken[f.email]) return void stats.taken++
  const dom = f.email.split('@')[1]
  if (!FREE_MAIL.test(dom)) return void stats.hasWebsite++ // own-domain email = they have a site
  const h = hostOf(f.link)
  if (h && !HOSTS.test(h)) return void stats.hasWebsite++
  if (Number.isNaN(f.lastEp) || f.lastEp < cutoff) return void stats.inactive++
  if ((s.trackCount || f.episodes) < MIN_EPISODES) return void stats.tooNew++
  if ((s.trackCount || 0) > MAX_EPISODES) return void stats.notIndie++
  if (f.language && !/^en/.test(f.language)) return void stats.notEnglish++
  if (OFF_TARGET.test(`${f.title} ${f.author} ${f.description}`)) return void stats.offTarget++
  if (NOT_INDIE.test(f.author)) return void stats.notIndie++
  if (PATREON_ONLY && !f.patreonUrl) return void stats.notPatreon++
  seen.add(f.email)
  if (f.patreonUrl) stats.patreon++
  stats.kept++
  leads.push({
    name: showName(f.title || s.collectionName),
    role: 'podcaster',
    host: f.author || s.artistName || '',
    email: f.email,
    email_source: s.feedUrl,
    found_on: 'Apple Podcasts',
    profile_url: s.collectionViewUrl || s.feedUrl,
    other_links: [f.patreonUrl, f.link].filter(Boolean),
    genre: s.primaryGenreName || '',
    latest_release: f.latestEpisode ? `${f.latestEpisode} (${new Date(f.lastEp).toISOString().slice(0, 10)})` : '',
    found_pages: ['Apple Podcasts', ...(f.patreonUrl ? ['Patreon'] : [])],
    patreon: !!f.patreonUrl,
    episodes: s.trackCount || f.episodes,
    country: s.cc,
    term: s.term
  })
}

let i = 0
await Promise.all(Array.from({ length: 12 }, async () => {
  while (i < queue.length && leads.length < LIMIT) await check(queue[i++]).catch(() => stats.feedError++)
}))

console.log(JSON.stringify({ stats, leads }, null, 2))
