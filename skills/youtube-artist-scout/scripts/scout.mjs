#!/usr/bin/env node
/**
 * YouTube artist scout (youtubei.js — YouTube's own InnerTube API, no key, no quota).
 *
 * Finds active independent musicians on YouTube by genre × city, reads each
 * channel's About tab (description, links, country, subscribers, hidden-email
 * flag), pulls a public contact email (description or Linktree-style page),
 * drops anyone with their own website or already on Reverb's shared list, and
 * writes leads in the Artist Reach Drafter paste format.
 *
 * Usage:
 *   node scout.mjs --genres "punk,indie" --cities "Denver,Chicago" [--pages 2] [--upload year]
 *                  [--min-subs 300] [--max-subs 250000] [--max-days 180] [--limit 100]
 *                  [--countries "US,GB,CA,AU,NZ,IE"] [--out leads.json] [--include-sites] [--no-exclude]
 *   node scout.mjs --query "emo band austin" --query "drill uk london"
 */
import { Innertube } from 'youtubei.js'
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

const genres = list(arg('genres', ''))
const cities = list(arg('cities', ''))
const pages = Math.max(1, Math.min(6, Number(arg('pages', '2'))))
const upload = arg('upload', 'year') // hour | today | week | month | year
const minSubs = Number(arg('min-subs', '300'))
const maxSubs = Number(arg('max-subs', '250000'))
const maxDays = Number(arg('max-days', '180'))
const limit = Number(arg('limit', '150'))
const out = arg('out', '')
const includeSites = flag('include-sites')
const useExclude = !flag('no-exclude')
// Channels with no country set: drop ones whose description/name points clearly outside the target countries.
const OFF_TARGET = /\b(nigeria|nigerian|naija|lagos|abuja|ibadan|port harcourt|enugu|benin city|ghana|ghanaian|accra|kumasi|kenya|nairobi|uganda|kampala|tanzania|zambia|zimbabwe|harare|cameroon|india|indian|mumbai|delhi|pakistan|karachi|lahore|bangladesh|philippines|manila|indonesia|jakarta|brazil|brasil|mexico|m[eé]xico|colombia|argentina|rwanda|adepr|kigali|nyamata|burundi|congo|kinshasa)\b/i
// Channel country must be one of these (channels with no country set are kept).
const COUNTRY_NAMES = { US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', IE: 'Ireland', NL: 'Netherlands', DE: 'Germany', SE: 'Sweden', DK: 'Denmark', NO: 'Norway', BE: 'Belgium', FI: 'Finland', FR: 'France', ES: 'Spain', IT: 'Italy' }
const countries = list(arg('countries', 'US,GB,CA,AU,NZ,IE')).map((c) => COUNTRY_NAMES[c.toUpperCase()] || c)

const roles = list(arg('roles', 'artists,bands,producers')).map((r) => r.toLowerCase())
const roleOf = new Map() // query -> 'artist' | 'band' | 'producer'
const queries = [...all('query')]
const addQ = (q, role) => { q = q.replace(/\s+/g, ' ').trim(); if (!roleOf.has(q)) { roleOf.set(q, role); queries.push(q) } }
for (const g of genres.length ? genres : ['']) {
  for (const c of cities.length ? cities : ['']) {
    const where = c ? ` ${c}` : ''
    if (roles.includes('artists')) { addQ(`${g}${where} official music video`, 'artist'); addQ(`${g} artist${where} booking`, 'artist') }
    if (roles.includes('bands')) addQ(`${g} band${where} new single`, 'band')
    if (roles.includes('producers')) { addQ(`${g} producer${where} beats`, 'producer'); addQ(`${g} type beat${where}`, 'producer') }
    // Musicians who fund themselves on Patreon (patreon.com itself is blocked from this network, so find them through YouTube).
    if (roles.includes('patreon')) { addQ(`${g} musician patreon${where}`, 'artist'); addQ(`${g} original song patreon${where}`, 'artist') }
  }
}
if (!queries.length) {
  console.error('Give --genres/--cities or --query. Example: --genres "punk,indie" --cities "Denver,Chicago"')
  process.exit(1)
}

/* ---------------- helpers ---------------- */
const NON_ARTIST = /( - topic$|vevo|records|recordings|lyrics?|tribute|karaoke|nightcore|slowed|reverb|8d audio|playlist|music group|entertainment|promo|radio|\btv\b|news|reaction|covers? channel|favs|compilation|instrumental|type beat|\bbeats$|label|\bofficial music$|stage ?dive|front row|\bfilms?$|\bproductions?$|live music|\bsessions$|\bconcerts?$|venue|festival|burger|\bbar$|\bclub$|podcast|interview|\bscene$|archives?|\bcollective$|\bnetwork$|magazine|\breacts?$|reactions?|\bedits$|asmr|hotels?|real estate|insider|travel|adventures|\bart$|\bvideos$|\bstudios?$|services|remaster|premiere|blog|tradu|translation|memorials|chef|explorer|radar|\bglobal$|vinyl|song lab|football|rewind|\bvibes$|\bmoments$|\bcreations$|production division|marketing|\bofficial channel$|folk songs|extreme ?underground|\blab$|university|\bflix$|uploads?|we plug|\bgood music$|break ?down|podcast| with .+ & |yesterday|oldies|gangsta beatz|\bshow$|\bmedia$|\bdigital$|traffic|new songs|music for people|\bpics$|tv music|bvtv|guest list|gameplay|gaming|next up|\bdesk$|\bcommunity$|mezmur|guitar lab|rundown|\bbgm\b|\bch\.|pulse$|\bke$|\bng$|\bgh$|naija|9ja|recaps?|theology|bible|\bkids|lorecore|\bai$|\bchannel$|unreleased|\btapes$|hitz$|vibes$|\bempire$|memories$|oud chill|mixtapes?|254|\bdnb$|afroswing$|cool jazz|lo-?fi|filmz|\bsets$|lounge|hi-?fi|\bfm$|soundcheck|vault|\bcollect$|house of music|hymns|apostolic|anime|archivist|opportunes|\bstudio\b|music room|caf[eé]|\bdance$|\blens$|rpg|gaming|has to say|\bdreams$|\blife$|media music|none but music|review|\btalk$|living in|underground live|b-boys|\bbites$|\blines$|reacts|reactions?\b|\bfans$|full albums|train ?spotting|re-?up\b|\bartists$|wrestling|\bchurch\b|pastor|ministr|gigs with|torture chamber)/i
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
function parseCount(s) {
  const m = str(s).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i)
  if (!m) return 0
  return Math.round(Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1))
}
function daysAgo(s) {
  const m = str(s).match(/(\d+)\s*(second|minute|hour|day|d\b|week|w\b|month|mo\b|year|y\b)/i)
  if (!m) return null
  const n = Number(m[1])
  const u = m[2].toLowerCase()
  if (/^(second|minute|hour)/.test(u)) return 0
  if (/^(day|d)$/.test(u) || u === 'day') return n
  if (/^(week|w)$/.test(u)) return n * 7
  if (/^(month|mo)$/.test(u)) return n * 30
  return n * 365
}
async function pLimit(items, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]).catch(() => undefined)
  }))
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

/* ---------------- Reverb shared list (read-only) ---------------- */
const taken = { names: new Set(), emails: new Set() }
if (useExclude) {
  const p = (process.env.ARTIST_REACH_CONTACTS || join(homedir(), 'Library/Application Support/reverb/artist-reach/contacts.json'))
  if (existsSync(p)) {
    try {
      for (const c of Object.values(JSON.parse(readFileSync(p, 'utf8')).contacts || {})) {
        if (c.email) taken.emails.add(String(c.email).toLowerCase())
        if (c.name) taken.names.add(slug(String(c.name)))
      }
    } catch {
      /* ignore */
    }
  }
}

/* ---------------- run ---------------- */
const yt = await Innertube.create({ retrieve_player: false, lang: 'en', location: 'US' })
const stats = { queries: queries.length, videos: 0, channels: 0, checked: 0, nonArtist: 0, taken: 0, oldOrInactive: 0, subsOut: 0, hasWebsite: 0, outsideCountries: 0, withEmail: 0, hiddenEmailOnly: 0, noEmail: 0 }
const cands = new Map()

for (const q of queries) {
  try {
    let res = await yt.search(q, { type: 'video', upload_date: upload })
    for (let p = 0; p < pages; p++) {
      for (const v of res.videos || []) {
        stats.videos++
        const id = v.author?.id
        const name = str(v.author?.name).trim()
        if (!id || !name) continue
        const d = daysAgo(v.published)
        const prev = cands.get(id)
        if (!prev || (d != null && (prev.days == null || d < prev.days))) {
          cands.set(id, { id, name, video: str(v.title), videoId: v.id || v.video_id, days: d, query: q, role: roleOf.get(q) || 'artist' })
        }
      }
      if (!res.has_continuation || p === pages - 1) break
      res = await res.getContinuation()
    }
  } catch (e) {
    console.error(`search failed: "${q}" (${e.message})`)
  }
}
stats.channels = cands.size

const leads = []
const hidden = []
const list_ = [...cands.values()].filter((c) => {
  const PROD_WORDS = /type beats?|instrumentals?|\bbeatz?\b|\bbeats\b|productions?|\bprod\.?\b|on the beat|beatmaker/gi
  const isProducerName = PROD_WORDS.test(c.name) || /type beat|prod\.? ?by|\(prod|instrumental/i.test(c.video)
  if (isProducerName) c.role = 'producer'
  if (NON_ARTIST.test(isProducerName ? c.name.replace(PROD_WORDS, '') : c.name)) { if (process.env.DEBUG_NONARTIST) console.error('name:', c.name); return stats.nonArtist++, false }
  if (taken.names.has(slug(c.name))) return stats.taken++, false
  if (c.days != null && c.days > maxDays) return stats.oldOrInactive++, false
  return true
})

await pLimit(list_, 4, async (c) => {
  if (leads.length >= limit) return
  stats.checked++
  const md = (await (await yt.getChannel(c.id)).getAbout()).metadata
  const subs = parseCount(md.subscriber_count)
  if (subs < minSubs || (maxSubs > 0 && subs > maxSubs)) return void stats.subsOut++
  const ctry = str(md.country)
  if (ctry && countries.length && !countries.some((x) => x.toLowerCase() === ctry.toLowerCase())) return void stats.outsideCountries++
  const desc = str(md.description)
  if (!ctry && (OFF_TARGET.test(desc) || OFF_TARGET.test(c.name) || OFF_TARGET.test(str(c.video)))) return void stats.outsideCountries++
  const links = (md.links || []).map((l) => str(l.link) || str(l.url)).filter(Boolean)
  const channelLinks = [...links]
  const linkHosts = links.map(hostOf)
  const s = slug(c.name)
  const site = links.find((u) => {
    const h = hostOf(u)
    return h && !PLATFORM.test(h) && (s.length >= 4 ? h.replace(/[^a-z0-9]/g, '').includes(s.slice(0, Math.max(4, Math.min(s.length, 12)))) : false)
  }) || links.find((u) => { const h = hostOf(u); return h && !PLATFORM.test(h) && !/\.(gov|edu)$/.test(h) && /official|website|site|home/i.test(u) })
  if (site && !includeSites) return void stats.hasWebsite++

  let email = bestEmail(desc)
  let emailSource = email ? 'YouTube channel description' : ''
  // Artists often put "Booking: …" in their video descriptions instead.
  let videoChecked = false
  if (!email && c.videoId) {
    videoChecked = true
    try {
      const info = await yt.getBasicInfo(c.videoId)
      const vdesc = str(info.basic_info?.short_description)
      const ve = bestEmail(vdesc)
      if (ve) {
        email = ve
        emailSource = `YouTube video description (${c.video.slice(0, 60)})`
      }
      for (const m of vdesc.match(/https?:\/\/[^\s)]+/g) || []) if (!links.includes(m)) links.push(m)
    } catch {
      /* skip */
    }
  }
  if (!email) {
    for (const u of links.filter((x) => LINK_IN_BIO.test(hostOf(x))).slice(0, 2)) {
      const html = await fetchText(u)
      for (const m of html.match(/https?:\/\/[^"'\s<>\\]+/g) || []) if (/(open\.spotify\.com|music\.apple\.com|soundcloud\.com|bandsintown\.com|music\.youtube\.com|patreon\.com\/)/i.test(m) && !links.includes(m)) links.push(m)
      const m = html.match(/mailto:([^"'?\s<>]+)/i)
      const e = m ? decodeURIComponent(m[1]).toLowerCase() : bestEmail(html.replace(/<[^>]+>/g, ' '))
      if (e && !BAD_EMAIL.test(e) && !/linktr|beacons/i.test(e)) {
        email = e
        emailSource = u
        break
      }
    }
  }
  // Reaction, review and affirmation channels show up a lot in Patreon searches: their videos give them away.
  if (/\breact(ion|s|ing)\b|album reviews?|\breview(s|ed)?\b|affirmations?|\bpodcast\b|\bepisode \d|\bep\.? ?\d|\bunboxing\b|\btutorial\b|\blesson\b|\bcover\b.*\breaction/i.test(str(c.video))) { if (process.env.DEBUG_NONARTIST) console.error('title:', c.name, '|', c.video); return void stats.nonArtist++ }
  // Real-artist check: a streaming/smart link (channel links, video description, Linktree) or an official release title.
  const STREAM = /(beatstars\.com|bsta\.rs|airbit\.com|traktrain\.com|open\.spotify\.com|spotify\.link|music\.apple\.com|itunes\.apple\.com|soundcloud\.com|bandsintown\.com|music\.youtube\.com|distrokid\.com|hyperfollow|lnk\.to|ffm\.to|song\.link|album\.link|feature\.fm|linkfire|smarturl|untitled\.stream)/i
  if (!links.some((u) => STREAM.test(u)) && c.videoId && !videoChecked) {
    try {
      const vdesc = str((await yt.getBasicInfo(c.videoId)).basic_info?.short_description)
      for (const m of vdesc.match(/https?:\/\/[^\s)]+/g) || []) if (!links.includes(m)) links.push(m)
    } catch { /* skip */ }
  }
  // An artist's own uploads usually carry their name: "Name - Song", "Song by Name", "Name | Song".
  const ownName = slug(c.name).replace(/(music|official|tv|band)$/,'')
  const titleHasName = ownName.length >= 3 && slug(c.video).includes(ownName)
  if (!titleHasName && !links.some((u) => STREAM.test(u)) && !/official (music )?(video|audio)|visuali[sz]er|lyric video|\(audio\)|new single|music video|official mv|\bmv\b|type beat|prod\.? ?by|\(prod/i.test(str(c.video))) { if (process.env.DEBUG_NONARTIST) console.error('proof:', c.name, '|', c.video); return void stats.nonArtist++ }
  if (email && taken.emails.has(email)) return void stats.taken++
  // An email on the artist's own domain (e.g. name@theirband.com) means they have a website.
  const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|hey)\./i
  const dom = email.split('@')[1] || ''
  // Any non-free-mail domain means the artist (or their label/manager) already runs a website.
  if (email && !includeSites && !FREE_MAIL.test(dom)) return void stats.hasWebsite++
  const foundPages = [...new Set(linkHosts.map((h) => (/instagram/.test(h) ? 'Instagram' : /spotify/.test(h) ? 'Spotify' : /tiktok/.test(h) ? 'TikTok' : /soundcloud/.test(h) ? 'SoundCloud' : /facebook/.test(h) ? 'Facebook' : /twitter|x\.com/.test(h) ? 'X' : /linktr|beacons|hoo\.be|solo\.to/.test(h) ? 'a Linktree' : /patreon/.test(h) ? 'Patreon' : /apple/.test(h) ? 'Apple Music' : '')).filter(Boolean))]
  const city = cities.find((x) => c.query.toLowerCase().includes(x.toLowerCase())) || ''
  const genre = genres.find((x) => c.query.toLowerCase().startsWith(x.toLowerCase())) || ''
  const row = {
    name: c.name,
    role: c.role,
    email,
    email_source: emailSource,
    found_on: 'YouTube Music',
    profile_url: `https://www.youtube.com/channel/${c.id}`,
    other_links: links.slice(0, 8).map((u) => (/^https?:/i.test(u) ? u : `https://${u}`)),
    city,
    genre,
    latest_release: c.video ? `${c.video.replace(/\s*[([](official|music|lyric|audio|video|visuali[sz]er)[^)\]]*[)\]]/gi, '').trim()}${c.days != null ? ` (${new Date(Date.now() - c.days * 86400000).toISOString().slice(0, 10)})` : ''}` : '',
    recent_show: '',
    found_pages: ['YouTube', ...foundPages].slice(0, 5),
    detail: '',
    subscribers: subs,
    country: str(md.country),
    has_website: !!site,
    patreon: links.some((u) => /patreon\.com\/(?!login|signup|join$)[\w-]/i.test(u)),
    hidden_business_email: !!md.sign_in_for_business_email
  }
  if (email) {
    stats.withEmail++
    leads.push(row)
  } else if (md.sign_in_for_business_email) {
    stats.hiddenEmailOnly++
    hidden.push(row)
  } else stats.noEmail++
})

leads.sort((a, b) => b.subscribers - a.subscribers)
const result = { stats, leads, hidden_email_only: hidden.map((h) => ({ name: h.name, profile_url: h.profile_url, subscribers: h.subscribers, other_links: h.other_links })) }
if (out) writeFileSync(out, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
