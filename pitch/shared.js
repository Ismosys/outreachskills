/* Artist Reach Drafter — helpers shared by the popup and the Gmail content script.
   Loaded as a plain script (no modules) so both contexts can use it. */
;(function (root) {
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i
  const PLATFORMS = ['Spotify', 'Apple Music', 'YouTube Music', 'SoundCloud', 'Bandsintown']
  const BATCH = 20

  const today = () => new Date().toISOString().slice(0, 10)

  /* ---------------- prompts for claude.ai ---------------- */

  const OUTPUT_SPEC = [
    'Reply with ONLY a JSON array in one code block, nothing else:',
    '```json',
    '[{"name": "", "email": "", "email_source": "where you saw the email", "found_on": "Spotify | Apple Music | YouTube Music | SoundCloud | Bandsintown", "profile_url": "", "other_links": [], "city": "", "genre": "", "latest_release": "title (YYYY-MM-DD)", "recent_show": "venue, city (YYYY-MM-DD)", "found_pages": ["what a search shows instead of a website, e.g. Instagram, SoundCloud, a Bandsintown page"], "detail": "one specific, true detail for a friendly pitch"}]',
    '```'
  ].join('\n')

  /** First prompt: find leads (no pitches), in batches of 20. */
  function buildPrompt(o) {
    const total = Math.max(1, Number(o.count) || BATCH)
    const skip = (o.excludeNames || []).slice(0, 400)
    const lines = [
      `I build websites for independent musicians. Find ${total} artists for my outreach and return all ${total} in one reply (the JSON is short: no pitches needed). Use your web search and work fast.`,
      '',
      `Genres: ${o.genres || 'any'}`,
      `Locations: ${o.places || 'US, UK, Canada, Australia, New Zealand, Ireland'}`,
      '',
      `Find artists ONLY on these platforms: ${PLATFORMS.join(', ')}. Do not use Bandcamp at all.`,
      '',
      'Every artist must:',
      '1. Be active: a release or a show in the last 6 months.',
      '2. Have real traction for an independent act (listeners, followers, plays or shows). Skip major-label stars, cover/tribute bands, wedding DJs and music schools.',
      '3. Have NO website of their own (socials, streaming pages and link-in-bio pages are not websites).',
      '4. Publish a contact or booking email themselves: in their YouTube channel description or About, SoundCloud bio, Spotify bio, Instagram bio, Linktree or Facebook. Include ONLY artists where you actually saw an email. Never guess one. If an artist has no email, skip them and keep looking.',
      '',
      'HOW TO SEARCH (go straight to the platforms; do not rely on Google or Brave "site:" searches, they no longer filter these pages):',
      '- Bandsintown: open bandsintown.com city pages and "concerts near" pages for several cities (not just one). Use small and mid-size venues\' upcoming shows to find local acts, then open each artist.',
      '- YouTube Music / YouTube: search YouTube itself (youtube.com/results?search_query=<genre>+<city>+music+video), filter to uploads from this year, open the channel\'s About / description. Many artists list a booking email there.',
      '- SoundCloud: open soundcloud.com/search/people?q=<genre or city> and genre tag pages (soundcloud.com/tags/<genre>), open profiles and read the bio.',
      '- Spotify: open local or genre playlists on open.spotify.com, open each artist\'s page, read "About" (bio), and follow their linked Instagram / YouTube.',
      '- Apple Music: use its genre and "new music" playlists to discover names, then find the email on that artist\'s YouTube, SoundCloud, Spotify bio or Instagram.',
      '- Instagram: if I\'m signed in, open the artist\'s Instagram profile; the bio or the email/contact button is the most common place for a booking email.',
      '- Linktree / link-in-bio pages often list the email too.',
      '',
      'KEEP GOING:',
      '- Rotate through many cities and all the genres above. If a city or genre gives you nothing after a few artists, move to the next one; never stop at the first dry spot.',
      '- An empty list is a failed search. Keep looking until you reach the number or have tried at least 10 city/genre combinations.',
      '- If a page asks for a human check (a captcha or "Verify"), pause and tell me so I can click it, then continue.',
      '- Small independent labels are fine; skip only major-label acts.'
    ]
    if (skip.length) lines.push('', `Already contacted, never include: ${skip.join('; ')}`)
    lines.push('', OUTPUT_SPEC, '', `If you truly can't find enough, return the ones you found rather than weaker ones, and say nothing else.`)
    return lines.join('\n')
  }

  /**
   * One-shot prompt for a claude.ai chat that has the Gmail connector on:
   * Claude searches with its own web search and creates every draft itself.
   * Fastest route; the guardrails fix what went wrong before (drafts with no
   * recipient, repeats).
   */
  function buildDirectPrompt(o) {
    const total = Math.max(1, Number(o.count) || 50)
    const skip = (o.excludeNames || []).slice(0, 500)
    const skipEmails = (o.excludeEmails || []).slice(0, 500)
    const lines = [
      `I build websites for independent musicians. Find ${total} artists and create a Gmail draft pitching each one. Work fast: use your web search (not a browser), and create each draft as soon as an artist qualifies.`,
      '',
      `Genres: ${o.genres || 'any (mix indie, punk, emo, rock, country, hip-hop, R&B, electronic)'}`,
      `Locations: ${o.places || 'US, UK, Canada, Australia, New Zealand, Ireland; rotate through many cities'}`,
      `Find artists ONLY on: ${PLATFORMS.join(', ')}. Never Bandcamp.`,
      '',
      'An artist qualifies only if ALL are true:',
      '1. Active: a release or show in the last 6 months.',
      '2. Independent with real traction (skip major-label stars, cover/tribute bands, wedding DJs).',
      '3. No website of their own (socials, streaming and link-in-bio pages are fine).',
      '4. You saw an email they published (YouTube description/About, SoundCloud bio, Spotify bio, Instagram bio, Linktree, Facebook, Bandsintown).',
      '',
      'HARD RULES for drafts:',
      '- NEVER create a draft without the recipient email in the To field. No email = skip the artist and keep searching.',
      '- Before each draft, search my Gmail for the email (to:<email>). If anything comes up (sent or draft), skip them.',
      '- Never draft anyone on the lists below, and never draft the same person twice in this run.',
      '- Subject: "A site for <name>". Body: plain text, exactly this structure:',
      '---',
      DEFAULT_PITCH.replace('[Your Name]', o.senderName || '[Your Name]'),
      '---',
      '- Pitch rules: only facts you found; no invented songs, shows or numbers; warm and plain; no hype words, emojis, exclamation marks or em dashes; never mention their email, managers or agents.',
      '',
      'KEEP GOING until you have created all the drafts: rotate cities and genres, never stop at a dry spot.',
      '',
      'When finished, reply with ONLY this JSON (one entry per draft you created), so I can record them:',
      '```json',
      '[{"name": "", "email": "", "found_on": "", "profile_url": "", "city": "", "genre": ""}]',
      '```'
    ]
    if (skip.length || skipEmails.length) {
      lines.splice(lines.indexOf('KEEP GOING until you have created all the drafts: rotate cities and genres, never stop at a dry spot.'), 0,
        'ALREADY CONTACTED (never draft these):',
        skip.length ? `Names: ${skip.join('; ')}` : '',
        skipEmails.length ? `Emails: ${skipEmails.join(', ')}` : '',
        '')
    }
    return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
  }

  /** Follow-up in the same chat. */
  function buildMorePrompt(o) {
    const skip = (o.excludeNames || []).slice(0, 400)
    return [
      `more: ${o.count || BATCH} more artists, same rules, same JSON format, all in one reply. Only artists found on ${PLATFORMS.join(', ')} (no Bandcamp), each with an email you actually saw.`,
      'Use new cities and genres, and go straight to Bandsintown city pages, YouTube search, SoundCloud people/tag pages, Spotify playlists and the artists\' Instagram bios. Do not return an empty list: keep rotating until you have them.',
      skip.length ? `Never include anyone already found or contacted: ${skip.join('; ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** Optional: have Claude write the pitches for leads already in the queue. */
  function buildPitchPrompt(items) {
    const facts = items.map((q) => ({
      email: q.email,
      name: q.name,
      found_on: q.foundOn,
      city: q.city,
      genre: q.genre,
      latest_release: q.latestRelease,
      recent_show: q.recentShow,
      found_pages: q.foundPages,
      detail: q.detail
    }))
    return [
      'Write a short, personal cold email for each artist below. I build websites for independent musicians.',
      'Structure, exactly:',
      '---',
      DEFAULT_PITCH,
      '---',
      'Rules: use only the facts given; never invent songs, shows or numbers. Warm and plain, like a real person. No hype words, emojis, exclamation marks or em dashes. Never mention their email, managers or agents. Keep "[Your Name]" as the sign-off.',
      '',
      'Reply with ONLY a JSON array in one code block: [{"email": "", "subject": "A site for <name>", "body": "<plain text with \\n line breaks>"}]',
      '',
      'Artists:',
      JSON.stringify(facts, null, 1)
    ].join('\n')
  }

  /* ---------------- pitch written from the lead's facts ---------------- */

  const DEFAULT_PITCH = [
    'Hi {name},',
    '',
    '{how you found them + one specific, true detail}. I looked for a website and found {what a search shows instead}.',
    '',
    '{one specific problem that causes, and how a site of their own fixes it, max 2 sentences}',
    '',
    "I design websites for independent artists. It's a paid service, and I build each site around the kind of website the artist wants. For you that could be {3-4 sections that suit them}, or something different if you have another idea in mind.",
    '',
    "If you know you need a website and you're interested in having me build it, I'll make you a free mockup first. That way you can see my work and how your site would turn out before you invest any money. Before I start on it, I'd just need you to describe what you want the site to have.",
    '',
    "Is a website something you'd be interested in?",
    '',
    'Best,',
    '[Your Name]'
  ].join('\n')

  const listJoin = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)
  const stripDate = (s) => String(s || '').replace(/\s*\((\d{4}-\d{2}-\d{2}|\d{4})\)\s*$/, '').trim()
  const dateOf = (s) => (String(s || '').match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || ''

  /** Town-style pitch from the facts Claude returned — no AI needed.
   *  Several approved versions per role, picked by a hash of the email so a run mixes them
   *  (spam filters notice hundreds of identical emails) and the same lead always gets the same one. */
  const hashOf = (s) => { let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h }
  const OPT_OUT_PS = 'P.S. If it\'s not for you, just reply "no" and I won\'t email again.'
  const OPT_OUT_SHORT = '(Not interested? Reply "no" and I won\'t follow up.)'

  function pitchParts(q) {
    const via = q.foundOn || 'Spotify'
    const role = q.role === 'producer' ? 'producer' : q.role === 'podcaster' ? 'podcaster' : 'artist'
    const patreon = !!q.patreon
    const release = stripDate(q.latestRelease).replace(/^"([^"]*)"$/, '$1')
      .replace(/\s*[([](official|music|lyric|audio|video|visuali[sz]er|prod)[^)\]]*[)\]]/gi, '').replace(/\s*\|.*$/, '').trim()
    const quoted = (release.match(/"([^"]{2,60})"/) || [])[1] || (release.length <= 70 ? release : '')
    const show = stripDate(q.recentShow)
    const showFuture = dateOf(q.recentShow) && dateOf(q.recentShow) >= today()
    const cleanName = String(q.name || '').replace(/^\s*prod(uced)?\.?\s*(by\s*)?/i, '').trim() || q.name
    const isThe = /^the\s/i.test(cleanName)
    const pages = (q.foundPages && q.foundPages.length ? q.foundPages : [via]).slice(0, 4)
    const found = pages.length === 1 ? `only ${pages[0]}` : listJoin(pages)
    const g = (q.genre || '').toLowerCase()
    const VARIANTS = { artist: 3, producer: 2, podcaster: 2 }
    const v = Number.isInteger(q.variant) ? q.variant % VARIANTS[role] : hashOf(q.email || q.name) % VARIANTS[role]
    const variant = `${role}-${'ABC'[v]}`

    if (role === 'podcaster') {
      const host = String(q.host || '').trim()
      const first = host && !/[&,]| and /i.test(host) && host.split(/\s+/).length <= 3 ? host.split(/\s+/)[0] : ''
      const hi = first ? `Hi ${first},` : 'Hi there,'
      const ep = quoted ? `"${quoted}"` : 'the latest episode'
      const where = via && !/youtube/i.test(via) ? via : 'Apple Podcasts'
      if (v === 0) return { variant, subject: `A website for ${cleanName}`, body: [
        hi, '',
        `I've been listening to ${cleanName}${quoted ? ` and enjoyed ${ep}` : ''}. I looked for the show's website and could only find it on ${where}.`, '',
        `A site of your own gives listeners one home for every episode, show notes, guest pages and a way to join your mailing list or support you${patreon ? ' on Patreon' : ''}. It also helps new listeners find you on Google, which podcast apps don't do well.`, '',
        "I design websites for independent podcasters (paid service). If you're interested, I'll make a mockup first so you can see how it would look before deciding anything.", '',
        'Would a website be useful for the show?', '',
        'Best,', '[Your Name]', '', OPT_OUT_PS].join('\n') }
      return { variant, subject: `Quick question about ${cleanName}`, body: [
        hi, '',
        `${quoted ? `Caught ${ep}. Good episode.` : `I've been catching up on ${cleanName}.`} Does the show have its own website? I could only find it ${/patreon/i.test(via) ? 'on Patreon' : 'in podcast apps'}.`, '',
        "Here's why it's worth having one. Podcast apps are where people listen, but Google is where new people find shows. A site with a page for each episode, with show notes or transcripts, lets your episodes appear when someone searches for the topics you cover. Apps can't do that for you.", '',
        `Sponsors and guests usually check for a website before they say yes, and a site with your audience info and a contact page makes the show look established. It's also the one place you own: your mailing list${patreon ? ', your Patreon' : ''} and your archive stay yours, whatever the apps change.`, '',
        "I build websites for independent podcasts (paid service). If you're interested, I'll mock one up first so you can see it before deciding anything.", '',
        'Worth a look?', '',
        '[Your Name]', '', OPT_OUT_SHORT].join('\n') }
    }

    const greeting = isThe ? 'Hi there,' : `Hi ${cleanName},`
    if (role === 'producer') {
      const beat = quoted ? `, especially "${quoted}"` : ''
      if (v === 0) return { variant, subject: `A beat store for ${cleanName}`, body: [
        greeting, '',
        `I found your beats on ${via}${beat}. I looked for a website and found ${found}.`, '',
        "Artists usually check a producer out before buying a beat or asking for custom work. Right now your beats, prices and contact are spread across platforms. A site puts your catalogue, licensing options and a placements contact in one place that's yours, not a marketplace profile.", '',
        "I design websites for independent producers and artists (paid service). If you're interested, I'll make a mockup first so you can see it before deciding.", '',
        'Is that something you\'d want?', '',
        '[Your Name]', '', 'P.S. Not for you? Reply "no" and I won\'t email again.'].join('\n') }
      const market = pages.filter((x) => !/^(YouTube|YouTube Music)$/.test(x))
      return { variant, subject: `Quick one, ${cleanName}`, body: [
        greeting, '',
        `${quoted ? `Heard "${quoted}" on ${via}. Hard.` : `Heard your beats on ${via}. Hard.`} I went looking for a place to browse your catalogue and couldn't find a site of your own, only ${listJoin(['YouTube', ...market].filter((x, k, a) => a.indexOf(x) === k))}.`, '',
        "Here's why that's costing you. On marketplaces, artists are one click away from another producer's beats, the platform takes a cut, and you never get the artist's email. On your own beat store, nobody else's beats are competing for attention, you set your own lease and exclusive prices, and every artist who downloads a free beat joins your email list. You can send them new packs, discounts and custom-beat offers for years.", '',
        'It also gives artists and A&Rs a professional place to see your placements and contact you for custom work.', '',
        "I build beat-store websites for producers (paid service). Happy to mock one up first so you can see how yours would look before deciding.", '',
        'Interested?', '',
        '[Your Name]', '', '(Reply "no" and I won\'t follow up.)'].join('\n') }
    }

    // artists and bands
    let opener = isThe ? `I found ${cleanName} on ${via}` : `I found you on ${via}`
    if (show && (showFuture || !release)) opener += ` and saw your ${show.split(',')[0]} show${showFuture ? ' coming up' : ''}`
    else if (quoted) opener += ` and liked "${quoted}"`
    opener += '.'
    const problem = patreon
      ? 'You already have fans supporting you on Patreon, which most artists never get to. A website gives them, and new fans, one official home to find your music, shows and your Patreon, and it\'s somewhere you control.'
      : show
        ? 'Promoters and venues usually look an act up before they book, and right now they would find your shows, music and contact spread across different platforms. A site would put your dates, music, videos and a booking contact in one place.'
        : pages.length >= 3
          ? `Right now people have to piece you together from ${pages.length} different places, and none of them is fully yours. A site would give you one official home for your music, shows and booking contact.`
          : "Right now everything lives on platforms you don't own, so if an algorithm or an account changes, that reach can disappear overnight. A site would give you one official home for your music, shows and booking contact."
    const idea = /dj|electronic|house|techno|drum|bass/.test(g)
      ? 'your releases, mixes, a gig list and a booking page'
      : /hip|rap|drill|trap/.test(g)
        ? 'your latest releases, videos, a merch page and a booking contact'
        : 'your music, videos, show dates and a booking page'
    if (v === 0) return { variant, subject: `A site for ${cleanName}`, body: [
      greeting, '',
      `${opener} I looked for a website and found ${found}.`, '',
      problem, '',
      `I design websites for independent artists. It's a paid service, and I build each site around what the artist wants. For you that could be ${idea}.`, '',
      "If you're interested, I'll put together a mockup of your site first, so you can see how it would look before deciding anything.", '',
      "Is a website something you'd be interested in?", '',
      'Best,', '[Your Name]', '', OPT_OUT_PS].join('\n') }
    if (v === 1) return { variant, subject: `Quick question, ${cleanName}`, body: [
      greeting, '',
      `${quoted ? `I came across "${quoted}" on ${via}. Really enjoyed it.` : `I came across your music on ${via}. Really enjoyed it.`} When I searched for you afterwards, I couldn't find a website, only ${found.replace(/^only /, '')}.`, '',
      patreon
        ? problem
        : "That matters more than it seems. When a promoter, a playlist curator or a blog thinks about featuring you, the first thing they do is Google your name. If all they find are social profiles, it's harder for them to take the next step: there's nowhere to hear your best songs in one place, see your show history or find a proper booking contact.", '',
      "A site also lets you build a mailing list, so when you release something new, your fans hear about it directly. You don't have to hope the algorithm shows them your post.", '',
      "I build websites for independent artists (paid work). If you're open to it, I'll sketch a mockup of yours first, so you can see exactly what you'd get before committing to anything.", '',
      'Would that be useful?', '',
      '[Your Name]', '', '(Not interested? Reply "no" and I won\'t follow up.)'].join('\n') }
    return { variant, subject: `${cleanName}'s booking page`, body: [
      greeting, '',
      `When a promoter, playlist curator or venue looks you up, what do they find? I searched and only got ${found.replace(/^only /, '')}, no website.`, '',
      `That's usually where people decide whether to book or feature an act. A page full of social links looks like a hobby. A simple site with your best songs, videos, past and upcoming shows${patreon ? ', your Patreon' : ''} and a booking contact looks like an act that's ready to be booked. It's also the link you can send in every pitch, so you're not asking someone to scroll through Instagram to work out who you are.`, '',
      "I design sites for independent artists (paid work). If you're open to it, I'll show you a mockup first so you can see the idea before spending anything.", '',
      'Worth a look?', '',
      '[Your Name]', '', "P.S. If now's not the time, reply \"no\" and I'll leave it there."].join('\n') }
  }

  function pitchFor(q) { return pitchParts(q).body }

  /* ---------------- parsing Claude's reply ---------------- */

  /** Pull the JSON array out of a reply that may include prose, code fences or "[1]" citations. */
  function parseArray(text) {
    const clean = String(text || '').replace(/```(?:json)?/gi, '')
    const found = []
    // A reply may contain several arrays (e.g. after "more"): collect them all.
    let i = clean.indexOf('[')
    while (i >= 0) {
      let got = false
      if (/^\[\s*(\{|\])/.test(clean.slice(i))) {
        for (let j = clean.indexOf(']', i); j > i && j >= 0; j = clean.indexOf(']', j + 1)) {
          try {
            const v = JSON.parse(clean.slice(i, j + 1))
            if (Array.isArray(v)) {
              found.push(...v.filter((x) => x && typeof x === 'object'))
              i = clean.indexOf('[', j + 1)
              got = true
              break
            }
          } catch (_) {
            /* extend the span */
          }
        }
      }
      if (!got) i = clean.indexOf('[', i + 1)
    }
    return found
  }

  const pick = (o, keys) => {
    for (const k of keys) if (o[k] != null && String(o[k]).trim()) return String(o[k]).trim()
    return ''
  }
  const arr = (v) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : v ? String(v).split(/,\s*/).filter(Boolean) : [])

  function normPlatform(s) {
    const t = String(s || '').toLowerCase()
    if (/podcast/.test(t)) return /spotify/.test(t) ? 'Spotify' : 'Apple Podcasts'
    if (/apple/.test(t)) return 'Apple Music'
    if (/youtube/.test(t)) return 'YouTube Music'
    if (/soundcloud/.test(t)) return 'SoundCloud'
    if (/bandsintown/.test(t)) return 'Bandsintown'
    if (/spotify/.test(t)) return 'Spotify'
    if (/bandcamp/.test(t)) return 'Bandcamp'
    return s ? String(s) : ''
  }

  /** Normalise Claude's objects into queue items and flag problems (bridge checks come later). */
  function toItems(list) {
    const seen = new Set()
    return list.map((o, i) => {
      const item = {
        id: `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: pick(o, ['name', 'artist', 'band']),
        email: pick(o, ['email', 'contact', 'booking_email']).toLowerCase(),
        emailSource: pick(o, ['email_source', 'email_source_url']),
        foundOn: normPlatform(pick(o, ['found_on', 'platform', 'source'])),
        profileUrl: pick(o, ['profile_url', 'url', 'link']),
        otherLinks: arr(o.other_links || o.links),
        city: pick(o, ['city', 'location']),
        genre: pick(o, ['genre']),
        role: pick(o, ['role']).toLowerCase(),
        host: pick(o, ['host', 'author']),
        patreon: !!o.patreon || arr(o.other_links || o.links).some((u) => /patreon\.com/i.test(u)),
        latestRelease: pick(o, ['latest_release', 'release']),
        recentShow: pick(o, ['recent_show', 'show', 'upcoming_show']),
        foundPages: arr(o.found_pages),
        detail: pick(o, ['detail', 'note']),
        subject: pick(o, ['subject']),
        body: pick(o, ['body', 'pitch']),
        status: 'pending',
        reason: ''
      }
      if (item.name && (!item.subject || !item.body)) {
        const parts = pitchParts(item)
        if (!item.subject) item.subject = parts.subject
        if (!item.body) { item.body = parts.body; item.variant = parts.variant }
      }
      if (!item.name) item.reason = 'no name'
      else if (!EMAIL_RE.test(item.email)) item.reason = 'no email shown'
      else if (item.foundOn === 'Bandcamp' || /bandcamp\.com/i.test(item.profileUrl)) item.reason = 'found on Bandcamp (excluded)'
      else if (seen.has(item.email)) item.reason = 'duplicate in this paste'
      if (item.reason) item.status = 'skipped'
      seen.add(item.email)
      return item
    })
  }

  const urlsOf = (q) => [q.profileUrl, ...(q.otherLinks || [])].filter(Boolean)

  /* ---------------- email body ---------------- */

  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  /** Plain text → the simple HTML Gmail itself produces (one <div> per line), with links. */
  function textToHtml(text) {
    return String(text)
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => {
        if (!line.trim()) return '<div><br></div>'
        const linked = escapeHtml(line).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
        return `<div>${linked}</div>`
      })
      .join('')
  }

  function sanitizeHtml(html) {
    return String(html)
      .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '')
      .replace(/\son\w+='[^']*'/gi, '')
      .replace(/javascript:/gi, '')
  }

  function signOff(text, name) {
    if (!name) return text
    return String(text).replace(/\[Your Name\]|\{\{\s*sender_name\s*\}\}|\{sender_name\}/gi, name)
  }

  function bodyHtml(item, senderName) {
    if (item.html) return sanitizeHtml(signOff(item.html, senderName))
    return textToHtml(signOff(item.body, senderName))
  }

  root.ARD = {
    EMAIL_RE, PLATFORMS, BATCH, today, DEFAULT_PITCH,
    buildPrompt, buildMorePrompt, buildPitchPrompt, buildDirectPrompt, pitchFor, pitchParts,
    parseArray, toItems, urlsOf, textToHtml, sanitizeHtml, signOff, bodyHtml
  }
})(typeof self !== 'undefined' ? self : this)
