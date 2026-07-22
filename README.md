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

Updates are automatic: Tampermonkey polls the raw URL on its own schedule, and the script itself does a rate-limited check every 5 minutes. When a newer version exists, a small pulsing **UPDATE →** button appears next to the panel; clicking it opens the raw URL so Tampermonkey can install the diff. The button also hides when the panel is collapsed.

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
| **Nav activity** | 5 | 10% chance per SPA nav event (see below) |
| **Catch a wild pet** | 5 – 500 | Rarity-scaled, see rarity table |

XP required to reach level *n* is `floor(100 * n^1.35)`, so climbing gets steadily slower.

### What counts as "nav activity"?

EAM is a same-origin-iframe SPA that rarely uses `pushState`. The script hooks four navigation signals inside every same-origin frame:

- `XMLHttpRequest` calls to any host on `*.eam.hxgnsmartcloud.com`, `*.eam.aws.a2z.com`, `*.ptp.amazon.dev`, or `*.insights.amazon.dev`
- The same, over `fetch()`
- `history.pushState` / `replaceState`
- `popstate` and `hashchange` events

Heartbeat / session-keepalive endpoints (`SESSION`, `BSFOOTR`, `KEEPALIVE`, `BSTIMR`, `IDLTIMR`) are filtered out so idle tabs don't grind XP.

A 2 s cooldown prevents burst navigations from double-counting. Each qualifying event rolls a 10% chance to grant XP and independently rolls a wild-spawn check.

## Wild pets

Wild pets spawn on page load and on qualifying nav events, at a 2.5% roll each time. A spawn:

- Picks a pet using weighted-random selection (see rarity table)
- Independently rolls for a Shiny / Hollow / Rainbow variant
- Places the pet in the arc-shaped roam zone around the RPG panel
- Gives you **3 catch attempts** — each click rolls against the pet's base catch rate

Catch rate is uniform across variants; rarity affects only spawn chance and XP reward.

### Rarity table

| Rarity | Spawn weight | Base catch rate | Catch XP | Pets |
|---|---:|---:|---:|---:|
| Common | 60 | 40% | 5 | 10 |
| Rare | 25 | 30% | 15 | 6 |
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

## Nature Reserve

Released pets accumulate in a **Nature Reserve** panel attached to the left side of the pet-selection inventory. Each release plays a small walk-into-the-reserve animation and increments a `count / 10` meter. When the meter hits 10, the *Summon Pet* button turns green, pulses slowly, and lets you conjure a wild pet on demand.

Reserve summons use a rarity-boosted weight table (only applies to Reserve summons; normal wild spawns keep the base weights):

- Rare, Epic, Legendary, and Ancient per-pet weights are multiplied by 1.5
- Common per-pet weight is scaled down so the overall total still equals the base spawn total

If a wild pet is already on screen when you press *Summon*, the release counter is preserved and the summon is skipped. Otherwise 10 releases are consumed, the pet is summoned with a bouncy scale-in from the reserve, and a rarity-colored toast confirms which pet arrived.

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

On first install, you pick one of three starter pets (Mossmo, Sizzly, Ribub). Once chosen, a one-paragraph "How to Play" modal appears. Both are guarded by storage flags, so they show exactly once per browser profile — reset your state (below) to see them again.

## Panel

The panel sits at the top-left and holds:

- Character portrait, username, XP bar, and level
- Three pet slots (locked slots show `Lv N`)
- A collapse tab on the right edge — click to slide the panel behind a thin strip
- A **Dex** button that opens the full pet index (species counter, variant labels, per-pet catch history, per-pet release)
- An update button that pulses green when a newer version is available

Clicking the portrait opens the customize menu (character + banner sliders). Clicking a pet slot opens the pet swap menu for that slot.

## Compatibility

- Chromium, Firefox, Safari — anywhere Tampermonkey runs
- Tampermonkey 4.13+ recommended for `GM_xmlhttpRequest` + `@connect`

## Support

Ping @baijosis or open an issue on the repo.

## License

Personal project. Not affiliated with the EAM/APM teams.
