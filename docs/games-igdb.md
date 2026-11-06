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

Checked on 2026-11-06 against IGDB's API documentation (api-docs.igdb.com)
and the Twitch Developer Services Agreement (last modified 2024-12-04).

**Confirmed**

- IGDB says the API is "free for non-commercial usage under the terms of the
  Twitch Developer Service Agreement".
- IGDB "offer[s] commercial partnership for users with a commercial need" and
  asks for contact at partner@igdb.com. Its FAQ says "the API is free for both
  non-commercial and commercial projects".
- As part of the commercial partnership, IGDB asks for "user facing
  attribution to IGDB.com … visible to your users and located in a static
  location (e.g. not in a change log)".
- The IGDB FAQ says local storing and caching is allowed and preferred.
- Rate limit: 4 requests per second, 8 open requests.
- **Twitch agreement:**
  - **Keys:** "Keep them secret. Also, you may not sell, transfer, or
    sub-license them." That is why Nexa must never ship shared credentials.
  - **Source and attribution:** apps must give "a clear path to the source
    from displays of Program Materials" and "appropriately attribute" them.
  - **Re-distribution:** re-syndication and re-distribution of API data is
    prohibited.
- **Where Nexa stands today:**
  - Each user is the developer of their own Twitch application.
  - Game pages link to IGDB ("View on IGDB").
  - Settings → Games credits IGDB.com.

**Needs clarification before distributing to others**

- **Commercial status.** If Nexa is or becomes monetized (paid tiers,
  donations tied to features), contact partner@igdb.com. Bring-your-own
  credentials put each user under the Twitch terms, but don't settle Nexa's
  own position as a distributed product that displays IGDB data.
- **Storage beyond 24 hours.** The Twitch agreement allows caching Program
  Materials "for only a twenty-four hour time period" unless Twitch authorizes
  more "through these terms or otherwise". IGDB's FAQ permits local storage,
  but whether that FAQ counts as the authorization isn't stated.
  - What Nexa keeps longer than 24 h is the user's own Wishlist snapshot (name,
    release date, image URL) and the copy synced to their own Nexa account.
  - Discovery data lives only in memory.
- **Static attribution.** Discovery screens credit IGDB only through game-page
  links and the Settings line. If a partnership is needed, a static "Game data
  by IGDB.com" credit on the Games screens would meet IGDB's guidance.
- **The web build** can't use IGDB (no CORS and no secure store), so Games
  there is desktop-only unless a proxy is added.

## Known limitations

- Adult-named titles without IGDB's Erotic theme can still appear when
  searched by name (Stage 4 finding; no extra filter decided).
- On Linux, Flatpak and mobile, IGDB credentials can't be saved, because
  there is no secure store backend yet.
- The RAWG legacy provider still depends on RAWG being reachable for
  Discovery. Saved RAWG games always open from their snapshots.
- The Games hero pauses when the window is minimised by listening for the
  shell's focus-change event. Minimising a window that already lost focus
  (for example, from the taskbar preview) isn't reported, so the hero keeps
  rotating there, as it did before Stage 7.
