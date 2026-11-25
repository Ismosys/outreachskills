# Multiple Gmail accounts

Why more than one inbox: one Gmail can only carry so much cold outreach before the replies dry up and
the sends start landing in spam. Splitting a run over several accounts keeps each one's daily volume
low and human-looking, and each inbox gets its own sender name, so a pitch reads as coming from a
person rather than a pipeline.

A working setup is **5–10 accounts at 20–25 drafts a day each**, which is 100–250 pitches a day in
total. That's the number the scouts are tuned to feed.

Nothing here sends mail. `tools/draft-gmail.mjs` writes **drafts** into each account's Drafts folder
over IMAP. You open Gmail, read them, and press Send yourself.

## 1. Create the accounts

Make each one at [accounts.google.com/signup](https://accounts.google.com/signup). Practical notes:

- Google will ask for a phone number for some of them and only allows a few accounts per number
  (commonly about four), so expect to need more than one number, or to space the signups out over
  days. Don't buy SMS verification services; accounts made that way get disabled in batches.
- Give each account a **real, different sender name** — the persona that signs its pitches. A name
  that matches the account's own email address is the point; don't use the same name on all ten.
- Set a recovery email on each one. Accounts without recovery are the ones that lock you out.
- Use addresses that look like a person, not `musicwebsites.offers.47@gmail.com`. The address is the
  first thing an artist sees.
- Log in to each one in a browser at least once and send a couple of normal, real emails before using
  it for outreach. A brand-new inbox whose first ever action is 25 cold emails is the classic spam
  signature.

## 2. Turn on 2-Step Verification

App passwords only exist on accounts with 2-Step Verification, so for each account:

1. Go to [myaccount.google.com/security](https://myaccount.google.com/security).
2. Turn on **2-Step Verification** and finish the setup.

If 2SV uses **only** security keys, or the account is on Advanced Protection, app passwords are not
available — add another second factor, or use a different account.

## 3. Create an app password

For each account, at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords):

1. Type a name you'll recognise (`outreach drafts`) and create it.
2. Copy the **16 characters** Google shows. That's the only time it's shown.

It's shown in four groups of four. You can paste it with or without the spaces — the script strips
them. This is never your normal Gmail password, and a normal password will be rejected.

If the App passwords page doesn't appear at all, 2-Step Verification isn't fully on yet. Google
Workspace accounts are a different story — app passwords have been restricted for them, so use free
Gmail accounts for this.

**You do not need to enable IMAP.** Gmail removed that setting in January 2025; IMAP is on for every
account now. Any guide telling you to flip a toggle under *Forwarding and POP/IMAP* is out of date.

## 4. Put them in senders.json

Create `~/.claude/artist-reach/senders.json` (`./install.sh` makes the folder):

```json
[
  {
    "name": "Alex Mercer",
    "email": "alex.mercer.music@gmail.com",
    "appPassword": "abcd efgh ijkl mnop",
    "dailyCap": 20,
    "enabled": true
  },
  {
    "name": "Jamie Hart",
    "email": "jamiehart.studio@gmail.com",
    "appPassword": "qrst uvwx yzab cdef",
    "dailyCap": 20,
    "enabled": true
  }
]
```

| Field | What it does |
|---|---|
| `name` | Signs the pitches from this inbox — it replaces `[Your Name]` in the body. Give each account its own. |
| `email` | The Gmail address. |
| `appPassword` | The 16 characters from step 3. |
| `dailyCap` | Most drafts this inbox gets in a day. Counted across runs. |
| `enabled` | `false` parks an account without deleting it. |

This file holds live credentials. Keep it out of git (the repo's `.gitignore` covers the default
location, which is outside the repo anyway) and `chmod 600 ~/.claude/artist-reach/senders.json`.
Move it elsewhere with `$ARTIST_REACH_SENDERS`.

## 5. Check every login before you rely on it

```bash
node tools/draft-gmail.mjs --test
```

It signs in to each account, finds its Drafts folder, and prints the room left today:

```
ok   alex.mercer.music@gmail.com → [Gmail]/Drafts (20 of 20 left today)
FAIL jamiehart.studio@gmail.com: Gmail rejected the app password...
```

Do this when you add an account, and again any time drafting starts failing.

## 6. Draft across all of them

```bash
node tools/pitch.mjs leads.json --name "" --record        # leads → pitches
node tools/draft-gmail.mjs leads-pitches.json             # pitches → Gmail drafts
```

Leave `--name` off (or empty) when drafting this way: each inbox signs with its own `name` from
`senders.json`, so a name baked in by `pitch.mjs` would override it.

Add `--dry-run` first to see which inbox gets whom without touching Gmail. `--senders "a@gmail.com,b@gmail.com"`
limits a run to certain accounts.

### How the spreading works

One shared queue. Every enabled inbox opens its own IMAP session in parallel and keeps taking the
next pitch until its own cap is used up. So:

- Accounts fill evenly, round-robin, without you planning it.
- An account whose login fails doesn't strand its share — the others take those pitches. You get a
  clear error naming the account, and the leftovers say `couldn't sign in to that inbox`.
- Before each draft, that inbox's **Sent and Drafts are searched for the recipient**. If it already
  wrote to them, it's skipped there and doesn't use a cap slot. That's what stops you pitching the
  same artist twice from the same address, even if you pitched them by hand months ago.
- Anything left when every cap is full is reported as `daily caps reached — run again tomorrow`. The
  pitches file keeps them; just run the same command again the next day.

Counts live in `~/.claude/artist-reach/daylog.json`, keyed by day, so two runs in one afternoon share
the same caps instead of doubling them.

## Caps and warm-up

Daily caps are about not burning accounts. A sensible ramp for a new inbox:

| Days | Cap |
|---|---|
| 1–3 | 5–10 |
| 4–7 | 10–15 |
| 2nd week on | 20–25 |

Don't go past about 30 a day on a free Gmail account for cold outreach, however much room the
sending limit technically leaves. The limit that matters is the one where recipients start marking
you as spam, and it's far below Google's.

Signals to watch, and what to do:

- **Replies stop entirely** across an account — lower its cap, or park it (`"enabled": false`) for a
  week.
- **Drafts you send start bouncing or vanishing** — stop using that account for outreach.
- **Google asks for a phone re-verification** on an account — do it immediately from a browser and
  leave the account alone for a couple of days.

Spreading the same volume over more accounts is always safer than raising a cap.

## Keeping the pitches worth sending

The rotation only helps if what you send is worth reading:

- Every pitch carries an opt-out line. Keep it. A "no" means no follow-up, ever.
- Send to people who genuinely have no website. That's what the scouts' filters are for, and it's
  the only reason the pitch isn't spam.
- Read the drafts. Each one names a real release or episode; if a lead's looks wrong, delete the
  draft instead of sending it. One pitch quoting a release that isn't theirs costs more than ten
  good ones earn.
- Don't send the same pitch twice from a different inbox to dodge the skip. The pitch versions rotate
  per person by design (`pitch/README.md`), not per attempt.

## When it breaks

| What you see | What it is |
|---|---|
| `Gmail rejected the app password` | 2SV not on, password mistyped, or you used the normal account password. Create a fresh app password. |
| `could not connect to imap.gmail.com` | Network or firewall on port 993. Nothing to do with Google. |
| `could not find the Drafts folder` | Rare: the account's Gmail labels are in an odd state. Open Gmail in a browser once and retry. |
| `Every account has hit its daily cap` | Expected. Run again tomorrow, or add accounts. |
| `No pitches with an email, subject and body` | You passed a leads file, not a pitches file. Run `tools/pitch.mjs` on it first. |

The script talks plain IMAP with no dependencies, so there's nothing to install and nothing that can
go out of date except Gmail's own rules.
