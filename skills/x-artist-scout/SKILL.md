---
name: x-artist-scout
description: Scrape X (Twitter) for active independent musicians who need a website, people tweeting new releases with Spotify / Apple Music / SoundCloud / YouTube Music links or with musician bios, and pull their public email. Use when the user asks to find, scout or scrape artists/musicians on X or Twitter, or wants artist leads from X. Same technique as Apify's X scrapers (X's private GraphQL API with a logged-in session), run free inside the Agent Reach browser profile.
---

# X artist scout

## How it works (what Apify's X scrapers do)
X's web app gets all data from private GraphQL endpoints: `POST /i/api/graphql/<queryId>/SearchTimeline`,
`GET .../UserTweets`, `UserByScreenName`. Each call needs X's public web bearer token, the session cookies
(`auth_token`, `ct0`), and `x-csrf-token = ct0`. Since 2023 search only works **logged in**. Apify's actors (for example
apidojo Tweet Scraper) run these same calls with a pool of logged-in accounts and residential proxies. This
script runs them inside the user's logged-in **Agent Reach Chrome profile** (`~/.agent-reach/browser/profile`,
CDP port 9222), so X sees a normal browser session. queryIds rotate; they are fetched from
`fa0311/twitter-openapi` placeholder.json each run (fallback IDs in the script).

## Before running
- The X login must be live: cookies `auth_token` + `ct0` in that profile. X often refuses logins in a
  remote-controlled Chrome (and agent-reach's login window can open as about:blank). Working method: stop the agent-reach
  browser (`agent-reach browser stop`), then open the profile as **plain Chrome** for the user to log in:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir="$HOME/.agent-reach/browser/profile" --no-first-run "https://x.com/i/flow/login" &`
  (sandbox off). The **user** logs in, then quits that window with Cmd+Q. Never type credentials for them.
- The script attaches to port 9222 if something is listening; otherwise it starts that profile itself with a debugging
  port (real keychain, so the login cookies stay readable). It exits with `PROFILE_BUSY` if the plain login window is still open.

## Run it
```bash
cd ~/.claude/skills/x-artist-scout/scripts
node scout.mjs --genres "hip hop,r&b,indie" --cities "Atlanta,London" --mode both --pages 2 --limit 60 --out /path/leads.json
```
Options:
- `--mode releases|people|both` (People search returned empty results in Nov 2026, so runs use `releases`): `releases` = Latest tweets with "out now / new single" + a streaming link
  (`url:open.spotify.com` etc.), which gives active artists. `people` = People tab (matches bios: "<genre> artist booking",
  "<genre> singer gmail"). `--query "..."` (repeatable) for raw X search syntax.
- `--pages 1-5`, `--limit 100`, `--min-followers 100 --max-followers 250000` (indie artists have small X followings), `--max-days 90` (last post).
- Locations: free-text X locations naming clearly off-target countries (Nigeria, India, Brazil...) are dropped; empty ones are kept. `--all-locations` turns this off.
- `--max-requests 120`: hard cap on X API calls per run (protects the account). The script paces 2–4 s per call
  and stops at the first 429 (rate limit).
- `--include-sites`, `--any-platform` (don't require a link to one of the 5 platforms), `--no-exclude`.

## Yield and X data notes
- Test run (Nov 2026): 24 requests, 109 accounts checked, 3 leads. Most drops were no email in bio (36%) or an own website (27%).
  X is a supplement to the YouTube scout, not a 100-a-day source on one account.
- X moved user fields out of `legacy` in 2026: `profile_bio.description/entities`, `relationship_counts.followers`,
  `location.location`, `core.screen_name/name`. `userRow()` reads both shapes.
- API calls run from `https://x.com/robots.txt` (same origin, so cookies are sent, but no X scripts): X's own fetch wrapper on /home
  intermittently throws "Failed to fetch".

## Filters
- Kept: has a public email (bio, or the Linktree-style page in the bio), links to Spotify / Apple Music / YouTube Music /
  SoundCloud / Bandsintown (bio, Linktree, or the release tweet), no own website (bio URL, Linktree, own-domain email),
  posted within `--max-days`, followers in range, not on Reverb's shared contact list (read-only), not a
  label/blog/promo/curator account.
- Output `leads` is in the Artist Reach Drafter paste format (`found_on` = the streaming platform found, `profile_url`
  = that platform link, the X profile in `other_links`, plus `x_handle`, `followers`, `last_post_days`).

## Rules and safety
- Read-only: never post, like, follow or DM. Public profile data only.
- Use a secondary X account. Keep runs to around 100–150 requests and a few runs a day; heavy scraping can get
  the account locked. Report `stats` honestly (checked vs. kept, and why the rest were dropped).
- Skim the leads: X has many promo, curator and fan accounts.
