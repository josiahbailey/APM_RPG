# PetRPG

> A quiet RPG layer for your browser. Level up while you browse, catch pets between clicks, and chase rare variants that appear once in a thousand spawns.

A Tampermonkey userscript that overlays a lightweight RPG panel on top of any web page. Navigating around the page grants XP; leveling up unlocks characters, banners, and pet slots. Wild pets appear on the page for you to catch, with rare variants (Shiny, Hollow, Rainbow) and per-variant celebration effects.

Zero backend. All state lives in Tampermonkey's storage, scoped to your browser profile.

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Open the raw userscript URL:
   ```
   https://raw.githubusercontent.com/josiahbailey/APM_RPG/main/apm-rpg.user.js
   ```
3. Tampermonkey shows an install prompt. Click **Install**.
4. Open any tab. The RPG panel appears at the bottom-right.

Updates are automatic: Tampermonkey polls the raw URL on its own schedule, and the script itself does a rate-limited check every 5 minutes. When a newer version exists, a small pulsing **UPDATE →** button appears next to the panel; clicking it opens the raw URL so Tampermonkey can install the diff.

## Where it runs

Every site (`*://*/*`). The script runs only in the top frame and stays entirely client-side; no data leaves your browser.

## How to play

PetRPG runs quietly in the background while you browse. Every time you navigate around, you have a chance to earn **XP** and to spot a **wild pet** drifting near the bottom-right of your screen — click it to try to catch it. Level up to unlock extra pet slots, new character portraits, and new banners.

## Earning XP

XP comes from two sources:

| Source | XP | Trigger |
|---|---:|---|
| **Nav activity** | 5 | 15% chance per nav event (see below) |
| **Catch a wild pet** | 5 – 500 | Rarity-scaled, see rarity table |

XP required to reach level *n* is `floor(100 * n^1.35)`, so climbing gets steadily slower.

### What counts as "nav activity"?

The script hooks three navigation signals in every page:

- `history.pushState` / `replaceState` (universal SPA hook)
- `popstate` and `hashchange` events
- A 2 s poll of `location.href` as a fallback for anything that mutates the URL through other paths

A 2 s cooldown prevents burst navigations from double-counting. Each qualifying event rolls a 15% chance to grant XP and independently rolls a wild-spawn check.

## Wild pets

Wild pets spawn on page load and on qualifying nav events, at a 2.5% roll each time. A spawn:

- Picks a pet using weighted-random selection (see rarity table)
- Independently rolls for a Shiny / Hollow / Rainbow variant
- Places the pet in the circular roam zone anchored at the bottom-right corner
- Gives you **3 catch attempts** — each click rolls against the pet's base catch rate

### Rarity table

| Rarity | Spawn weight | Base catch rate | Catch XP | Pets |
|---|---:|---:|---:|---:|
| Common | 60 | 45% | 5 | 10 |
| Rare | 25 | 35% | 15 | 7 |
| Epic | 10 | 25% | 50 | 5 |
| Legendary | 4 | 20% | 150 | 4 |
| Ancient | 1 | 15% | 500 | 2 |

### Variant table

Every wild spawn independently rolls for a variant, cascading rarest first:

| Variant | Chance | Celebration |
|---|---:|---|
| Rainbow | 0.1% (1 in 1,000) | Rainbow prismatic border, extra particles, sparkle audio |
| Hollow | 0.5% (1 in 200) | Diamond-white glow, particles, chime |
| Shiny | 1% (1 in 100) | Gold star badge, particles, chime |
| Normal | 98.4% | Base sparkle only |

## Nature Reserve

Released pets accumulate in a **Nature Reserve** panel attached to the left side of the pet-selection inventory. Each release plays a small walk-into-the-reserve animation and increments a `count / 5` meter. When the meter hits 5, the *Summon Pet* button turns green and lets you conjure a wild pet on demand.

## Unlock ladder

### Pet slots

| Slot | Unlocks at |
|---|---:|
| 1 | Lv 1 |
| 2 | Lv 5 |
| 3 | Lv 10 |

### Characters

The first three portraits are Lv 1 starters. The rest step up by 2 levels each: Character 4 at Lv 3, Character 5 at Lv 5, ... Character 14 at Lv 23.

### Banners

Banner_1 unlocks at Lv 3, then one new banner every 3 levels: Banner_10 at Lv 30.

## Panel

The panel sits at the bottom-right and holds:

- Character portrait, username (defaults to `trainer` — click the panel to change), XP bar, and level
- Three pet slots (locked slots show `Lv N`)
- A collapse tab on the left edge
- A **Dex** button that opens the full pet index
- An update button that pulses green when a newer version is available

## Compatibility

- Chromium, Firefox, Safari — anywhere Tampermonkey runs
- Tampermonkey 4.13+ recommended for `GM_xmlhttpRequest` + `@connect`

## License

Personal project.
