# Pitch templates

`shared.js` is the pitch writer, lifted from the Artist Reach Drafter Chrome extension. It's a plain
browser-style script (it hangs an `ARD` object off `self`), which both
`skills/artist-reach-run/scripts/run.mjs` and `tools/pitch.mjs` load in a `node:vm` sandbox.

The parts worth knowing:

- `toItems(leads)` — normalises a leads array from any scout (it accepts `found_on`/`platform`,
  `profile_url`/`url`, `email`/`booking_email` and so on), picks a pitch for each, and marks the ones
  to skip with a reason: no name, no email, found on Bandcamp, duplicate in this batch.
- `pitchParts(lead)` — the templates themselves. It returns `{ subject, body, variant }`.
  Nine approved versions: **artist A/B/C**, **producer A/B**, **podcaster A/B**, with extra lines for
  a lead who is on Patreon and for a band whose name starts with "The". The version is chosen by a
  hash of the email, so one person always gets the same pitch and a run stays evenly spread.
- `signOff(text, name)` — swaps `[Your Name]` for yours. Leave the name off and the drafts keep the
  placeholder, which is a useful reminder that they aren't ready to send.
- `buildPrompt`, `buildDirectPrompt`, `buildMorePrompt`, `buildPitchPrompt` — the prompts the Chrome
  extension pastes into claude.ai to find artists by hand, instead of scraping. Unused by the scouts,
  kept because they're a decent fallback when a scraper breaks.

Every pitch ends with an opt-out line. Keep it there.

If you rewrite the copy, edit `pitchParts` and reinstall (`./install.sh`) so
`~/.claude/artist-reach/shared.js` gets the new version.
