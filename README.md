# APM RPG

> A quiet RPG layer for Amazon's EAM / APM. Level up while you work, catch pets between clicks, and chase rare variants that appear once in a thousand spawns.

A Tampermonkey userscript that overlays a lightweight RPG panel on top of EAM (Enterprise Asset Management) and PTP web interfaces. Navigating around the app grants XP; leveling up unlocks characters, banners, and pet slots. Wild pets appear on the page for you to catch, with rare variants (Shiny, Hollow, Rainbow) and per-variant celebration effects.

Zero backend. All state lives in Tampermonkey's storage, scoped to your browser profile.

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Open the raw userscript URL:
   ```
   https://raw.githubusercontent.com/josiahbailey/APM_RPG/main/apm-rpg.user.js
   ```
3. Tampermonkey shows an install prompt. Click **Install**.
4. Open an EAM / APM / PTP tab. The RPG panel appears at the top-left.

Updates are automatic: Tampermonkey polls the raw URL on its own schedule, and the script itself checks hourly. When a newer version exists, a pulsing **UPDATE →** button appears in the panel; clicking it opens the raw URL so Tampermonkey can install the diff.

## Supported hosts

- `*.eam.hxgnsmartcloud.com`
- `*.sso.eam.hxgnsmartcloud.com`
- `*.eam.aws.a2z.com`
- `*.ptp.amazon.dev`
- `*.insights.amazon.dev`

## How to play

APM RPG runs quietly in the background while you work. Every time you navigate around EAM, you have a chance to earn **XP** and to spot a **wild pet** drifting across your screen — click it to try to catch it. Level up to unlock extra pet slots, new character portraits, and new banners. That's it. Get to work.

## Earning XP

XP comes from two sources:

| Source | XP | Trigger |
|---|---:|---|
| **Nav activity** | 5 | 15% chance per SPA nav event (see below) |
| **Catch a wild pet** | 5 – 500 | Rarity-scaled, see rarity table |

XP required to reach level *n* is `floor(100 * n^1.35)`, so climbing gets steadily slower.

### What counts as "nav activity"?

EAM is a same-origin-iframe SPA that rarely uses `pushState`. The script hooks four navigation signals inside every same-origin frame:

- `XMLHttpRequest` calls to any host on `*.eam.hxgnsmartcloud.com`, `*.eam.aws.a2z.com`, `*.ptp.amazon.dev`, or `*.insights.amazon.dev`
- The same, over `fetch()`
- `history.pushState` / `replaceState`
- `popstate` and `hashchange` events

Heartbeat / session-keepalive endpoints (`SESSION`, `BSFOOTR`, `KEEPALIVE`, `BSTIMR`, `IDLTIMR`) are filtered out so idle tabs don't grind XP.

A 2 s cooldown prevents burst navigations from double-counting. Each qualifying event rolls a 15% chance to grant XP and independently rolls a wild-spawn check.

## Wild pets

Wild pets spawn on page load and on qualifying nav events, at a 5% roll each time. A spawn:

- Picks a pet using weighted-random selection (see rarity table)
- Independently rolls for a Shiny / Hollow / Rainbow variant
- Places the pet in the arc-shaped roam zone around the RPG panel
- Gives you **3 catch attempts** — each click rolls against the pet's base catch rate

Catch rate is uniform across variants; rarity affects only spawn chance and XP reward.

### Rarity table

| Rarity | Spawn weight | Base catch rate | Catch XP | Pets |
|---|---:|---:|---:|---:|
| Common | 60 | 60% | 5 | 10 |
| Rare | 25 | 40% | 15 | 6 |
| Epic | 10 | 20% | 50 | 4 |
| Legendary | 4 | 15% | 150 | 4 |
| Ancient | 1 | 10% | 500 | 2 |

Each pet in a rarity gets that spawn weight, so 10 commons at weight 60 each vs. 2 ancients at weight 1 each means commons are heavily favored.

### Variant table

Every wild spawn independently rolls for a variant, cascading rarest first:

| Variant | Chance | Celebration |
|---|---:|---|
| Rainbow | 0.1% (1 in 1,000) | Rainbow prismatic border, extra particles, sparkle audio |
| Hollow | 0.5% (1 in 200) | Diamond-white glow, particles, chime |
| Shiny | 1% (1 in 100) | Gold star badge, particles, chime |
| Normal | 98.4% | Base sparkle only |

Variants are cosmetic overrides of any base pet and are tracked independently in the Dex.

## Unlock ladder

### Pet slots

| Slot | Unlocks at |
|---|---:|
| 1 | Lv 1 |
| 2 | Lv 5 |
| 3 | Lv 10 |

Each unlocked slot spawns a roamer that drifts around the page. Empty slots stay dark until you assign a pet.

### Characters

The first three portraits are Lv 1 starters. The rest step up by 2 levels each:

| Portraits | Level |
|---|---:|
| Character 1, 2, 3 | 1 |
| Character 4 | 3 |
| Character 5 | 5 |
| Character 6 | 7 |
| Character 7 | 9 |
| Character 8 | 11 |
| Character 9 | 13 |
| Character 10 | 15 |
| Character 11 | 17 |
| Character 12 | 19 |
| Character 13 | 21 |
| Character 14 | 23 |

### Banners

| Banner | Level |
|---|---:|
| None | 1 |
| Forest | 3 |
| Desert | 6 |
| Snow | 9 |
| Night Sky | 12 |
| Volcano | 15 |
| Ocean | 18 |
| Meadow | 21 |
| Void | 24 |
| Gold | 27 |
| Prismatic | 30 |

## Starter selection & how-to modal

On first install, you pick one of three starter pets (Mossmo, Sizzlo, Icedro). Once chosen, a one-paragraph "How to Play" modal appears. Both are guarded by storage flags, so they show exactly once per browser profile — reset your state (below) to see them again.

## Panel

The panel sits at the top-left and holds:

- Character portrait, username, XP bar, and level
- Three pet slots (locked slots show `Lv N`)
- A collapse tab on the right edge — click to slide the panel behind a thin strip
- A **Dex** button that opens the full pet index (species counter, variant labels, per-pet catch history, per-pet release)
- An update button that pulses green when a newer version is available

Clicking the portrait opens the customize menu (character + banner sliders). Clicking a pet slot opens the pet swap menu for that slot.

## Reset & dev mode

Reset the entire save from the panel (small **Reset** button at the bottom left of the page) or from devtools:

```js
__apmRpgReset()
```

Dev mode: set `const DEV_MODE = true;` at the top of the script to disable persistence — every reload starts clean.

## Debug commands

Two ways to call the debug API, both work from the browser devtools console:

**Page-window handles (recommended — bypass the bridge, always reach the current frame):**

```js
__apmRpgHelp()            // list every command
__apmRpgGrantXP(500)      // grant XP
__apmRpgSetLevel(20)      // jump to a level
__apmRpgSpawn()           // force a wild spawn
__apmRpgSpawnVariant('rainbow')  // force a specific variant
__apmRpgToggleBoundary()  // toggle the arc roam-zone overlay
__apmRpgSetVerbose(true)  // enable verbose logging
__apmRpgReset()           // wipe all state and reload
```

**Sandbox API (`APM_RPG.method()`)** is the same surface but goes through a postMessage bridge; it sometimes hits a "bridge timeout" in EAM's sandboxed subframes. Prefer the `__apmRpg*` handles.

For the full list, see `../APM_RPG_test_commands.md` alongside this repo, or run `__apmRpgHelp()` in the console.

## Storage

State lives in Tampermonkey's `GM_setValue` store, scoped per browser profile. Keys:

| Key | Contents |
|---|---|
| `apm_rpg_player_v2` | level, XP, username, flags |
| `apm_rpg_collection_v2` | caught pet instances (petId + variant) |
| `apm_rpg_equip_v2` | equipped character, banner, pet slot instance IDs |
| `apm_rpg_starter_granted` | one-time starter modal flag |
| `apm_rpg_howto_seen` | one-time how-to modal flag |
| `apm_rpg_version` | schema version marker |
| `apm_rpg_installed_version_v1` | last observed installed version (for update banner) |

Migrations from v1 → v2 keys run transparently on load.

## Development

Single file, no build step. Edit `apm-rpg.user.js` and save; Tampermonkey picks up the change on the next page load.

### File layout

```
apm-rpg.user.js
├── @UserScript metadata block
├── CONFIG               (rarities, characters, banners, pets, XP, variants)
├── FRAME GUARD          (subframe → top-frame username relay)
├── STORAGE / MIGRATIONS
├── UPDATE CHECK         (GM_xmlhttpRequest poller + reload flow)
├── STYLES               (inline CSS via GM_addStyle)
├── UI                   (buildPanel, renderPanel, Dex, menus, modals)
├── AUDIO + CELEBRATION  (Web Audio synth, particles)
├── NAV DETECTION        (XHR/fetch/history hooks)
├── WILD SPAWNS + CATCH  (spawn logic, click-to-catch, roamers)
├── BOUNDARY VIZ         (arc roam-zone overlay + debug toggle)
├── BOOT                 (bootstrap + starter + how-to modals)
└── DEBUG API            (APM_RPG_API + __apmRpg* page-window handles)
```

### Versioning

Bump `@version` in the metadata block before pushing. Tampermonkey uses dotted-integer comparison; higher wins.

### Publishing

```powershell
git add apm-rpg.user.js
git commit -m "vX.Y.Z: <summary>"
git push origin main
```

The raw URL refreshes within seconds. Users on older versions see the in-panel update button within an hour.

## Compatibility

- Chromium, Firefox, Safari — anywhere Tampermonkey runs
- Tampermonkey 4.13+ recommended for `GM_xmlhttpRequest` + `@connect`

## Support

Ping @baijosis or open an issue on the repo.

## License

Personal project. Not affiliated with the EAM/APM teams.
