---
name: artist-reach-run
description: One-command artist outreach run. Scouts YouTube/YouTube Music and X in parallel for active independent musicians with NO website and a public email (English-speaking countries plus some of Europe, no Nigeria), until 100 new ones are found, then writes a pitch for each and saves the drafts across all Gmail accounts added in Reverb. Use when the user asks for an outreach run, "find 100 artists and draft them", "run artist reach", or wants leads plus Gmail drafts in one go.
---

# Artist Reach run (YouTube + X → pitches → Gmail drafts)

> **Without the Reverb Mac app** there is no Gmail drafting and no shared contact list, so run with
> `--no-draft` and turn the saved run file into pitches with the repo's
> `node tools/pitch.mjs <runs/file.json> --name "Your Name" --record`. Everything below about
> `/ard/...`, pairing codes and drafts per inbox needs Reverb; the scouting and the pitch writing do not.

```bash
cd ~/.claude/skills/artist-reach-run/scripts
node run.mjs                         # defaults: target 200, 40 genres × 96 cities (3,840 genre×city searches) shuffled, 90 min max, 10 YouTube workers, X 150 requests
```
Run with the sandbox off (it talks to Reverb on 127.0.0.1:47821 and to the X Chrome profile). Use a 600000 ms timeout,
or `run_in_background` for the full 100.

Options: `--genres "a,b"`, `--cities "x,y"`, `--minutes 40`, `--x-requests 150`, `--no-x`, `--yt-workers 3`,
`--senders "a@gmail.com,b@gmail.com"` (default: all Reverb Gmail accounts), `--no-draft` (find and reserve only).

## Who it finds
Artists, bands and producers (`--roles artists,bands,producers`). Producers come from "<genre> producer <city> beats" and
"<genre> type beat" searches, and BeatStars/Airbit/Traktrain count as platforms, not an own website. Producers show emails far more
often, so they are capped at `--producer-share 0.34` of a run. Each lead has `role`, and the pitch adapts: for producers it pitches
a beat store with licensing, custom beats and a placements contact. A band named "The …" gets "Hi there," plus "I found The … on …".
YouTube subscriber minimum for runs: `--min-subs 100`.

## What it does
1. Starts 3 YouTube scout workers (`youtube-artist-scout`, 2 genre×city pairs per batch) and 1 X scout (`x-artist-scout`).
2. Each batch's leads are deduped and **reserved** on Reverb's shared contact list (`/ard/reserve`), so they are never
   found again in any Chrome profile or run. Stops at `--target` or the time limit.
3. Writes a pitch for each with the Chrome extension's template (`artist-reach-extension/shared.js` `toItems`/`pitchFor`,
   signed `[Your Name]`).
4. Sends them to Reverb (`/ard/jobs`), which drafts over IMAP across the Gmail accounts, each up to its daily cap. Overflow
   is reported as `left`. Artists already emailed from that inbox are skipped.
5. Saves everything to `runs/<timestamp>.json` and prints stats, drafts per inbox, and the lead list.

## Needs
- Reverb app open (bridge). Gmail accounts added in Reverb → Artist Reach → Gmail Accounts (app passwords).
- X login in the Agent Reach profile (see `x-artist-scout`). If X fails, the run continues on YouTube only.

## Filters (both scouts)
No own website (link, Linktree, or any non-free-mail email domain, which means a label, manager or own site), a public email, active
recently, on Spotify/Apple Music/YouTube Music/SoundCloud/Bandsintown, follower range, not a label/archive/promo channel,
not in Nigeria and other off-target countries (YouTube: channel country must be an English-speaking country or NL/DE/SE/DK/NO/BE/FI;
X: free-text location check).

## Report to the user
Found N (YouTube / X), drafts per inbox, left for tomorrow, time taken, and any weak-looking leads to delete.

## If drafting was missed
If Reverb was closed when a run finished, the artists are reserved but not drafted (contacts.json status `reserved`).
The runner now waits up to 10 minutes for Reverb. To recover a saved run: `node draft-saved.mjs ../runs/<file>.json`
(it drafts only the items still `reserved`). Launch Reverb with `env -u ELECTRON_RUN_AS_NODE open -a Reverb` (sandbox off).

## Podcasters, Patreon and pitch versions (added 2026-11-25)
- Each run is ~30% podcasters (`--podcast-share 0.3`, `--no-podcasts` to turn off) from the podcast-scout skill, ~25% max producers, the rest artists and bands. If podcasts run short, musicians fill the remaining places.
- YouTube roles include `patreon` (musicians who link a Patreon). Leads on Patreon get `patreon: true`, and the pitch mentions their Patreon.
- Pitches rotate approved versions (artist A/B/C, producer A/B, podcaster A/B), picked by a hash of the email, each with its own subject and an opt-out line. Output shows `byVariant` and `onPatreon`.
- A Patreon worker (patreon-scout skill) runs alongside the others as a bonus source (`--no-patreon` turns it off). It yields about 0.5% of creators checked, and its leads count toward the same role caps.
