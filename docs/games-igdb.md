# Games on IGDB: provider policy, data safety and release notes

This page records how Games chooses its metadata provider, how credentials are
handled, what keeps the Game Library safe across updates and downgrades, and
what is still open before Nexa is distributed to other people.

## Provider policy

Games uses **IGDB** unless this device has explicitly chosen **RAWG (legacy)**
in Settings → Games → Game data provider. The rule is the same in development
and release builds.

- The choice is one device-local localStorage key, `nexa.gamesProvider`. Only
  the exact value `rawg` selects RAWG. Anything else, including no value, is
  IGDB.
- The key is outside the `harbor.` namespace. It is not in backups, cloud
  side-stores, Settings or Supabase, and a sign-out doesn't wipe it. That
  matches the IGDB credentials, which are device-local too.
- Nothing switches provider by itself:
  - not a stored RAWG key;
  - not a synced `gamesEnabled`;
  - not saved RAWG games;
  - not an outage or error.

  There is no runtime fallback, so one list never mixes RAWG and IGDB ids.

- Games stays **off by default**. Turning it on needs the active provider to be
  ready: verified IGDB credentials on this device, or a verified RAWG key
  while RAWG is chosen. Turning it off is always allowed and keeps credentials,
  keys and saved games.
- Kid profiles still can't open Games, Games search or Settings.

### Existing installations

- **Released 0.9.28 (`main`)** has no Games code, so released users have no
  Games settings to migrate.
- **Development builds before Stage 7** used the switch key
  `nexa.dev.gamesProvider`, where no value meant RAWG. Stage 7 never reads that
  key and removes it on first start. Those installations now start on IGDB. A
  RAWG key they stored remains in Settings and can be used again by choosing
  RAWG (legacy).
- **Accounts with `gamesEnabled` synced from a development build:** Games is on
  when such an account signs in on a new device. Until IGDB credentials are
  verified there, Games shows "Connect IGDB" with a link to Settings, and the
  Game Library opens from its saved snapshots.
- **Development and release builds don't share localStorage.** Development
  runs at `http://localhost:1420` and release at `http://tauri.localhost`, so
  the provider choice and the Game Library blobs are separate per build, much
  like two devices on one account. Both start on IGDB.

## Credentials

- **Bring your own:** each user registers their own Twitch application (Client
  ID and Client Secret). Nexa ships no shared credential.
- **Storage:** the secret enters Rust once, through `igdb_set_credentials`, and
  is stored in Windows Credential Manager (`twitch-app.Nexa IGDB`) or the macOS
  Keychain. Other platforms report "unsupported", and there is no plaintext
  fallback.
- **The access token** is held only in memory. It is renewed 24 h before
  expiry, and after a 401 it is renewed once and retried once. A second 401
  marks the credentials rejected.
- **What the frontend sees:** a status (storage, state, the last 4 characters
  of the Client ID). It never receives the secret or the token. Errors are
  fixed messages.
- **`igdb_query`** accepts only an allowlisted endpoint name and a validated
  Apicalypse body. It isn't a general HTTP proxy.
- **Transport:** HTTPS only, no redirects, no system proxy, and only two fixed
  hosts (`id.twitch.tv`, `api.igdb.com`). Every command checks that it came
  from the main window's bundled origin.
- **Rate limits:** a Rust limiter allows 4 requests/s with at most 4 open.
  429 responses back off 250, 500 and 1000 ms, and 5xx back off 500 and
  1500 ms.
- **Scope:** development and release builds share one credential entry for the
  Windows user. This is deliberate: both are the user's own binaries running as
  the same OS user, and a separate entry would add re-entry without a security
  boundary.
- Accounts and profiles don't change the credentials. "Replace" writes the new
  ID and secret together in one write, and "Remove" deletes the entry and
  forgets the token.

## Game Library data safety

Saved games are never rewritten automatically. A RAWG record keeps its `rawg:N`
id, snapshot, notes, order and collection membership. Only the reviewed
one-to-one catalog slugs are treated as the same game across providers. The
Assassin's Creed Chronicles games, remakes, remasters and editions never link.

### Before updating, reinstalling, downgrading or switching builds

1. Sign in, and make sure you're online.
2. Open **Settings → Games → Game Library sync** and press **Sync now**.
3. Go ahead only once it says **"Everything is synced"**.

Once it says that, the cloud holds every game change from this device. An
older Nexa can then lose nothing that can't be recovered:

- No older build deletes or changes game rows in the cloud. Builds before IGDB
  ignore `igdb:` rows, and 0.9.28 doesn't sync games at all.
- Back on a current build, or on any device, the next sync restores everything.

A test in `tests/game-library-sync.test.ts` proves this. It syncs, wipes the
local copy, and recovers every row, IGDB rows included, on a fresh device.

### Limits that can't be fixed in this build

- **0.9.28 signing out:** 0.9.28 wipes `harbor.games.library.*` on sign-out
  without checking for unsynced changes. The upload queue
  (`harbor.cloud.games.queue.v1`) survives that wipe and is sent by the next
  current build. Changes that were never queued, such as those made while
  signed out, are lost if they weren't synced first.
- **Pre-IGDB development builds** drop `igdb:` rows from this device's blob
  the next time they save it. Rows already synced stay in the cloud and come
  back. Rows that were never synced are lost.
- **Future versions:** this build keeps only the fields and id formats it
  knows. A later version that adds new kinds of game ids or fields must keep
  them readable by this build, or the same "sync before downgrading" rule
  applies.

## Licensing and distribution

Checked on 2026-11-06 against IGDB's API documentation and its Business FAQ
(api-docs.igdb.com), and the Twitch Developer Services Agreement (DSA, last
modified 2024-12-04). This is a reading of the published terms, not legal
advice. Bring-your-own credentials don't remove Nexa's own obligations as the
app that displays the data.

**What the terms say**

- **Access:** "The IGDB.com API is free for non-commercial usage under the
  terms of the Twitch Developer Service Agreement." IGDB "offer[s] commercial
  partnership for users with a commercial need" (partner@igdb.com).
- **IGDB Business FAQ:**
  - 1: commercial use is allowed through a partnership, and "as part of the
    partnership, we ask for user facing attribution to IGDB.com".
  - 2: "The API is free for both non-commercial and commercial projects."
  - 3: "Am I allowed to store/cache the data locally? Yes. In fact, we prefer
    if you store and serve the data to your end users."
  - 4: attribution should be "visible to your users and located in a static
    location (e.g. not in a change log)".
  - 5: on partnership termination, "You are allowed to keep all data you
    retrieve."
- **Twitch DSA:**
  - **Keys:** "Keep them secret. Also, you may not sell, transfer, or
    sub-license them."
  - **Storage:** "Do not store copies of Twitch Content or Program Materials,
    unless you: (a) obtain prior written authorization from Twitch (through
    these terms or otherwise); (b) control the rights associated with such
    content; or (c) cache such information for only a twenty-four hour time
    period without further sharing it with third parties."
  - **Re-distribution:** "Re-syndication and re-distribution of Program
    Materials or data as available from a Twitch API is prohibited."
  - **Attribution:** apps must ensure "a clear path to the source from
    displays of Program Materials" and "Appropriately attribute" them.
  - **Commercial use:** a separate agreement is needed for the listed
    prohibited or restricted commercial uses (marketing, data brokering,
    selling metadata).
- **Rate limit:** 4 requests per second, 8 open requests.

**The apparent difference**

IGDB's FAQ explicitly allows, and prefers, storing and caching its data
locally. The DSA, which IGDB names as the terms for non-commercial use,
allows storing "Program Materials" for only 24 hours unless Twitch authorizes
more "through these terms or otherwise".

The FAQ is plausibly that authorization for IGDB data, but neither document
says so. The FAQ's storage answer also sits in a section about commercial
partnerships, so it's unclear whether it covers free non-commercial use.

What Nexa keeps longer than 24 hours:

- each saved game's snapshot: name, slug, release date and the IGDB image
  URL (not the image), plus the user's own notes and order;
- the copy of that snapshot synced to the user's own Nexa account.

Discovery results live only in memory, for one session. Image files are
cached by the WebView's ordinary HTTP cache.

**Where Nexa stands**

- Each user registers and uses their own Twitch application. Nexa ships no
  shared key.
- A static, linked "Game data and images provided by IGDB.com" footer is on
  every Games screen (Discovery, Browse, game and franchise pages) and in the
  Game Library. Game pages also link to the game on IGDB ("View on IGDB"), and
  Settings → Games credits IGDB.com.
- Nothing re-distributes IGDB data. Synced snapshots go only to the same
  user's own account.

**To clarify with IGDB (partner@igdb.com) before distributing Nexa to others**

1. Whether the FAQ's "store/cache the data locally" permission applies to
   free, non-commercial use under the DSA. In particular, whether keeping a
   user's own saved-game snapshots (name, date, image URL) beyond 24 hours,
   including in their own cloud account, is allowed.
2. Whether a free, open-source desktop client where every user brings their
   own Twitch application counts as non-commercial. Also, what changes if
   Nexa ever takes donations or offers paid features.
3. Whether the current footer attribution is sufficient.

The web build can't use IGDB (no CORS and no secure store), so Games there is
desktop-only unless a proxy is added.

## Known limitations

- Adult-named titles without IGDB's Erotic theme can still appear when
  searched by name (Stage 4 finding; no extra filter decided).
- On Linux, Flatpak and mobile, IGDB credentials can't be saved, because
  there is no secure store backend yet.
- The RAWG legacy provider still depends on RAWG being reachable for
  Discovery. Saved RAWG games always open from their snapshots.
- The Games hero holds its slide while the window is minimised or hidden to
  the tray. It asks Windows before each slide change. The Movies Home hero is
  unchanged and keeps rotating underneath, as it always has.
