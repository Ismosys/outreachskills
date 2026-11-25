---
name: patreon-scout
description: Find small/medium Patreon musicians, bands, producers and podcasters with NO website and a public email, using Patreon's public JSON API (no login). Use when the user wants Patreon creator leads. Runs as a bonus worker inside artist-reach-run.
---

# Patreon scout

Patreon's public API, no login needed:
- `GET /api/search?q=<term>&page[number]=1..2&page[size]=50` gives up to about 88 campaigns per term (name, patron_count, is_nsfw, url)
- `GET /api/campaigns/<id>?include=creator` gives the about text (`summary`, user `about`), `social_connections` (YouTube/Instagram/X/Spotify…), and `currency`
- `GET /api/posts?filter[campaign_id]=<id>&sort=-published_at&page[size]=1` gives the latest post, used to check activity

Email comes from the about text, then the linked YouTube channel's description and latest video description, then a Linktree page.
The rules match youtube-artist-scout: an own-domain email or a non-platform link means they have a website; YouTube channel country must be in the target list;
the off-target regex applies; currency must be USD/GBP/EUR/CAD/AUD/NZD/SEK/DKK/NOK; `--max-patrons 2000`; NSFW is skipped.

```bash
node ~/.claude/skills/patreon-scout/scripts/scout.mjs --queries "indie band,folk singer,horror podcast" --limit 40
```
`DEBUG=1` logs why each creator was dropped (site / no email).

**Yield (Nov 2026): about 0.5%** (4 of 759 creators). Most Patreon musicians link only Instagram, whose emails can't be read logged out,
or already have a site. So it's a bonus source, not a main one. patreon.com was blocked on the user's ISP until 2026-11-25 (fixed);
if the API times out again, it's the network, and runs continue without it (`--no-patreon`).
