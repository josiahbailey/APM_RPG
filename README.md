# APM RPG

> A gamified RPG layer for Amazon's APM/PTP. Level up while you work, catch pets between clicks, and chase rare variants that appear once in ten thousand spawns.

A Tampermonkey userscript that overlays a lightweight RPG panel on Amazon's Enterprise Asset Management (EAM/APM) and PTP web interfaces. Completing work orders, creating new ones, and submitting PTPs grants EXP; leveling up unlocks characters, banners, and pet slots. Wild pets appear on the page for you to catch, with rare variants (Shiny, Gold, Rainbow) and per-variant celebration effects.

Zero backend. All state lives in Tampermonkey's storage, scoped to your browser profile.

---

## Features

- **Progression system** — EXP from real APM actions, character/banner unlocks tied to level thresholds
- **Three pet slots** — unlock at Lv 1, 10, 20; each roams the page independently
- **Wild pet catches** — 3% chance to spawn on page load or SPA navigation; click to attempt catch
- **Rare variants** — Shiny (0.1%), Gold (0.03%), Rainbow (0.01%), each with dedicated audio + visual celebrations
- **Pokédex** — track which pets and variants you've caught
- **In-panel update button** — polls the hosted script hourly; pulses green when a newer version is available
- **Fully self-contained** — no external assets, no network calls except the update check, no telemetry

## Supported hosts

The script activates on these domains:

- `*.eam.hxgnsmartcloud.com`
- `*.sso.eam.hxgnsmartcloud.com`
- `*.eam.aws.a2z.com`
- `*.ptp.amazon.dev`
- `*.insights.amazon.dev`

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser (Chrome, Edge, Firefox, Safari all supported).
2. Open the raw userscript URL:
   ```
   https://raw.githubusercontent.com/josiahbailey/APM_RPG/main/apm-rpg.user.js
   ```
3. Tampermonkey will detect the `.user.js` extension and show an install prompt. Click **Install**.
4. Navigate to an APM/PTP tab. The RPG panel appears at the top-left of the page.

Once installed, updates are handled automatically: Tampermonkey polls the raw URL on its own schedule (default daily), and the script itself checks hourly and surfaces a pulsing **UPDATE →** button in the panel when a newer version is available. Clicking the button opens the raw URL in a new tab, triggering Tampermonkey's install-diff view.

## Earning EXP

The script watches for button clicks matching known APM actions:

| Action | EXP | Detection |
|---|---:|---|
| Complete Work Order | 50 | Button text matches `/\bcomplete\b/` (excluding "incomplete") |
| Create Work Order | 30 | Button text starts with `create` or `new` |
| Submit PTP | 40 | On PTP host; button text starts with `submit` |

XP required to reach level *n* is `floor(100 * n^1.35)`, so leveling gets slower as you climb.

## Catching pets

Wild pets appear at random on the page (3% roll on load / hashchange / popstate). Click the wild pet up to three times to attempt a catch. The chance is set by the pet's base rate:

| Pet | Rarity | Spawn weight | Base catch rate |
|---|---|---:|---:|
| Slime | Common | 60 | 70% |
| Fox | Rare | 30 | 35% |
| Dragonet | Legendary | 10 | 10% |

### Variants

Each spawn independently rolls for a rare variant, cascading from rarest to most common:

| Variant | Chance | Celebration |
|---|---:|---|
| Rainbow | 0.01% (1 in 10,000) | 100 particles, screen flash, panel shake, 8-note arpeggio sweep, conic-gradient banner |
| Gold | 0.03% (3 in 10,000) | 50 particles, amber screen flash, 4-note brass fanfare, gradient banner |
| Shiny | 0.1% (1 in 1,000) | 28 particles, 3-note arpeggio, gold banner |
| Normal | 99.87% | 14 particles, 2-note confirm chime |

Catch rate is the same across all variants — rarity is expressed by spawn chance alone.

## Debug API

The script exposes a debug interface on `window.APM_RPG` for testing and development:

```js
APM_RPG.grantXP(500);              // Grant EXP directly
APM_RPG.setLevel(20);              // Jump to a specific level
APM_RPG.spawn();                   // Force a wild spawn
APM_RPG.spawnVariant('rainbow');   // Force a specific variant
APM_RPG.rollSpawn();               // Roll a natural spawn attempt
APM_RPG.despawn();                 // Remove the current wild pet
APM_RPG.detect();                  // Show detected username / alias
APM_RPG.setUsername('alias');      // Override the displayed username
APM_RPG.checkUpdate();             // Force an update check (ignores cache)
APM_RPG.updateInfo();              // Show local/latest version + last check time
APM_RPG.state;                     // Live state object (player, equip, collection)
APM_RPG.reset();                   // Wipe all state and reload
```

Open Chrome DevTools on any APM tab and paste any of the above into the console.

## Storage

The script uses Tampermonkey's `GM_setValue` API. State is scoped per browser profile and never leaves your machine.

Keys (all v2/v4 to reflect schema migrations):
- `apm_rpg_version` — schema version marker
- `apm_rpg_player_v2` — level, XP, username
- `apm_rpg_collection_v2` — caught pet instances (with variants)
- `apm_rpg_equip_v2` — currently equipped character, banner, pet slots
- `apm_rpg_starter_granted` — first-catch bootstrap flag
- `apm_rpg_update_v1` — cached remote version info

Data migrates forward on load; v1 → v2 → v3 → v4 is handled transparently. To wipe everything, use the small **Reset** button at the bottom-left of the page or `APM_RPG.reset()`.

## Dev mode

Set `const DEV_MODE = true` at the top of the script to disable persistence — state resets on every page load. Useful when iterating on features without spending hours grinding levels.

## Development

The script is a single file, no build step, no bundler. Edit `apm-rpg.user.js` directly, save, and Tampermonkey picks up the change on next page load (or click **Reset changes** in the Tampermonkey dashboard to force a refresh).

### Layout

```
apm-rpg.user.js
├── @UserScript metadata block          (lines 1-25)
├── CONFIG                              (characters, banners, pets, XP, variants)
├── FRAME GUARD                         (subframe → top-frame username relay)
├── STORAGE / MIGRATIONS                (v1 → v4 cascade)
├── UPDATE CHECK                        (GM_xmlhttpRequest poller)
├── STYLES                              (inline CSS via GM_addStyle)
├── UI                                  (buildPanel, renderPanel, DEX, menus)
├── AUDIO + CELEBRATION                 (Web Audio synth, particles, banners)
├── PETS / SPAWNS / CATCH               (wild spawn, click-to-catch, roamers)
├── XP HOOKS                            (button-click detection on APM actions)
├── BOOT                                (bootstrap + username detection loop)
└── DEBUG API                           (window.APM_RPG)
```

### Versioning

Bump `@version` in the metadata block before pushing. Tampermonkey compares versions using standard semver-style dotted-integer comparison; higher wins.

### Publishing

Push to Gitfarm:

```
git add apm-rpg.user.js
git commit -m "vX.Y.Z: <summary>"
git push origin main
```

The raw URL refreshes within seconds of the push (GitHub CDN cache). Users on `< X.Y.Z` will see the update button within an hour (or on their next page load if their cache is stale).

## Compatibility

- **Browsers:** any Chromium browser, Firefox, or Safari with Tampermonkey installed
- **Tampermonkey:** v4.13+ recommended (for `GM_xmlhttpRequest` and `@connect` support)
- **APM/PTP:** works with the current EAM web UI and PTP dev/insights portals as of 2026

## Support

Bugs, feature requests, and RPG balance concerns: file an issue against this package or ping @baijosis.

## License

Amazon internal. Not for external distribution.
