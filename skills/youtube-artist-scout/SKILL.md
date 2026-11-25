---
name: youtube-artist-scout
description: Scrape YouTube / YouTube Music for active independent musicians (by genre and city) and pull their public contact emails, for website outreach. Use when the user asks to find, scout or scrape artists/musicians/bands on YouTube or YouTube Music, wants artist leads with emails from YouTube, or says "scrape YouTube for <genre> artists in <city>". Free: uses YouTube's own InnerTube API via youtubei.js (no API key, no quota, no AI cost).
---

# YouTube artist scout

A script that searches YouTube for recent uploads by genre × city, reads each channel's
**About** tab (description, links, country, subscribers, hidden-business-email flag), finds a
**public** contact email, and drops channels that already have their own website or are already
on the user's Reverb shared contact list. Output is ready to paste into the **Artist Reach Drafter**
Chrome extension (tab 2) or Reverb.

## Run it

```bash
cd ~/.claude/skills/youtube-artist-scout/scripts
node scout.mjs --genres "punk,indie,emo" --cities "Denver,Chicago,Austin" --pages 2 --out /path/to/leads.json
```

Options:
- `--genres "a,b"` and `--cities "x,y"`: builds queries like `punk Denver official music video`, `punk band Denver new single`, `punk artist Denver booking`. Or pass any `--query "..."` (repeatable).
- `--pages 2` (1–6): result pages per query (~20 videos each). More pages give more channels but take longer.
- `--upload year` (hour|today|week|month|year): how recent the found videos must be. `--max-days 180` also drops channels whose found upload is older.
- `--min-subs 300 --max-subs 250000`: traction range (YouTube subscribers).
- `--countries "US,GB,CA,AU,NZ,IE"`: channel country must match; channels with no country set are kept.
- `--limit 150`: stop after this many leads. `--include-sites`: keep channels that have their own website. `--no-exclude`: ignore Reverb's shared list.

Speed: ~1 minute per 4 queries at 2 pages. Typical yield is a few percent of channels with a readable email (artists often hide it behind YouTube's sign-in), so cover several cities/genres per run.

## Output (stdout JSON, and `--out` file)

- `stats`: videos, channels, checked, and why channels were dropped (nonArtist, taken, oldOrInactive, subsOut, outsideCountries, hasWebsite, noEmail, hiddenEmailOnly).
- `leads`: artists **with** an email, in the extension's paste format: `name, email, email_source, found_on ("YouTube Music"), profile_url, other_links, city, genre, latest_release, found_pages, subscribers, country, hidden_business_email`.
- `hidden_email_only`: artists who have a business email but only behind YouTube's "View email address" button (needs sign-in + captcha; never bypass it). Their Instagram/Linktree in `other_links` may show it.

To hand leads to the user for drafting: give them the `leads` array as a ```json block (they paste it into the extension's **2 · Paste & draft** tab), or save it to a file.

## Rules

- Only public information. Never try to get past YouTube's sign-in/captcha email button.
- Emails come from the channel description, the latest video's description, or the artist's own Linktree-style page, never guessed.
- Report the `stats` honestly (how many checked vs. how many had emails).
- The script reads Reverb's shared list read-only (`~/Library/Application Support/reverb/artist-reach/contacts.json`); it never writes to it. Reserving/recording happens when the user pastes into the extension.
- Expect occasional non-artists (concert filmers, venues, podcasts); skim the leads before sending.

## How it works (youtubei.js notes, v18)

- `Innertube.create({ retrieve_player: false, lang: 'en', location: 'US' })`
- `yt.search(q, { type: 'video', upload_date: 'year' })` → `.videos[]` (`author.id`, `author.name`, `title`, `published` like "5d ago", `id`); `.getContinuation()` for more pages.
- `(await yt.getChannel(id)).getAbout()` → `.metadata`: `description`, `links[]` (`link`), `country`, `subscriber_count` ("67.9K subscribers"), `video_count`, `joined_date`, `sign_in_for_business_email` (truthy = hidden business email exists).
- `yt.getBasicInfo(videoId).basic_info.short_description` = full video description.
- Channel-search results put subscribers in the wrong field; use `getAbout()`. YouTube Music artist search mostly returns auto-generated "Topic" channels (no email), and "Fans might also like" is often missing, so the scout starts from regular YouTube video search.
- Topic/VEVO/label/lyric/filmer channels are filtered by name (`NON_ARTIST` in the script).
