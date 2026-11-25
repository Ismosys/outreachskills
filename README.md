# Outreach skills for Claude

Five Claude Code skills that find independent **musicians, producers, podcasters and Patreon creators
who don't have a website yet**, pull the email they published themselves, and write a personal pitch
for each one.

They run free: no API keys, no paid scraper, no LLM tokens for the scraping. Each skill is a Node
script that talks to a public API (YouTube's own InnerTube, Apple's iTunes Search, Patreon's public
JSON, X's web GraphQL with your own logged-in session). Claude just decides what to search for and
reads back the results.

Nothing is ever sent automatically. You get drafts and you send them yourself.

## What's in here

| Skill | Finds | Source | Needs |
|---|---|---|---|
| `youtube-artist-scout` | artists, bands, producers | YouTube / YouTube Music search → channel About tab | `youtubei.js` |
| `podcast-scout` | independent podcasters | Apple's iTunes Search API → the show's RSS feed | nothing |
| `patreon-scout` | musicians and podcasters on Patreon | Patreon's public JSON API | nothing |
| `x-artist-scout` | artists posting new releases | X's web GraphQL, inside your own Chrome profile | an X login, `playwright-core` |
| `artist-reach-run` | all of the above at once, then pitches | runs the four scouts in parallel | see *The drafting step* |

Plus:

- `pitch/shared.js` — the pitch templates. Nine approved versions (3 for artists, 2 for producers,
  2 for podcasters, and Patreon/band variations), each with its own subject line and opt-out line.
  A pitch is picked by a hash of the lead's email, so the same person always gets the same one and
  the mix stays even across a run.
- `tools/pitch.mjs` — turns a leads file into finished pitches without any desktop app.

## Install

Needs **Node.js 20+** and Claude Code. The scripts are written for **macOS** — the four scouts only
assume `~` and a Chrome install, but `x-artist-scout` hardcodes Chrome's macOS path and
`artist-reach-run` looks for Reverb in `~/Library/Application Support`, so on Linux or Windows those
two need a small edit.

```bash
git clone https://github.com/Ismosys/outreachskills.git
cd outreachskills
./install.sh          # copies the skills into ~/.claude/skills and installs npm deps
```

Use `./install.sh --link` instead if you want to edit the skills in this repo and have the changes
take effect straight away. If a skill of the same name is already installed, it's moved to
`<name>.backup` rather than overwritten.

Restart Claude Code. It picks up the skills from their descriptions, so you ask in plain words:

> scout YouTube for indie and shoegaze artists in Denver, Austin and Portland

> find 40 independent podcasters with no website, true crime and horror

> find Patreon musicians with a public email

## The two ways to use it

### 1. Scout, then pitch (works for everyone)

Ask Claude to scout. Each scout prints `{ stats, leads }` and can save the leads with `--out`:

```bash
node ~/.claude/skills/youtube-artist-scout/scripts/scout.mjs \
  --genres "punk,indie,emo" --cities "Denver,Chicago,Austin" --pages 2 --out leads.json

node ~/.claude/skills/podcast-scout/scripts/scout.mjs \
  --terms "horror movie podcast,paranormal podcast" --countries US,GB,CA,AU,IE,NZ --limit 60 --out leads.json
```

Then write the pitches:

```bash
node tools/pitch.mjs leads.json --name "Your Name" --record
```

That writes `leads-pitches.md` (readable, one pitch per lead — paste into Gmail) and
`leads-pitches.json` (subject + body per lead, for any mail tool you like). `--record` adds everyone
to your local *never twice* list, so the next scout run skips them.

### 2. One command for a whole run (needs the Reverb app)

`artist-reach-run` starts all four scouts in parallel, keeps going until it has N new leads, writes a
pitch for each, and saves the drafts straight into Gmail over IMAP:

```bash
node ~/.claude/skills/artist-reach-run/scripts/run.mjs --target 100 --minutes 60
```

The Gmail drafting and the shared contact list come from **Reverb**, a Mac app that isn't in this
repo. Without it the runner still scouts and still writes every pitch — it just can't put them in
Gmail, so use `--no-draft` and hand the saved run file to `tools/pitch.mjs`:

```bash
node ~/.claude/skills/artist-reach-run/scripts/run.mjs --target 100 --no-draft
node tools/pitch.mjs ~/.claude/skills/artist-reach-run/runs/<the-file>.json --name "Your Name" --record
```

## Never pitching the same person twice

Every scout reads a contact list before it starts and drops anyone already on it. By default that's
`~/.claude/artist-reach/contacts.json`, which `tools/pitch.mjs --record` writes. Point all of them
somewhere else with:

```bash
export ARTIST_REACH_CONTACTS=/path/to/contacts.json
```

The shape is `{ "contacts": { "<email>": { "name": ..., "email": ..., "profileUrl": ... } } }`. The
scouts only read it; nothing deletes from it.

## Who gets through the filters

All four scouts apply roughly the same rules, which is what makes the leads worth emailing:

- **No website of their own.** A Linktree, a Beatstars page or a podcast host page counts as *no
  website*. An email on their own domain does not — that means a label, a manager or a site already.
- **A public email they published themselves**, from a channel description, a video description, an
  RSS feed or their own link page. Never guessed, never scraped from behind a sign-in. YouTube's
  "View email address" button needs a sign-in and a captcha, and the scout never tries to get past
  it — those channels are reported separately as `hidden_email_only`.
- **Active recently** (a release or an episode in the last few months) and on at least one of
  Spotify, Apple Music, YouTube Music, SoundCloud or Bandsintown.
- **In range**: small enough to need a site, big enough to pay for one.
- **In an English-speaking country** plus some of Europe (NL, DE, SE, DK, NO, BE, FI). Adjust with
  `--countries`.
- **Not a label, archive, promo, reaction, lyric or VEVO channel** — there's a long name filter for
  these, and it's the thing most worth tuning for your own niche.

## Expected yield — read this before judging a run

Scraping public pages for emails that artists actually published is a low-yield business. From real
runs in November 2026:

| Scout | Yield |
|---|---|
| YouTube | a few percent of channels checked |
| Podcasts | ~6% of shows checked |
| Patreon | ~0.5% of creators checked (a bonus source, not a main one) |
| X | 3 leads from 109 accounts on one test run |

So cover many genre × city pairs per run rather than expecting one search to deliver. Every scout
prints `stats` showing how many it checked and exactly why the rest were dropped — `noEmail`,
`hasWebsite`, `inactive`, `nonArtist`, `taken`. Those numbers are the honest picture of a run.

## X needs a login (and care)

X's search has only worked logged in since 2023, so `x-artist-scout` runs its calls inside a real
Chrome profile of yours at `~/.agent-reach/browser/profile`. You don't need anything installed for
that — the script starts Chrome with that profile itself (with a debugging port) if nothing is
already listening on port 9222. You do need to log in to X in it once, and X often refuses a login in
a remote-controlled Chrome, so do it by opening that profile as plain Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/.agent-reach/browser/profile" --no-first-run "https://x.com/i/flow/login"
```

Log in yourself, then quit that window (Cmd+Q) before running the scout.

**Use a secondary account.** Keep runs to 100–150 requests and a few runs a day; the script paces
itself at 2–4 seconds per call and stops at the first rate limit, but heavy scraping gets accounts
locked. It's read-only: it never posts, likes, follows or DMs.

## House rules these skills follow

1. Public information only. Never get past a sign-in or a captcha for an email.
2. Never send automatically. Drafts are for a human to read and send.
3. Every pitch carries an opt-out line, and a "no" means no follow-up.
4. Never pitch the same person twice.
5. Report the stats honestly, including the drops.
6. Skim the leads before emailing. Venues, concert filmers, fan accounts and curators slip through,
   and emailing one of those is how a sender reputation gets ruined.

Each skill's `SKILL.md` has its full option list, the API notes behind it and the gotchas found while
building it — worth reading before you change a filter.
