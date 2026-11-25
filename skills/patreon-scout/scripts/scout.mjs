#!/usr/bin/env node
// Patreon scout: small/medium Patreon musicians, bands, producers and podcasters with NO website and a public email.
// Patreon's public JSON API (no login): /api/search -> /api/campaigns/<id>?include=creator (about text, social links,
// currency, patron count) -> /api/posts (latest post = active). Email: Patreon about text, else the linked YouTube
// channel (description, video description, Linktree), using the same rules as youtube-artist-scout.
// Output: JSON { stats, leads } on stdout, leads in the Artist Reach format (found_on "Patreon", patreon: true).
//
//   node scout.mjs --queries "indie band,folk singer,true crime podcast" [--limit 40] [--max-patrons 2000]
//                  [--max-days 90] [--countries US,GB,CA,AU,NZ,IE,NL,DE,SE,DK,NO,BE,FI]

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(join(homedir(), '.claude/skills/youtube-artist-scout/scripts/'))
const { Innertube } = require('youtubei.js')

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean)
const queries = list(arg('queries', 'indie band,singer songwriter,podcast'))
const limit = Number(arg('limit', '40'))
const maxPatrons = Number(arg('max-patrons', '2000'))
const maxDays = Number(arg('max-days', '90'))
const COUNTRY_NAMES = { US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', IE: 'Ireland', NL: 'Netherlands', DE: 'Germany', SE: 'Sweden', DK: 'Denmark', NO: 'Norway', BE: 'Belgium', FI: 'Finland' }
const countries = list(arg('countries', 'US,GB,CA,AU,NZ,IE,NL,DE,SE,DK,NO,BE,FI')).map((c) => (COUNTRY_NAMES[c.toUpperCase()] || c).toLowerCase())
const CURRENCIES = /^(USD|GBP|EUR|CAD|AUD|NZD|SEK|DKK|NOK)$/i
const OFF_TARGET = /\b(nigeria|nigerian|naija|lagos|abuja|ibadan|port harcourt|enugu|benin city|ghana|ghanaian|accra|kumasi|kenya|nairobi|uganda|kampala|tanzania|zambia|zimbabwe|harare|cameroon|india|indian|mumbai|delhi|pakistan|karachi|lahore|bangladesh|philippines|manila|indonesia|jakarta|brazil|brasil|mexico|m[eé]xico|colombia|argentina|rwanda|adepr|kigali|nyamata|burundi|congo|kinshasa)\b/i
const NON_ARTIST = /( - topic$|vevo|records|recordings|lyrics?|tribute|karaoke|nightcore|slowed|reverb|8d audio|playlist|music group|entertainment|promo|radio|\btv\b|news|reaction|covers? channel|favs|compilation|instrumental|type beat|\bbeats$|label|\bofficial music$|stage ?dive|front row|\bfilms?$|\bproductions?$|live music|\bsessions$|\bconcerts?$|venue|festival|burger|\bbar$|\bclub$|podcast|interview|\bscene$|archives?|\bcollective$|\bnetwork$|magazine|\breacts?$|reactions?|\bedits$|asmr|hotels?|real estate|insider|travel|adventures|\bart$|\bvideos$|\bstudios?$|services|remaster|premiere|blog|tradu|translation|memorials|chef|explorer|radar|\bglobal$|vinyl|song lab|football|rewind|\bvibes$|\bmoments$|\bcreations$|production division|marketing|\bofficial channel$|folk songs|extreme ?underground|\blab$|university|\bflix$|uploads?|we plug|\bgood music$|break ?down|podcast| with .+ & |yesterday|oldies|gangsta beatz|\bshow$|\bmedia$|\bdigital$|traffic|new songs|music for people|\bpics$|tv music|bvtv|guest list|gameplay|gaming|next up|\bdesk$|\bcommunity$|mezmur|guitar lab|rundown|\bbgm\b|\bch\.|pulse$|\bke$|\bng$|\bgh$|naija|9ja|recaps?|theology|bible|\bkids|lorecore|\bai$|\bchannel$|unreleased|\btapes$|hitz$|vibes$|\bempire$|memories$|oud chill|mixtapes?|254|\bdnb$|afroswing$|cool jazz|lo-?fi|filmz|\bsets$|lounge|hi-?fi|\bfm$|soundcheck|vault|\bcollect$|house of music|hymns|apostolic|anime|archivist|opportunes|\bstudio\b|music room|caf[eé]|\bdance$|\blens$|rpg|gaming|has to say|\bdreams$|\blife$|media music|none but music|review|\btalk$|living in|underground live|b-boys|\bbites$|\blines$)/i
const PLATFORM = /(^|\.)(beatstars\.com|bsta\.rs|airbit\.com|traktrain\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.com|twitter\.com|x\.com|tiktok\.com|spotify\.com|apple\.com|soundcloud\.com|bandcamp\.com|linktr\.ee|beacons\.ai|hoo\.be|solo\.to|lnk\.bio|bio\.link|linkfire\.com|lnk\.to|ffm\.to|ffm\.bio|smarturl\.it|distrokid\.com|bandsintown\.com|songkick\.com|patreon\.com|twitch\.tv|discord\.(gg|com)|threads\.(net|com)|snapchat\.com|amazon\.com|deezer\.com|tidal\.com|audiomack\.com|google\.com|support\.google\.com|paypal\.(me|com)|cash\.app|venmo\.com|ko-fi\.com|buymeacoffee\.com|teespring\.com|bigcartel\.com|stan\.store|komi\.io|laylo\.com|feature\.fm|hyperfollow\.com|bit\.ly|tinyurl\.com)$/i
const LINK_IN_BIO = /(^|\.)(linktr\.ee|beacons\.ai|hoo\.be|solo\.to|lnk\.bio|bio\.link|stan\.store|komi\.io)$/i
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|^(example|email|name|test|noreply|no-reply)@|@(example|domain|sentry|wixpress)\./i
const str = (v) => (v == null ? '' : typeof v === 'string' ? v : v.toString ? v.toString() : String(v))
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '')
const hostOf = (u) => {
  try {
    return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}
const deob = (t) => t.replace(/\s*[[(<{]\s*at\s*[\])>}]\s*/gi, '@').replace(/\s*[[(<{]\s*dot\s*[\])>}]\s*/gi, '.')
function bestEmail(text) {
  const found = []
  for (const line of deob(text || '').split('\n')) {
    for (const m of line.match(EMAIL_RE) || []) {
      const e = m.replace(/\.+$/, '').toLowerCase()
      if (BAD_EMAIL.test(e)) continue
      found.push({ e, score: /book|business|manag|contact|inquir|enquir|collab|press|feature/i.test(line) ? 2 : 1 })
    }
  }
  return found.sort((a, b) => b.score - a.score)[0]?.e || ''
}
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


function parseCount(s) {
  const m = str(s).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i)
  if (!m) return 0
  return Math.round(Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1))
}
async function pLimit(items, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]).catch(() => undefined)
  }))
}

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|hey)\./i
const NOT_SITE = /(^|\.)(wikipedia\.org|imdb\.com|reddit\.com|discord\.gg|discord\.com|t\.me|vimeo\.com|twitch\.tv|kick\.com|rumble\.com|odysee\.com|substack\.com|medium\.com|etsy\.com|redbubble\.com|teepublic\.com|merchbar\.com|shopify\.com|bandcamp\.com|apple\.co|podcasts\.apple\.com|anchor\.fm|buzzsprout\.com|podbean\.com|libsyn\.com|spreaker\.com|acast\.com|simplecast\.com|captivate\.fm|transistor\.fm|redcircle\.com|amzn\.to|gofundme\.com|kickstarter\.com|indiegogo\.com|streamlabs\.com|throne\.com|gumroad\.com|onlyfans\.com|fansly\.com|cameo\.com|threads\.net|bsky\.app|mastodon\.social|tumblr\.com|pinterest\.com|linkedin\.com|goo\.gl|forms\.gle|docs\.google\.com|drive\.google\.com|dropbox\.com|mailchi\.mp|eepurl\.com|youtu\.be)$/i
const MUSIC = /\bmusic|musician|song|songwriter|singer|album|\bep\b|\bband\b|rapper|\brap\b|hip.?hop|producer|beats?\b|composer|guitar|piano|vocal|record(ing)?s?\b|tracks?\b|\bdj\b|metal|punk|folk|indie|jazz|soul|r&b|gospel|choir/i
const PODCAST = /podcast|\bpod\b|episodes?\b|\bshow\b|audio drama/i
const NOT_INDIE = /\b(network|media group|studios|productions inc|radio station|news|church|ministr(y|ies)|university|school|official|inc\.?$|llc$|ltd$)\b/i
const NON_FIT = /\b(yoga|meditation|asmr|tarot|astrology|comic|webcomic|cosplay|3d print|miniatures?|game dev|indie game|novel|fiction|fanfic|illustrat|painting|drawing|animation|vtuber|minecraft|roblox|tutorials?|lessons?|teacher|course|nsfw|lewd|adult)\b/i

const stats = { searched: 0, hits: 0, checked: 0, kept: 0, nsfw: 0, tooBig: 0, notFit: 0, inactive: 0, offTarget: 0, hasWebsite: 0, noEmail: 0, taken: 0, errors: 0 }
let taken = {}
try { taken = JSON.parse(readFileSync((process.env.ARTIST_REACH_CONTACTS || join(homedir(), 'Library/Application Support/reverb/artist-reach/contacts.json')), 'utf8')).contacts || {} } catch {}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(path) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(`https://www.patreon.com/api/${path}${path.includes('?') ? '&' : '?'}json-api-version=1.0`, { headers: { 'User-Agent': UA, Accept: 'application/vnd.api+json' } }).catch(() => null)
    if (r && r.ok) return r.json()
    if (r && r.status === 404) return null
    await sleep(2000 * (a + 1))
  }
  throw new Error(`Patreon API failed: ${path.slice(0, 60)}`)
}
const textOf = (html) => str(html).replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<a [^>]*href="([^"]+)"[^>]*>/gi, ' $1 ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'")

// 1) search
const camps = new Map()
for (const q of queries) {
  for (let page = 1; page <= 2; page++) {
    stats.searched++
    let j
    try { j = await api(`search?q=${encodeURIComponent(q)}&page%5Bnumber%5D=${page}&page%5Bsize%5D=50`) } catch { stats.errors++; break }
    for (const d of j?.data || []) {
      stats.hits++
      const a = d.attributes || {}
      const id = String(d.id).replace(/^campaign_/, '')
      if (camps.has(id)) continue
      if (a.is_nsfw) { stats.nsfw++; continue }
      if (a.patron_count != null && a.patron_count > maxPatrons) { stats.tooBig++; continue }
      camps.set(id, { id, name: str(a.name).trim(), creation: str(a.creation_name), url: a.url, patrons: a.patron_count, query: q })
    }
    if (!j || (j.meta?.pages_total || 1) <= page) break
    await sleep(800)
  }
}

// 2) check each creator
const yt = await Innertube.create({ retrieve_player: false }).catch(() => null)
const leads = []
const seen = new Set()
await pLimit([...camps.values()].sort(() => Math.random() - 0.5), 4, async (c) => {
  if (leads.length >= limit) return
  stats.checked++
  const j = await api(`campaigns/${c.id}?include=creator`).catch(() => null)
  if (!j) return void stats.errors++
  const a = j.data.attributes
  const u = (j.included || []).find((x) => x.type === 'user')?.attributes || {}
  const about = `${textOf(a.summary)}\n${textOf(u.about)}`
  const blob = `${c.name} ${c.creation} ${a.one_liner || ''} ${about}`
  const isPod = PODCAST.test(`${c.name} ${c.creation} ${a.one_liner || ''}`) || (/podcast/i.test(c.query) && PODCAST.test(blob))
  if (!(isPod || MUSIC.test(blob)) || NON_FIT.test(`${c.name} ${c.creation} ${a.one_liner || ''}`)) return void stats.notFit++
  if (NOT_INDIE.test(c.name)) return void stats.notFit++
  if (/react(s|ion|ing)?\b|reacts|\breview|\bfans\b|commentary|\bnews\b/i.test(`${c.name} ${c.creation}`)) return void stats.notFit++
  if (a.currency && !CURRENCIES.test(a.currency)) return void stats.offTarget++
  if (OFF_TARGET.test(blob)) return void stats.offTarget++
  // active: latest post within maxDays
  const p = await api(`posts?filter%5Bcampaign_id%5D=${c.id}&sort=-published_at&page%5Bsize%5D=1&fields%5Bpost%5D=title,published_at`).catch(() => null)
  const last = p?.data?.[0]?.attributes
  const days = last ? (Date.now() - Date.parse(last.published_at)) / 86400000 : Infinity
  if (days > maxDays) return void stats.inactive++

  const social = u.social_connections || {}
  const socials = Object.values(social).map((s) => s && s.url).filter(Boolean)
  const links = [...new Set([...socials, ...(about.match(/https?:\/\/[^\s"'<>)]+/g) || [])])]
  const siteOf = (arr) => arr.find((x) => { const h = hostOf(x); return h && !PLATFORM.test(h) && !NOT_SITE.test(h) && !/patreon/.test(h) })
  if (siteOf(links)) { if (process.env.DEBUG) console.error("site:", c.name, siteOf(links)); return void stats.hasWebsite++ }
  let email = bestEmail(about)
  let emailSource = email ? `${a.url} (about)` : ''

  // YouTube channel: country, links, email
  const ytId = social.youtube?.user_id || (str(social.youtube?.url).match(/channel\/(UC[\w-]{20,})/) || [])[1]
  let country = ''
  let subs = null
  if (ytId && yt) {
    try {
      const md = (await (await yt.getChannel(ytId)).getAbout()).metadata
      country = str(md.country)
      subs = parseCount(md.subscriber_count)
      const ylinks = (md.links || []).map((l) => str(l.link) || str(l.url)).filter(Boolean)
      for (const l of ylinks) if (!links.includes(l)) links.push(l)
      if (siteOf(ylinks)) return void stats.hasWebsite++
      if (!email) { email = bestEmail(str(md.description)); if (email) emailSource = `https://www.youtube.com/channel/${ytId} (description)` }
      // Artists often put "Booking: ..." in their latest video's description instead.
      if (!email) {
        try {
          const ch = await yt.getChannel(ytId)
          const vids = await ch.getVideos()
          const v = (vids.videos || [])[0]
          const vid = v?.id || v?.video_id
          if (vid) {
            const vdesc = str((await yt.getBasicInfo(vid)).basic_info?.short_description)
            const ve = bestEmail(vdesc)
            if (ve) { email = ve; emailSource = `https://www.youtube.com/watch?v=${vid} (description)` }
            for (const m of vdesc.match(/https?:\/\/[^\s)]+/g) || []) if (!links.includes(m)) links.push(m)
          }
        } catch { /* no videos tab */ }
      }
    } catch { /* channel gone or private */ }
  }
  if (country && !countries.includes(country.toLowerCase())) return void stats.offTarget++
  if (!email) {
    for (const l of links.filter((x) => LINK_IN_BIO.test(hostOf(x))).slice(0, 2)) {
      const html = await fetchText(l)
      if (siteOf((html.match(/https?:\/\/[^"'\s<>\\]+/g) || []).filter((x) => !/linktr|beacons|cdn|static|fonts|schema\.org|w3\.org|google|sentry|cloudfront/i.test(x)).slice(0, 40))) return void stats.hasWebsite++
      const m = html.match(/mailto:([^"'?\s<>]+)/i)
      const e = m ? decodeURIComponent(m[1]).toLowerCase() : bestEmail(html.replace(/<[^>]+>/g, ' '))
      if (e && !BAD_EMAIL.test(e) && !/linktr|beacons/i.test(e)) { email = e; emailSource = l; break }
    }
  }
  if (!email) { if (process.env.DEBUG) console.error("noemail:", c.name, ytId ? "yt" : "-", links.map(hostOf).join(",")); return void stats.noEmail++ }
  if (!FREE_MAIL.test(email.split('@')[1] || '')) return void stats.hasWebsite++ // own-domain email = has a site
  if (taken[email] || seen.has(email)) return void stats.taken++
  seen.add(email)
  const role = isPod ? 'podcaster' : /producer|beats?\b|type beat/i.test(`${c.name} ${c.creation}`) ? 'producer' : /\bband\b/i.test(`${c.creation} ${c.query}`) ? 'band' : 'artist'
  const pages = ['Patreon', ...new Set(links.map(hostOf).map((h) => (/youtube/.test(h) ? 'YouTube' : /instagram/.test(h) ? 'Instagram' : /spotify/.test(h) ? 'Spotify' : /tiktok/.test(h) ? 'TikTok' : /twitter|x\.com/.test(h) ? 'X' : /facebook/.test(h) ? 'Facebook' : /soundcloud/.test(h) ? 'SoundCloud' : '')).filter(Boolean))]
  stats.kept++
  if (leads.length < limit) leads.push({
    name: c.name, role, host: role === 'podcaster' ? (u.full_name || '') : '', email, email_source: emailSource,
    found_on: 'Patreon', profile_url: a.url, other_links: links.slice(0, 8), patreon: true,
    genre: c.query.replace(/\b(band|musician|singer|songwriter|producer|podcast|artist)\b/gi, '').trim(),
    latest_release: '', found_pages: pages.slice(0, 4), patrons: a.patron_count ?? c.patrons, subscribers: subs,
    country, last_post_days: Math.round(days), currency: a.currency
  })
})

console.log(JSON.stringify({ stats, leads }, null, 2))
