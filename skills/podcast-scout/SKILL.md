---
name: podcast-scout
description: Find independent podcasters with NO website of their own and a public owner email (English-language shows in US/UK/CA/AU/IE/NZ), flagging those on Patreon. Use when the user wants podcaster leads, podcast outreach, or Patreon podcasters. Used by artist-reach-run for its podcaster share.
---

# Podcast scout

Apple's free iTunes Search API → each show's public RSS feed:
- email: `<itunes:email>` (host relay addresses like @anchor.fm are dropped)
- website: channel `<link>`; a hosting page (Anchor, Buzzsprout, Spotify…) counts as **no site**; an own-domain email also means they have a site
- Patreon: `<podcast:funding>` or a patreon.com link in the show or recent episode notes → `patreon: true`

patreon.com itself does not load from this network (the TLS connection times out), so Patreon creators are found through
their RSS feeds (podcasters) and YouTube links (musicians: youtube-artist-scout `--roles patreon`).

```bash
node ~/.claude/skills/podcast-scout/scripts/scout.mjs --terms "true crime sisters,horror movie podcast" --countries US,GB,CA,AU,IE,NZ --limit 60 [--patreon-only]
```
Filters: active within `--active-days 60`, `--min-episodes 8`, `--max-episodes 700`, English feed, not off-target countries,
not networks/media companies/churches/big brands, skips Apple's `--skip-top 30` results per search (the famous shows).
Use niche terms: broad ones ("comedy") return celebrities. Yield is about 6% of shows checked.
Output: `{ stats, leads }`, leads with `role: "podcaster"`, `host`, `latest_release` = latest episode.
