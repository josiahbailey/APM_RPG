// ==UserScript==
// @name         APM RPG
// @namespace    https://w.amazon.com/bin/view/Users/baijosis/APM-RPG/
// @version      0.6.11
// @description  Gamified RPG layer over APM/PTP - levels, EXP, roaming pets, wild pet catching.
// @author       baijosis
// @match        https://*.eam.hxgnsmartcloud.com/*
// @match        https://*.sso.eam.hxgnsmartcloud.com/*
// @match        https://*.eam.aws.a2z.com/*
// @match        https://*.ptp.amazon.dev/*
// @match        https://*.insights.amazon.dev/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/josiahbailey/APM_RPG/main/apm-rpg.user.js
// @downloadURL  https://raw.githubusercontent.com/josiahbailey/APM_RPG/main/apm-rpg.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ================================================================
  // DEV MODE - when true: no data persists; clean slate each page load.
  // ================================================================
  const DEV_MODE = false;

  // ================================================================
  // CONFIG
  // ================================================================

  // Character portraits. `level` = minimum player level required to unlock.
  const CHARACTERS = [
    { id: 'ch_01', img: 'https://placehold.co/128x128/3b82f6/ffffff?text=1', level: 1 },
    { id: 'ch_02', img: 'https://placehold.co/128x128/a855f7/ffffff?text=2', level: 5 },
    { id: 'ch_03', img: 'https://placehold.co/128x128/22c55e/ffffff?text=3', level: 10 },
    { id: 'ch_04', img: 'https://placehold.co/128x128/f97316/ffffff?text=4', level: 20 },
    { id: 'ch_05', img: 'https://placehold.co/128x128/ef4444/ffffff?text=5', level: 30 },
  ];

  // Banner backgrounds. First entry is 'no banner' (unlocked by default).
  const BANNERS = [
    { id: 'bn_none',   img: null, level: 1 },
    { id: 'bn_forest', img: 'https://placehold.co/600x120/166534/ffffff?text=Forest',   level: 3 },
    { id: 'bn_desert', img: 'https://placehold.co/600x120/b45309/ffffff?text=Desert',   level: 8 },
    { id: 'bn_night',  img: 'https://placehold.co/600x120/1e3a8a/ffffff?text=Nightsky', level: 15 },
    { id: 'bn_gold',   img: 'https://placehold.co/600x120/facc15/1a1a1a?text=Gold',     level: 25 },
  ];

  // Active pet slots — `unlockLevel` gates each one.
  const PET_SLOTS = [
    { unlockLevel: 1 },
    { unlockLevel: 10 },
    { unlockLevel: 20 },
  ];

  const PETS = [
    // shinyImg / hollowImg / rainbowImg are OPTIONAL — if omitted, CSS transforms the base image so variants remain visually distinct.
    { id: 'pt_slime',  name: 'Slime',    img: 'https://placehold.co/96x96/84cc16/1a1a1a?text=Slime',   shinyImg: 'https://placehold.co/96x96/facc15/1a1a1a?text=S-Slime',   rarity: 'Common',    spawnWeight: 60, catchBaseRate: 0.70 },
    { id: 'pt_fox',    name: 'Fox',      img: 'https://placehold.co/96x96/f97316/ffffff?text=Fox',     shinyImg: 'https://placehold.co/96x96/06b6d4/ffffff?text=S-Fox',     rarity: 'Rare',      spawnWeight: 30, catchBaseRate: 0.35 },
    { id: 'pt_dragon', name: 'Dragonet', img: 'https://placehold.co/96x96/ef4444/ffffff?text=Dragon',  shinyImg: 'https://placehold.co/96x96/e879f9/ffffff?text=S-Dragon',  rarity: 'Legendary', spawnWeight: 10, catchBaseRate: 0.10 },
  ];

  const XP_REWARDS = { completeWorkOrder: 10, pageChange: 5 };
  const PAGE_CHANGE_XP_CHANCE = 0.10;  // 10% chance to award XP on SPA nav
  const xpToNextLevel = (level) => Math.floor(100 * Math.pow(level, 1.35));
  const WILD_SPAWN_TICK_MS = 15000;
  const WILD_SPAWN_CHANCE  = 0.05;  // rolled once per page load / SPA nav
  const CATCHERS_PER_SPAWN = 3;
  // Hosted at https://github.com/josiahbailey/APM_RPG (public GitHub).
  // Same URL for @updateURL and @downloadURL — Tampermonkey only reads the
  // metadata block on update polls, then fetches the full file on install.
  const UPDATE_META_URL     = 'https://raw.githubusercontent.com/josiahbailey/APM_RPG/main/apm-rpg.user.js';
  const UPDATE_DOWNLOAD_URL = 'https://raw.githubusercontent.com/josiahbailey/APM_RPG/main/apm-rpg.user.js';
  const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes (rate limit; force=true bypasses)
  const UPDATE_POLL_INTERVAL_MS  = 60 * 1000;      // how often to *try* checks (each try respects the rate limit)
  const UPDATE_CACHE_KEY    = 'apm_rpg_update_v1';
  // Variant rarities. Each spawn independently rolls for the rarest tier down.
  // 'normal' is the fallthrough — all four are catch-rate multipliers over base.
  const VARIANT_META = {
    // catchMult: multiplier vs the pet's base catchBaseRate. All variants use
    // the same rate as normal — the rarity is in the spawn chance itself.
    normal:  { label: 'Normal',  catchMult: 1.0, chance: 1,      badge: '',        color: '#888' },
    shiny:   { label: 'Shiny',   catchMult: 1.0, chance: 0.01,   badge: '\u2605', color: '#facc15' },
    hollow:  { label: 'Hollow',  catchMult: 1.0, chance: 0.005,  badge: '\u25C6', color: '#cbd5e1' },
    rainbow: { label: 'Rainbow', catchMult: 1.0, chance: 0.001,  badge: '\u2726', color: 'rainbow' },
  };
  const VARIANT_ORDER = ['rainbow', 'hollow', 'shiny']; // rarest first
  const PORTRAIT_PX = 72;
  const PET_ICON_PX = 48;

  // ================================================================
  // FRAME GUARD
  // ================================================================
  const IS_TOP = (function () {
    try { return window.self === window.top; } catch (e) { return false; }
  })();

  if (!IS_TOP) {
    // Subframe: probe EAM until getUser() works, then post to top and stop.
    try {
      let attempts = 0;
      const trySend = () => {
        try {
          const eam = window.EAM && window.EAM.AppData && window.EAM.AppData.getUser && window.EAM.AppData.getUser();
          if (typeof eam === 'string' && eam) {
            window.top.postMessage({ __apmRpg: true, type: 'username', value: eam }, '*');
            return true;
          }
        } catch (e) {}
        return false;
      };
      if (!trySend()) {
        const iv = setInterval(() => {
          attempts++;
          if (trySend() || attempts >= 30) clearInterval(iv);
        }, 1500);
      }
    } catch (e) {}
    return;
  }

  // ================================================================
  // STORAGE
  // ================================================================
  const STORAGE_VERSION = 5;
  const K = {
    version: 'apm_rpg_version', player: 'apm_rpg_player_v2',
    collection: 'apm_rpg_collection_v2', equip: 'apm_rpg_equip_v2',
    starter: 'apm_rpg_starter_granted',
    installedVersion: 'apm_rpg_installed_version_v1',
    v1_player: 'apm_rpg_player_v1', v1_pets: 'apm_rpg_pets_v1', v1_equip: 'apm_rpg_equip_v1',
  };
  const _devSink = {};
  const readRaw  = (k) => DEV_MODE ? (_devSink[k] || null) : GM_getValue(k, null);
  const writeRaw = (k, v) => { if (DEV_MODE) { _devSink[k] = v; return; } GM_setValue(k, v); };
  const deleteRaw = (k) => { if (DEV_MODE) { delete _devSink[k]; return; } GM_deleteValue(k); };
  const load = (k, fb) => { try { const v = readRaw(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } };
  const save = (k, v) => writeRaw(k, JSON.stringify(v));

  const migrateStorage = () => {
    const ver = load(K.version, 0);
    if (ver >= STORAGE_VERSION) return;
    // v0 → v2
    if (ver < 2) {
      const oldP = load(K.v1_player, null);
      const oldPets = load(K.v1_pets, null);
      const oldE = load(K.v1_equip, null);
      if (oldP || oldPets || oldE) {
        const player = { level: (oldP&&oldP.level)||1, xp: (oldP&&oldP.xp)||0, username: null, characterId: (oldE&&oldE.characterId)||(CHARACTERS[0]&&CHARACTERS[0].id) };
        save(K.player, player);
        const col = [];
        if (oldPets && typeof oldPets === 'object') {
          let c = 0;
          for (const [key, rec] of Object.entries(oldPets)) {
            if (!rec || !rec.caught) continue;
            const isS = key.indexOf('#shiny') !== -1;
            col.push({ instanceId: 'mig_'+Date.now()+'_'+c++, petId: isS?key.replace('#shiny',''):key, shiny: isS, level: rec.level||1, xp: rec.xp||0, caughtAt: Date.now() });
          }
        }
        save(K.collection, col);
        save(K.equip, { characterId: player.characterId, petInstanceId: (col[0]&&col[0].instanceId)||null });
        writeRaw(K.starter, '1');
      }
    }
    // v2 → v3: convert single petInstanceId to petInstanceIds array; add bannerId
    if (ver < 3) {
      const eq = load(K.equip, null);
      if (eq) {
        if (!Array.isArray(eq.petInstanceIds)) {
          eq.petInstanceIds = [eq.petInstanceId || null, null, null];
          delete eq.petInstanceId;
        }
        if (eq.bannerId == null) eq.bannerId = 'bn_none';
        save(K.equip, eq);
      }
    }
    // v3 → v4: convert boolean shiny to variant string
    if (ver < 4) {
      const col = load(K.collection, null);
      if (Array.isArray(col)) {
        for (const inst of col) {
          if (!inst.variant) inst.variant = inst.shiny ? 'shiny' : 'normal';
        }
        save(K.collection, col);
      }
    }
    // v4 → v5: rename 'gold' variant to 'hollow'
    if (ver < 5) {
      const col = load(K.collection, null);
      if (Array.isArray(col)) {
        let changed = false;
        for (const inst of col) {
          if (inst && inst.variant === 'gold') { inst.variant = 'hollow'; changed = true; }
        }
        if (changed) save(K.collection, col);
      }
    }
    save(K.version, STORAGE_VERSION);
  };
  migrateStorage();

  const state = {
    player: load(K.player, { level:1, xp:0, username:null, characterId:(CHARACTERS[0]&&CHARACTERS[0].id), hideRoamers:false }),
    collection: load(K.collection, []),
    equip: load(K.equip, { characterId:(CHARACTERS[0]&&CHARACTERS[0].id), petInstanceIds:[null,null,null], bannerId:'bn_none' }),
  };
  const persistPlayer = () => save(K.player, state.player);
  const persistCollection = () => save(K.collection, state.collection);
  const persistEquip = () => save(K.equip, state.equip);

  // ================================================================
  // MULTI-TAB SYNC — other tabs pick up state changes in real time
  // ================================================================
  // Cross-tab installed-version detection: any tab that reboots with a newer
  // script writes its LOCAL_VERSION to K.installedVersion. Older tabs listen and
  // surface a "reload to use vX.Y.Z" prompt in place of the GitHub update button.
  const bumpInstalledVersion = () => {
    try {
      const stored = readRaw(K.installedVersion);
      const parsed = stored ? JSON.parse(stored) : null;
      const prev = updateInfo.newerLocalVersion;
      if (!parsed || cmpVersion(LOCAL_VERSION, parsed) > 0) {
        save(K.installedVersion, LOCAL_VERSION);
        updateInfo.newerLocalVersion = null;
      } else if (cmpVersion(parsed, LOCAL_VERSION) > 0) {
        updateInfo.newerLocalVersion = parsed;
        if (prev !== parsed) {
          console.log('[APM RPG] a newer version (' + parsed + ') is installed; reload to activate');
        }
      } else {
        updateInfo.newerLocalVersion = null;
      }
      if (updateInfo.newerLocalVersion !== prev && typeof renderPanel === 'function' && el && el.panel) {
        renderPanel();
      }
    } catch (e) {}
  };

  const setupMultiTabSync = () => {
    if (typeof GM_addValueChangeListener === 'undefined') {
      console.log('[APM RPG] multi-tab sync unavailable (GM_addValueChangeListener not granted)');
      return;
    }
    const onRemote = (name, oldRaw, newRaw, remote) => {
      if (!remote) return;  // ignore our own writes
      try {
        const parsed = newRaw ? JSON.parse(newRaw) : null;
        if (parsed == null) return;
        if (name === K.player) {
          state.player = parsed;
        } else if (name === K.collection) {
          state.collection = parsed;
        } else if (name === K.equip) {
          state.equip = parsed;
          if (!Array.isArray(state.equip.petInstanceIds)) state.equip.petInstanceIds = [null, null, null];
          if (state.equip.bannerId == null) state.equip.bannerId = 'bn_none';
        }
        if (typeof renderPanel === 'function' && el && el.panel) renderPanel();
        if ((name === K.equip || name === K.collection) && typeof respawnAllRoamers === 'function') {
          respawnAllRoamers();
        }
      } catch (e) {
        console.warn('[APM RPG] remote sync failed for', name, e);
      }
    };
    GM_addValueChangeListener(K.player,     onRemote);
    GM_addValueChangeListener(K.collection, onRemote);
    GM_addValueChangeListener(K.equip,      onRemote);
    GM_addValueChangeListener(K.installedVersion, (name, oldRaw, newRaw, remote) => {
      if (!remote) return;
      try {
        const v = newRaw ? JSON.parse(newRaw) : null;
        if (v && cmpVersion(v, LOCAL_VERSION) > 0) {
          updateInfo.newerLocalVersion = v;
          console.log('[APM RPG] newer version installed remotely: v' + v);
          if (typeof renderPanel === 'function') renderPanel();
        }
      } catch (e) {}
    });
    console.log('[APM RPG] multi-tab sync active');
  };

  // Ensure equip has v3 shape even if a stale object was loaded
  if (!Array.isArray(state.equip.petInstanceIds)) state.equip.petInstanceIds = [null, null, null];
  if (state.equip.bannerId == null) state.equip.bannerId = 'bn_none';

  // Starter pet is granted via choice modal (shown at boot if collection is empty).

  // ================================================================
  // HELPERS
  // ================================================================
  const $ = (tag, props, children) => {
    props = props || {}; children = children || [];
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v);
    }
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return el;
  };
  const charById = (id) => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
  const petById = (id) => PETS.find(p => p.id === id);
  const instanceById = (iid) => state.collection.find(i => i.instanceId === iid);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  // Variant-aware helpers
  const variantOf = (inst) => (inst && inst.variant) || (inst && inst.shiny ? 'shiny' : 'normal');

  // ================================================================
  // UPDATE CHECK
  // ================================================================
  const parseVer = (s) => String(s || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const cmpVersion = (a, b) => {
    const pa = parseVer(a), pb = parseVer(b);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const LOCAL_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '0.0.0';
  const updateInfo = { checkedAt: 0, latest: null, available: false, newerLocalVersion: null };
  const loadUpdateCache = () => {
    try {
      const raw = (typeof GM_getValue !== 'undefined') ? GM_getValue(UPDATE_CACHE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        updateInfo.checkedAt = parsed.checkedAt || 0;
        updateInfo.latest = parsed.latest || null;
        if (updateInfo.latest && cmpVersion(updateInfo.latest, LOCAL_VERSION) > 0) {
          updateInfo.available = true;
        }
      }
    } catch (e) {}
  };
  const saveUpdateCache = () => {
    try {
      if (typeof GM_setValue !== 'undefined') {
        GM_setValue(UPDATE_CACHE_KEY, JSON.stringify({ checkedAt: updateInfo.checkedAt, latest: updateInfo.latest }));
      }
    } catch (e) {}
  };
  const checkForUpdate = (force) => new Promise((resolve) => {
    if (!UPDATE_META_URL || UPDATE_META_URL.indexOf('REPLACE_ME') !== -1) {
      console.warn('[APM RPG] update check skipped: URL not configured');
      return resolve({ skipped: 'url', local: LOCAL_VERSION });
    }
    if (typeof GM_xmlhttpRequest === 'undefined') {
      console.warn('[APM RPG] update check skipped: GM_xmlhttpRequest not granted');
      return resolve({ skipped: 'no-xhr', local: LOCAL_VERSION });
    }
    const now = Date.now();
    if (!force && (now - updateInfo.checkedAt) < UPDATE_CHECK_INTERVAL_MS) {
      const ageMin = Math.round((now - updateInfo.checkedAt) / 60000);
      console.log('[APM RPG] update check rate-limited (last check ' + ageMin + ' min ago); use APM_RPG.checkUpdate() to force');
      return resolve({ skipped: 'rate-limit', local: LOCAL_VERSION, latest: updateInfo.latest, available: updateInfo.available });
    }
    try {
      console.log('[APM RPG] checking for update...');
      GM_xmlhttpRequest({
        method: 'GET',
        url: UPDATE_META_URL + (UPDATE_META_URL.indexOf('?') === -1 ? '?' : '&') + '_=' + now,
        timeout: 15000,
        onload: (res) => {
          if (!res || res.status !== 200 || !res.responseText) {
            console.warn('[APM RPG] update check bad response:', res && res.status);
            return resolve({ error: 'status ' + (res && res.status), local: LOCAL_VERSION });
          }
          const m = res.responseText.match(/@version\s+([^\s\r\n]+)/);
          if (!m) {
            console.warn('[APM RPG] no @version in response');
            return resolve({ error: 'no version parsed', local: LOCAL_VERSION });
          }
          updateInfo.checkedAt = Date.now();
          updateInfo.latest = m[1].trim();
          updateInfo.available = cmpVersion(updateInfo.latest, LOCAL_VERSION) > 0;
          saveUpdateCache();
          if (typeof renderPanel === 'function') renderPanel();
          console.log('[APM RPG] update check: local=' + LOCAL_VERSION + ' latest=' + updateInfo.latest + ' available=' + updateInfo.available);
          resolve({ local: LOCAL_VERSION, latest: updateInfo.latest, available: updateInfo.available });
        },
        onerror: (e) => {
          console.warn('[APM RPG] update check network error', e);
          resolve({ error: 'network', local: LOCAL_VERSION });
        },
        ontimeout: () => {
          console.warn('[APM RPG] update check timeout');
          resolve({ error: 'timeout', local: LOCAL_VERSION });
        }
      });
    } catch (e) {
      console.warn('[APM RPG] update check exception', e);
      resolve({ error: String(e), local: LOCAL_VERSION });
    }
  });
  const variantBadge = (v) => (VARIANT_META[v] && VARIANT_META[v].badge) || '';
  const variantLabel = (v) => (VARIANT_META[v] && VARIANT_META[v].label) || 'Normal';
  const variantImgField = { shiny: 'shinyImg', hollow: 'hollowImg', rainbow: 'rainbowImg' };
  const petImg = (pet, variant) => {
    if (variant && variant !== 'normal' && pet[variantImgField[variant]]) return pet[variantImgField[variant]];
    return pet.img;
  };
  const needsVariantFallback = (pet, variant) => {
    if (!variant || variant === 'normal') return false;
    return !pet[variantImgField[variant]];
  };
  const applyVariantClasses = (elm, pet, variant) => {
    if (!variant || variant === 'normal') return;
    elm.classList.add('rpg-' + variant);
    if (needsVariantFallback(pet, variant)) elm.classList.add('rpg-' + variant + '-fallback');
  };
  const variantClassStr = (pet, variant) => {
    if (!variant || variant === 'normal') return '';
    return ' rpg-' + variant + (needsVariantFallback(pet, variant) ? ' rpg-' + variant + '-fallback' : '');
  };
  const rollVariant = () => {
    const r = Math.random();
    let acc = 0;
    for (const v of VARIANT_ORDER) {
      acc += VARIANT_META[v].chance;
      if (r < acc) return v;
    }
    return 'normal';
  };
  const genInstanceId = () => 'inst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const bannerById = (id) => BANNERS.find(b => b.id === id) || BANNERS[0];
  const unlockedSlotCount = () => PET_SLOTS.filter(sl => state.player.level >= sl.unlockLevel).length;
  const isCharacterUnlocked = (c) => state.player.level >= (c.level || 1);
  const isBannerUnlocked    = (b) => state.player.level >= (b.level || 1);

  const detectUsername = () => {
    // Highest-priority path: EAM renders 'User (ALIAS@AMAZON.COM)' into a toolbar-text div.
    try {
      const dbtext = document.querySelector('.x-toolbar-text.dbtext, .dbtext, [id^="tbtext-"]');
      if (dbtext) {
        const m = (dbtext.textContent || '').match(/User\s*\(([^)]+)\)/i);
        if (m && m[1]) return m[1].trim();
      }
      // Fallback: scan entire body text for the same pattern
      const body = document.body && document.body.textContent;
      if (body) {
        const m2 = body.match(/User\s*\(([A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+)\)/);
        if (m2 && m2[1]) return m2[1].trim();
      }
    } catch (e) {}
    const wins = [];
    try { wins.push(window); } catch (e) {}
    try { if (window.top && window.top !== window) wins.push(window.top); } catch (e) {}
    try { if (window.parent && window.parent !== window) wins.push(window.parent); } catch (e) {}
    for (const w of wins) {
      try {
        const eam = w.EAM && w.EAM.AppData && w.EAM.AppData.getUser && w.EAM.AppData.getUser();
        if (typeof eam === 'string' && eam) return eam;
        if (eam && (eam.userCode || eam.userId || eam.id)) return eam.userCode || eam.userId || eam.id;
        const sess = w.EAM && w.EAM.session && w.EAM.session.user;
        if (typeof sess === 'string' && sess) return sess;
        if (sess && (sess.userCode || sess.userId)) return sess.userCode || sess.userId;
      } catch (e) {}
    }
    // Scan same-origin iframes — EAM SDK often lives one frame deep
    try {
      const frames = document.querySelectorAll('iframe');
      for (const iframe of frames) {
        try {
          const cw = iframe.contentWindow;
          if (!cw) continue;
          const eam = cw.EAM && cw.EAM.AppData && cw.EAM.AppData.getUser && cw.EAM.AppData.getUser();
          if (typeof eam === 'string' && eam) return eam;
          if (eam && (eam.userCode || eam.userId || eam.id)) return eam.userCode || eam.userId || eam.id;
        } catch (e) { /* cross-origin, skip */ }
      }
    } catch (e) {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        if (raw.indexOf('sessionUserID') === -1 && raw.indexOf('userCode') === -1 && raw.indexOf('userId') === -1) continue;
        try {
          const p = JSON.parse(raw);
          const uid = (p && p.pageData && p.pageData.functionData && p.pageData.functionData.sessionUserID) || (p && p.userCode) || (p && p.userId);
          if (uid && typeof uid === 'string') return uid;
        } catch (e2) {}
      }
    } catch (e) {}
    try {
      const m = (document.cookie || '').match(/(?:^|;\s*)(?:user[_\-]?(?:id|name|alias)|useralias|amzn_user)=([^;]+)/i);
      if (m) return decodeURIComponent(m[1]);
    } catch (e) {}
    return null;
  };
  // Turn 'BAIJOSIS@AMAZON.COM' / 'baijosis@amazon.com' / 'baijosis' into 'baijosis'
  const normalizeAlias = (raw) => {
    if (raw == null) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    return trimmed.split('@')[0].toLowerCase();
  };
  const ensureUsername = () => {
    if (state.player.username) return state.player.username;
    const alias = normalizeAlias(detectUsername());
    if (alias) { state.player.username = alias; persistPlayer(); }
    return state.player.username;
  };
  // Accept username reports from subframes
  window.addEventListener('message', (e) => {
    try {
      if (!e.data || e.data.__apmRpg !== true) return;
      if (e.data.type !== 'username' || !e.data.value) return;
      if (state.player.username) return; // don't overwrite manual choice
      const alias = normalizeAlias(e.data.value);
      if (alias) {
        state.player.username = alias;
        persistPlayer();
        if (typeof renderPanel === 'function') renderPanel();
        console.log('[APM RPG] username set from subframe:', alias);
      }
    } catch (err) {}
  });

  // ================================================================
  // ENV
  // ================================================================
  const isPTPHost = () => /(\.ptp|\.insights)\.amazon\.dev|insights\.hxgnsmartcloud/i.test(location.hostname);

  // ================================================================
  // STYLES
  // ================================================================
  GM_addStyle([
    '.rpg-root,.rpg-root *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.rpg-panel{position:fixed;right:16px;bottom:16px;z-index:2147483000;background:rgba(20,20,28,0.72);color:#eee;border:1px solid #3b3b48;border-radius:12px;padding:10px;display:flex;gap:10px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,0.5);backdrop-filter:blur(6px);user-select:none}',
    '.rpg-slot-container{display:flex;align-items:center;flex-shrink:0}',
    '.rpg-left-col{display:flex;flex-direction:column;gap:4px;align-items:stretch}',
    '.rpg-hide-btn{padding:2px 6px;font-size:9px;font-weight:700;border:1px solid #444;border-radius:4px;background:#22222c;color:#999;cursor:pointer;letter-spacing:0.3px;text-transform:uppercase}.rpg-hide-btn:hover{background:#2f2f3b;color:#ddd;border-color:#555}',
    '.rpg-slot{width:'+PORTRAIT_PX+'px;height:'+PORTRAIT_PX+'px;border-radius:8px;background:#111;border:2px solid #4b4b5c;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;flex-shrink:0}',
    '.rpg-slot img{width:100%;height:100%;object-fit:cover;display:block}',
    '.rpg-slot.pet{width:'+PET_ICON_PX+'px;height:'+PET_ICON_PX+'px}',
    '.rpg-slot .rpg-slot-badge{position:absolute;bottom:0;left:0;right:0;font-size:10px;background:rgba(0,0,0,0.7);text-align:center;padding:1px 2px}',
    '.rpg-stats{min-width:180px;position:relative;display:flex;flex-direction:column;gap:2px}',
    '.rpg-stat-row{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.rpg-stat-row .rpg-name,.rpg-stat-row .rpg-xp-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rpg-xp-gain{position:absolute;right:4px;top:0;font-size:12px;font-weight:800;color:#22c55e;text-shadow:0 1px 3px rgba(0,0,0,0.7),0 0 6px rgba(34,197,94,0.5);pointer-events:none;z-index:5;white-space:nowrap;animation:rpgXpGain 1.2s cubic-bezier(0.22,1,0.36,1) forwards}',
    '@keyframes rpgXpGain{0%{opacity:0;transform:translateY(0) scale(0.5)}15%{opacity:1;transform:translateY(-4px) scale(1.1)}25%{transform:translateY(-6px) scale(1)}100%{opacity:0;transform:translateY(-34px) scale(1)}}',
    '.rpg-bar-pulse{animation:rpgBarPulse 500ms ease-out}',
    '@keyframes rpgBarPulse{0%,100%{transform:scaleX(1);box-shadow:none}40%{transform:scaleX(1.03);box-shadow:0 0 8px rgba(34,197,94,0.6)}}',
    '.rpg-name{font-size:12px;font-weight:600;cursor:pointer}.rpg-name:hover{text-decoration:underline dotted}',
    '.rpg-level{font-size:11px;color:#ffd166;margin-top:2px}',
    '.rpg-bar{width:100%;height:8px;background:#2a2a36;border-radius:4px;overflow:hidden;margin-top:4px}',
    '.rpg-bar>div{height:100%;background:linear-gradient(90deg,#4ade80,#22d3ee);transition:width 240ms ease}',
    '.rpg-xp-text{font-size:10px;color:#9aa;margin-top:2px}',
    '.rpg-btn{padding:4px 8px;font-size:10px;font-weight:700;border:1px solid #555;border-radius:5px;background:#2a2a36;color:#ffd166;cursor:pointer}.rpg-btn:hover{background:#3b3b48}',
    '.rpg-right-col{display:none}',
    '.rpg-version{font-size:9px;color:#666;text-align:center;letter-spacing:0.5px;font-weight:600;user-select:text;margin-top:auto}',
    '.rpg-reset-btn{position:fixed;left:12px;bottom:12px;z-index:2147483000;font-size:9px;padding:3px 7px;background:rgba(40,0,0,0.8);color:#f77;border:1px solid #633;border-radius:4px;cursor:pointer;opacity:0.5}.rpg-reset-btn:hover{opacity:1;background:#400}',
    '.rpg-update-toast{position:fixed;right:16px;bottom:120px;z-index:2147483001;padding:8px 16px;font-size:12px;font-weight:800;letter-spacing:0.6px;border-radius:8px;cursor:pointer;background:linear-gradient(135deg,#22c55e,#15803d);color:#fff;border:1px solid #16a34a;box-shadow:0 4px 14px rgba(34,197,94,0.4);animation:rpgUpdatePulse 2s ease-in-out infinite;transition:transform 0.15s ease}.rpg-update-toast:hover{filter:brightness(1.15);transform:translateY(-1px)}.rpg-update-toast:active{transform:translateY(0)}',
    '.rpg-update-toast.rpg-reload-mode{background:linear-gradient(135deg,#f97316,#c2410c);border-color:#ea580c;box-shadow:0 4px 14px rgba(249,115,22,0.45);animation:rpgReloadPulse 2s ease-in-out infinite}',
    '@keyframes rpgUpdatePulse{0%,100%{box-shadow:0 4px 14px rgba(34,197,94,0.4)}50%{box-shadow:0 4px 18px rgba(34,197,94,0.75),0 0 0 6px rgba(34,197,94,0.15)}}',
    '@keyframes rpgReloadPulse{0%,100%{box-shadow:0 4px 14px rgba(249,115,22,0.45)}50%{box-shadow:0 4px 18px rgba(249,115,22,0.8),0 0 0 6px rgba(249,115,22,0.18)}}',
    '.rpg-menu{position:fixed;right:16px;bottom:110px;z-index:2147483001;background:rgba(20,20,28,0.97);border:1px solid #3b3b48;border-radius:12px;padding:12px;color:#eee;max-width:380px;max-height:60vh;overflow-y:auto;box-shadow:0 10px 30px rgba(0,0,0,0.6)}',
    '.rpg-menu h4{margin:0 0 8px;font-size:12px;color:#ffd166}',
    '.rpg-menu-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}',
    '.rpg-menu-char{text-align:center;cursor:pointer;padding:4px;border-radius:6px}.rpg-menu-char:hover{background:#2a2a36}.rpg-menu-char.active{outline:2px solid #ffd166}',
    '.rpg-menu-char img{width:56px;height:56px;object-fit:cover;border-radius:6px;display:block}',
    '.rpg-menu-item{text-align:center;cursor:pointer;padding:6px 4px;border-radius:6px}.rpg-menu-item:hover{background:#2a2a36}.rpg-menu-item.active{background:#33334a;outline:1px solid #ffd166}',
    '.rpg-menu-item img{width:52px;height:52px;object-fit:cover;border-radius:6px;display:block;margin:0 auto}',
    '.rpg-menu-item .n{font-size:11px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.rpg-menu-item .l{font-size:10px;color:#ffd166}',
    '.rpg-empty-msg{font-size:12px;color:#888;padding:12px 0}',
    '.rpg-dex{max-width:360px;text-align:left}',
    '.rpg-dex-list{max-height:55vh;overflow-y:auto}',
    '.rpg-roam{position:fixed;z-index:2147482900;pointer-events:none;transition:left 10s linear,top 10s linear}',
    '.rpg-roam img{width:64px;height:64px;object-fit:contain;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.4))}',
    '.rpg-roam .label{font-size:11px;text-align:center;color:#fff;text-shadow:0 1px 2px #000,0 0 4px #000}',
    '.rpg-wild{position:fixed;z-index:2147483100;cursor:pointer;transition:left 3s linear,top 3s linear,transform 300ms}',
    '.rpg-wild img{width:96px;height:96px;object-fit:contain;filter:drop-shadow(0 0 12px gold)}',
    '.rpg-wild .label{text-align:center;font-size:12px;color:gold;text-shadow:0 1px 2px #000;font-weight:700}',
    '@keyframes rpgLevelUp{0%{transform:scale(1);filter:brightness(1)}30%{transform:scale(1.4);filter:brightness(2) drop-shadow(0 0 12px gold)}100%{transform:scale(1);filter:brightness(1)}}',
    '.rpg-levelup-anim{animation:rpgLevelUp 900ms ease-out}',
    '.rpg-levelup-toast{position:fixed;left:50%;top:30%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:gold;font-size:22px;font-weight:800;padding:12px 20px;border-radius:10px;border:2px solid gold;z-index:2147483200;pointer-events:none;animation:rpgLevelUp 1200ms ease-out}',
    '.rpg-modal{position:fixed;inset:0;z-index:2147483400;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center}',
    '.rpg-modal-inner{background:#1a1a24;color:#eee;padding:22px 26px;border-radius:12px;border:2px solid gold;text-align:center;max-width:340px;position:relative}',
    '.rpg-modal-close{position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;background:rgba(120,120,140,0.18);color:#bbb;font-size:16px;font-weight:900;display:flex;align-items:center;justify-content:center;cursor:pointer;border:none;line-height:1;z-index:5;padding:0;margin:0;transition:background 150ms,color 150ms,transform 150ms}.rpg-modal-close:hover{background:#dc2626;color:#fff;transform:scale(1.1)}',
    '.rpg-modal-inner button{margin-top:14px;padding:8px 16px;background:gold;color:#111;border:none;border-radius:6px;font-weight:700;cursor:pointer}',
    '.rpg-shiny{position:relative}.rpg-shiny img{filter:drop-shadow(0 0 6px gold) drop-shadow(0 0 12px #fff59d)}',
    '.rpg-shiny-fallback img{filter:hue-rotate(160deg) saturate(1.6) contrast(1.05) drop-shadow(0 0 6px gold) drop-shadow(0 0 12px #fff59d)!important}',
    '.rpg-shiny::after{content:"";position:absolute;inset:-4px;pointer-events:none;opacity:0.85;background:radial-gradient(circle at 20% 25%,#fff 0 2px,transparent 3px),radial-gradient(circle at 78% 60%,#fff 0 1.5px,transparent 2.5px),radial-gradient(circle at 55% 15%,gold 0 2px,transparent 3px);animation:rpgSparkle 1.4s ease-in-out infinite alternate}',
    '@keyframes rpgSparkle{0%{transform:rotate(0);opacity:0.3}100%{transform:rotate(360deg);opacity:0.9}}',
    '.rpg-shiny-wild img{filter:drop-shadow(0 0 18px gold) drop-shadow(0 0 30px #fff59d)!important;animation:rpgWildPulse 900ms ease-in-out infinite alternate}',
    '@keyframes rpgWildPulse{0%{transform:scale(1)}100%{transform:scale(1.06)}}',
    // ── Wild-pet catch UI ──────────────────────────────────────────
    '.rpg-wild.rpg-catchable{cursor:pointer}',
    '.rpg-wild.rpg-catchable::before{content:"";position:absolute;left:50%;top:55%;width:130px;height:130px;margin:-65px 0 0 -65px;border:3px dashed gold;border-radius:50%;pointer-events:none;box-sizing:border-box;animation:rpgRingSpin 4s linear infinite;opacity:0.85}',
    '@keyframes rpgRingSpin{to{transform:rotate(360deg)}}',
    '.rpg-wild .catch-hint{text-align:center;color:gold;font-weight:800;font-size:14px;text-shadow:0 1px 2px #000,0 0 6px #000;margin-top:6px;letter-spacing:2px;animation:rpgCatchBounce 900ms ease-in-out infinite alternate}',
    '@keyframes rpgCatchBounce{from{transform:translateY(0);opacity:0.85}to{transform:translateY(-4px);opacity:1}}',
    '.rpg-wild-shake{animation:rpgWildShake 380ms ease-in-out!important}',
    '@keyframes rpgWildShake{0%,100%{margin-left:0}20%{margin-left:-14px}40%{margin-left:12px}60%{margin-left:-8px}80%{margin-left:6px}}',
    '.rpg-caught-anim{animation:rpgCaughtPoof 600ms ease-out forwards}',
    '@keyframes rpgCaughtPoof{0%{transform:scale(1);opacity:1}60%{transform:scale(1.4);opacity:0.8}100%{transform:scale(0.05);opacity:0}}',
    // ── Multi-slot pets, banners, sliders, locks ──────────────────
    '.rpg-slot-container{gap:6px}',
    '.rpg-slot.pet{width:44px;height:44px}',
    '.rpg-slot.pet .rpg-slot-badge{font-size:9px;letter-spacing:0.2px}',
    '.rpg-slot-locked{background:#151520;border-color:#333;cursor:not-allowed;display:flex;align-items:center;justify-content:center}',
    '.rpg-lock-label{font-size:11px;font-weight:700;color:#666;letter-spacing:0.5px}',
    '.rpg-panel{background-color:rgba(20,20,28,0.72);background-repeat:no-repeat}',
    '.rpg-section-label{font-size:10px;font-weight:700;letter-spacing:1.2px;color:#9aa;margin:8px 0 4px}',
    '.rpg-menu-slider{display:flex;gap:8px;overflow-x:auto;padding:2px 0 6px;scrollbar-width:thin}',
    '.rpg-menu-slider::-webkit-scrollbar{height:6px}',
    '.rpg-menu-slider::-webkit-scrollbar-thumb{background:#3b3b48;border-radius:3px}',
    '.rpg-menu-slider .rpg-menu-char{flex:0 0 auto;position:relative}',
    '.rpg-menu-banner{flex:0 0 auto;width:120px;height:44px;border-radius:6px;background-size:cover;background-position:center;background-color:#222;cursor:pointer;position:relative;border:2px solid transparent}',
    '.rpg-menu-banner:hover{border-color:#4b4b5c}',
    '.rpg-menu-banner.active{border-color:#ffd166;box-shadow:0 0 0 2px rgba(255,209,102,0.25)}',
    '.rpg-menu-banner-none{background:repeating-linear-gradient(45deg,#1a1a24,#1a1a24 6px,#22222e 6px,#22222e 12px)}',
    '.rpg-banner-none-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#888;font-style:italic}',
    '.rpg-locked{cursor:not-allowed;filter:grayscale(0.9) brightness(0.55)}',
    '.rpg-locked:hover{filter:grayscale(0.9) brightness(0.7)}',
    '.rpg-lock-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#ffd166;text-shadow:0 1px 3px #000,0 0 6px #000;letter-spacing:0.5px;pointer-events:none;background:rgba(0,0,0,0.35);border-radius:6px}',
    '.rpg-menu-item.rpg-in-other-slot{outline:1px dashed #666}',
    '.rpg-in-slot-tag{position:absolute;top:2px;left:2px;font-size:9px;background:rgba(0,0,0,0.7);color:#ffd166;padding:1px 4px;border-radius:3px;font-weight:700}',
    '.rpg-menu-del{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(220,38,38,0.75);color:#fff;font-size:13px;font-weight:900;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:3;line-height:1;transition:transform 120ms,background 120ms;opacity:0.7}.rpg-menu-del:hover{background:#dc2626;transform:scale(1.15);opacity:1}',
    '.rpg-menu-item{position:relative}',
    '.rpg-starter-modal .rpg-modal-inner{max-width:460px}',
    '.rpg-starter-choices{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:6px}',
    '.rpg-starter-card{background:#1e1e2e;border-radius:10px;padding:14px 12px;cursor:pointer;transition:transform 200ms,box-shadow 200ms,border-color 200ms;width:110px;border:1.5px solid #2a2a36}',
    '.rpg-starter-card:hover{transform:translateY(-4px);box-shadow:0 8px 22px rgba(255,209,102,0.35);border-color:#ffd166}',
    '.rpg-starter-card img{width:76px;height:76px;object-fit:cover;border-radius:8px;display:block;margin:0 auto}',
    '.rpg-starter-card .n{font-size:13px;font-weight:700;margin-top:8px;text-align:center;color:#ffd166}',
    '.rpg-starter-card .r{font-size:10px;color:#aaa;text-align:center;margin-top:2px;letter-spacing:0.5px;text-transform:uppercase}',
    // ── Hollow variant (silvery reflective chrome) ──────────────
    '.rpg-hollow img{filter:brightness(1.22) contrast(1.15) saturate(0.65) drop-shadow(0 0 6px #dbeafe) drop-shadow(0 0 14px #94a3b8)}',
    '.rpg-hollow-fallback img{filter:grayscale(0.65) brightness(1.3) contrast(1.2) saturate(0.5) hue-rotate(180deg) drop-shadow(0 0 6px #e0e7ff) drop-shadow(0 0 14px #94a3b8)!important}',
    '.rpg-hollow{position:relative;overflow:hidden;border-radius:inherit}',
    '.rpg-hollow::before{content:"";position:absolute;left:-60%;top:0;width:85%;height:100%;background:linear-gradient(115deg,transparent 20%,rgba(255,255,255,0.35) 38%,rgba(219,234,254,0.7) 50%,rgba(255,255,255,0.35) 62%,transparent 80%);animation:rpgHollowSheen 2.2s linear infinite;pointer-events:none;mix-blend-mode:overlay}',
    '.rpg-hollow::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(160deg,rgba(226,232,240,0.15) 0%,transparent 40%,transparent 60%,rgba(148,163,184,0.15) 100%);border-radius:inherit}',
    '@keyframes rpgHollowSheen{0%{transform:translateX(0)}100%{transform:translateX(220%)}}',
    // ── Rainbow variant (hue rotate + colored sparkles) ──────────
    '.rpg-rainbow img{animation:rpgRainbowHue 3.5s linear infinite;filter:saturate(1.4) drop-shadow(0 0 6px #ff00e6) drop-shadow(0 0 14px #00e6ff)}',
    '.rpg-rainbow-fallback img{animation:rpgRainbowHue 3.5s linear infinite;filter:saturate(1.8) contrast(1.05) drop-shadow(0 0 6px #ff00e6) drop-shadow(0 0 14px #00e6ff)!important}',
    '@keyframes rpgRainbowHue{0%{filter:saturate(1.5) hue-rotate(0deg) drop-shadow(0 0 6px #ff00e6) drop-shadow(0 0 14px #00e6ff)}100%{filter:saturate(1.5) hue-rotate(360deg) drop-shadow(0 0 6px #ff00e6) drop-shadow(0 0 14px #00e6ff)}}',
    '.rpg-rainbow{position:relative}',
    '.rpg-rainbow::after{content:"";position:absolute;inset:-4px;pointer-events:none;opacity:0.9;background:radial-gradient(circle at 20% 25%,#ff69b4 0 2px,transparent 3px),radial-gradient(circle at 78% 60%,#00ff88 0 2px,transparent 3px),radial-gradient(circle at 55% 15%,#00aaff 0 2px,transparent 3px),radial-gradient(circle at 40% 85%,#ffea00 0 2px,transparent 3px),radial-gradient(circle at 65% 45%,#ff4488 0 1.5px,transparent 2.5px);animation:rpgRainbowSparkle 1.6s ease-in-out infinite alternate}',
    '@keyframes rpgRainbowSparkle{0%{transform:rotate(0deg) scale(1);opacity:0.4}100%{transform:rotate(180deg) scale(1.15);opacity:1}}',
    // ── Unified wild pulse (any special variant) ─────────────────
    '.rpg-wild-special img{animation:rpgWildPulse 900ms ease-in-out infinite alternate}',
    // ── Dex layout with variant badges ───────────────────────────
    '.rpg-dex-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:4px;max-height:60vh;overflow-y:auto}',
    '.rpg-dex-card{background:#1e1e2e;border-radius:8px;padding:8px 6px 6px;text-align:center;border:1.5px solid #2a2a36;position:relative;transition:border-color 150ms}',
    '.rpg-dex-card:hover{border-color:#3b3b48}',
    '.rpg-dex-card-badges{display:flex;justify-content:center;gap:5px;margin-bottom:6px;height:12px}',
    '.rpg-dex-mini{width:10px;height:10px;transform:rotate(45deg);background:#2a2a36;border:1px solid #3a3a4a;transition:all 250ms;flex-shrink:0}',
    '.rpg-dex-mini.owned{background:#facc15;border-color:#eab308}',
    '.rpg-dex-mini-shiny.owned{background:radial-gradient(circle at 30% 30%,#fef3c7,#facc15,#eab308);border-color:#eab308;box-shadow:0 0 4px rgba(250,204,21,0.6)}',
    '.rpg-dex-mini-hollow.owned{background:linear-gradient(135deg,#f8fafc 0%,#cbd5e1 50%,#94a3b8 100%);border-color:#64748b;box-shadow:0 0 4px rgba(226,232,240,0.7)}',
    '.rpg-dex-mini-rainbow.owned{background:conic-gradient(from 0deg,#ff5555,#ffaa00,#ffff55,#55ff77,#55ccff,#aa66ff,#ff66cc,#ff5555);border-color:#fff;box-shadow:0 0 4px rgba(255,255,255,0.6),0 0 8px rgba(255,105,180,0.5);animation:rpgRainbowBadge 3s linear infinite}',
    '@keyframes rpgRainbowBadge{0%{filter:hue-rotate(0deg)}100%{filter:hue-rotate(360deg)}}',
    '.rpg-dex-card img{width:56px;height:56px;object-fit:cover;border-radius:6px;display:block;margin:0 auto}',
    '.rpg-dex-card .n{font-size:11px;font-weight:600;margin-top:5px;line-height:1.2;color:#eee}',
    '.rpg-dex-card .c{font-size:9px;color:#aaa;margin-top:2px;line-height:1.2}',
    '.rpg-dex-card.rpg-dex-silhouette img{filter:brightness(0) opacity(0.35)}',
    '.rpg-dex-card.rpg-dex-silhouette .n{color:#555}',
    // ── Catch celebration effects ────────────────────────────────
    '.rpg-particle{position:fixed;width:8px;height:8px;border-radius:50%;pointer-events:none;z-index:2147483500;box-shadow:0 0 4px currentColor;transform:translate(-50%,-50%);animation-name:rpgParticleFly;animation-timing-function:cubic-bezier(0.15,0.7,0.4,1);animation-fill-mode:forwards}',
    '@keyframes rpgParticleFly{0%{transform:translate(-50%,-50%) scale(1);opacity:1}70%{opacity:0.9}100%{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(0.2);opacity:0}}',
    '.rpg-screen-flash{position:fixed;inset:0;z-index:2147483450;pointer-events:none;opacity:0;animation-name:rpgScreenFlash;animation-timing-function:ease-out;animation-fill-mode:forwards}',
    '@keyframes rpgScreenFlash{0%{opacity:0}20%{opacity:0.7}100%{opacity:0}}',
    '.rpg-celebration-banner{position:fixed;left:50%;top:35%;transform:translate(-50%,-50%);z-index:2147483550;padding:20px 40px;border-radius:16px;font-size:38px;font-weight:900;letter-spacing:3px;text-shadow:0 2px 4px rgba(0,0,0,0.35);border:3px solid rgba(255,255,255,0.7);box-shadow:0 12px 40px rgba(0,0,0,0.6),0 0 60px rgba(255,255,255,0.4);pointer-events:none;animation-name:rpgBannerPop;animation-timing-function:cubic-bezier(0.34,1.56,0.64,1);animation-fill-mode:forwards;white-space:nowrap}',
    '@keyframes rpgBannerPop{0%{transform:translate(-50%,-50%) scale(0.3) rotate(-10deg);opacity:0}20%{transform:translate(-50%,-50%) scale(1.15) rotate(2deg);opacity:1}30%{transform:translate(-50%,-50%) scale(1) rotate(0deg)}80%{transform:translate(-50%,-50%) scale(1) rotate(0deg);opacity:1}100%{transform:translate(-50%,-50%) scale(0.85) rotate(0deg);opacity:0}}',
    '.rpg-panel-shake{animation:rpgPanelShake 700ms cubic-bezier(0.36,0.07,0.19,0.97) both}',
    '@keyframes rpgPanelShake{10%,90%{transform:translate3d(-1px,0,0)}20%,80%{transform:translate3d(2px,0,0)}30%,50%,70%{transform:translate3d(-4px,0,0)}40%,60%{transform:translate3d(4px,0,0)}}',
  ].join('\n'));

  // ================================================================
  // UI
  // ================================================================
  const root = $('div', { class: 'rpg-root' });
  document.documentElement.appendChild(root);
  const el = {};

  const buildPanel = () => {
    el.panel = $('div', { class: 'rpg-panel' });
    el.leftCol = $('div', { class: 'rpg-left-col' });
    el.leftSlot = $('div', { class: 'rpg-slot-container' });
    el.leftCol.appendChild(el.leftSlot);
    el.hidePetsBtn = $('button', {
      class: 'rpg-hide-btn',
      title: 'Toggle roaming pets on/off (saved)',
      onclick: () => {
        state.player.hideRoamers = !state.player.hideRoamers;
        persistPlayer();
        renderPanel();
        if (state.player.hideRoamers) removeAllRoamers();
        else respawnAllRoamers();
      }
    });
    el.leftCol.appendChild(el.hidePetsBtn);
    el.panel.appendChild(el.leftCol);
    el.charSlot = $('div', { class: 'rpg-slot', title: 'Click to change avatar', onclick: () => openMenu('character') });
    el.panel.appendChild(el.charSlot);
    el.stats = $('div', { class: 'rpg-stats' });
    el.name = $('div', { class: 'rpg-name', title: 'Click to edit username', onclick: editUsername });
    el.level = $('div', { class: 'rpg-level' });
    el.bar = $('div', { class: 'rpg-bar' }, [$('div')]);
    el.xpTxt = $('div', { class: 'rpg-xp-text' });
    // Name row: username on the left, DEX button pinned to the right (aligned with bar/version end)
    const nameRow = $('div', { class: 'rpg-stat-row' });
    nameRow.appendChild(el.name);
    nameRow.appendChild($('button', {
      class: 'rpg-btn',
      type: 'button',
      html: 'DEX',
      title: 'View all discoverable pets',
      onclick: (e) => { if (e && e.preventDefault) e.preventDefault(); openDex(); }
    }));
    // XP row: xp text on the left, version pinned to the right (aligned with bar/DEX end)
    const xpRow = $('div', { class: 'rpg-stat-row' });
    xpRow.appendChild(el.xpTxt);
    xpRow.appendChild($('div', { class: 'rpg-version', html: 'v' + LOCAL_VERSION, title: 'Installed version' }));
    el.stats.append(nameRow, el.level, el.bar, xpRow);
    el.panel.appendChild(el.stats);
    root.appendChild(el.panel);
    // Floating update toast — appears above the panel when a newer version is on GitHub.
    el.updateBtn = $('button', {
      class: 'rpg-update-toast',
      type: 'button',
      title: 'A new version is available. Click to install.',
      onclick: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        // If a newer version is already installed elsewhere, just reload this tab.
        if (updateInfo.newerLocalVersion) { location.reload(); return; }
        // Otherwise open the raw URL for Tampermonkey to install.
        if (UPDATE_DOWNLOAD_URL && UPDATE_DOWNLOAD_URL.indexOf('REPLACE_ME') === -1) {
          window.open(UPDATE_DOWNLOAD_URL, '_blank');
        }
      }
    });
    el.updateBtn.style.display = 'none';
    root.appendChild(el.updateBtn);
    el.resetBtn = $('button', {
      class: 'rpg-reset-btn',
      type: 'button',
      html: DEV_MODE ? 'DEV \u00B7 Reset' : 'Reset',
      onclick: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        if (!confirm('Reset ALL APM RPG data?')) return;
        Object.values(K).forEach(deleteRaw);
        location.reload();
      }
    });
    root.appendChild(el.resetBtn);
  };

  const updateSlots = () => {
    if (!el.leftSlot) return;
    el.leftSlot.innerHTML = '';
    el.leftSlot.style.display = 'flex';
    for (let i = 0; i < PET_SLOTS.length; i++) {
      const slot = PET_SLOTS[i];
      const unlocked = state.player.level >= slot.unlockLevel;
      const idx = i;
      if (!unlocked) {
        const locked = $('div', { class: 'rpg-slot pet rpg-slot-locked', title: 'Unlocks at Level ' + slot.unlockLevel });
        locked.appendChild($('div', { class: 'rpg-lock-label', html: 'Lv' + slot.unlockLevel }));
        el.leftSlot.appendChild(locked);
        continue;
      }
      const inst = instanceById(state.equip.petInstanceIds[idx]);
      const petSlot = $('div', { class: 'rpg-slot pet', title: 'Click to assign pet', onclick: () => openMenu('pet', idx) });
      if (inst) {
        const p = petById(inst.petId);
        if (p) {
          const v = variantOf(inst);
          petSlot.appendChild($('img', { src: petImg(p, v) }));
          petSlot.appendChild($('div', { class: 'rpg-slot-badge', html: (variantBadge(v) ? variantBadge(v) + ' ' : '') + p.rarity }));
          applyVariantClasses(petSlot, p, v);
        }
      } else {
        petSlot.appendChild($('div', { html: '+', style: { color: '#555', fontSize: '26px', fontWeight: '300' } }));
      }
      el.leftSlot.appendChild(petSlot);
    }
  };

  const applyBanner = () => {
    if (!el.panel) return;
    const b = bannerById(state.equip.bannerId);
    if (b && b.img) {
      el.panel.style.backgroundImage =
        'linear-gradient(rgba(20,20,28,0.75), rgba(20,20,28,0.9)), url("' + b.img + '")';
      el.panel.style.backgroundSize = 'cover';
      el.panel.style.backgroundPosition = 'center';
    } else {
      el.panel.style.backgroundImage = '';
    }
  };
  const renderPanel = () => {
    if (!el.panel) return;
    const ch = charById(state.equip.characterId);
    el.charSlot.innerHTML = '';
    el.charSlot.appendChild($('img', { src: ch.img }));
    applyBanner();
    updateSlots();
    const uname = ensureUsername() || 'click to set name';
    el.name.textContent = uname;
    el.name.style.fontStyle = state.player.username ? '' : 'italic';
    el.level.textContent = 'Level ' + state.player.level;
    const need = xpToNextLevel(state.player.level);
    el.bar.firstChild.style.width = clamp((state.player.xp / need) * 100, 0, 100) + '%';
    el.xpTxt.textContent = 'EXP ' + state.player.xp + ' / ' + need;
    if (el.hidePetsBtn) el.hidePetsBtn.textContent = state.player.hideRoamers ? 'Show Pets' : 'Hide Pets';
    if (el.updateBtn) {
      // Priority: reload-for-newer-installed > github-update-available > hidden
      if (updateInfo.newerLocalVersion) {
        el.updateBtn.innerHTML = 'RELOAD FOR v' + updateInfo.newerLocalVersion;
        el.updateBtn.title = 'A newer version is already installed. Click to reload this tab.';
        el.updateBtn.classList.add('rpg-reload-mode');
        el.updateBtn.style.display = '';
      } else if (updateInfo.available && updateInfo.latest) {
        el.updateBtn.innerHTML = 'UPDATE \u2192 v' + updateInfo.latest;
        el.updateBtn.title = 'A new version is available. Click to install.';
        el.updateBtn.classList.remove('rpg-reload-mode');
        el.updateBtn.style.display = '';
      } else {
        el.updateBtn.classList.remove('rpg-reload-mode');
        el.updateBtn.style.display = 'none';
      }
      if (el.updateBtn.style.display === '') {
        requestAnimationFrame(() => {
          if (!el.panel || !el.updateBtn) return;
          const r = el.panel.getBoundingClientRect();
          el.updateBtn.style.bottom = Math.max(16, window.innerHeight - r.top + 8) + 'px';
        });
      }
    }
  };

  const editUsername = () => {
    const next = prompt('Enter your username:', state.player.username || '');
    if (next != null && next.trim()) { state.player.username = next.trim(); persistPlayer(); renderPanel(); }
  };

  let menuEl = null;
  const closeMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; } };
  const setupMenuDismiss = () => { setTimeout(() => { const off = (e) => { if (menuEl && !menuEl.contains(e.target) && !el.panel.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', off); } }; document.addEventListener('mousedown', off); }, 50); };

  const openMenu = (kind, slotIdx) => {
    closeMenu();
    menuEl = $('div', { class: 'rpg-menu' });

    if (kind === 'character') {
      menuEl.appendChild($('h4', { html: 'CUSTOMIZE' }));
      menuEl.appendChild($('button', {
        class: 'rpg-modal-close',
        html: '\u00D7',
        title: 'Close',
        onclick: (e) => { e.stopPropagation(); closeMenu(); }
      }));

      // Banner slider
      menuEl.appendChild($('div', { class: 'rpg-section-label', html: 'BANNERS' }));
      const bannerRow = $('div', { class: 'rpg-menu-slider' });
      for (const b of BANNERS) {
        const unlocked = isBannerUnlocked(b);
        const active = b.id === state.equip.bannerId;
        const tile = $('div', {
          class: 'rpg-menu-banner' + (active ? ' active' : '') + (unlocked ? '' : ' rpg-locked'),
          title: unlocked ? '' : ('Unlocks at Lv ' + b.level),
          onclick: () => {
            if (!unlocked) return;
            state.equip.bannerId = b.id; persistEquip(); renderPanel();
          }
        });
        if (b.img) tile.style.backgroundImage = 'url("' + b.img + '")';
        else tile.classList.add('rpg-menu-banner-none');
        if (!unlocked) {
          const lock = $('div', { class: 'rpg-lock-overlay', html: 'Lv' + b.level });
          tile.appendChild(lock);
        } else if (!b.img) {
          tile.appendChild($('div', { class: 'rpg-banner-none-label', html: 'None' }));
        }
        bannerRow.appendChild(tile);
      }
      menuEl.appendChild(bannerRow);

      // Character slider
      menuEl.appendChild($('div', { class: 'rpg-section-label', html: 'CHARACTERS' }));
      const charRow = $('div', { class: 'rpg-menu-slider' });
      for (const c of CHARACTERS) {
        const unlocked = isCharacterUnlocked(c);
        const active = c.id === state.equip.characterId;
        const tile = $('div', {
          class: 'rpg-menu-char' + (active ? ' active' : '') + (unlocked ? '' : ' rpg-locked'),
          title: unlocked ? '' : ('Unlocks at Lv ' + c.level),
          onclick: () => {
            if (!unlocked) return;
            state.equip.characterId = c.id; persistEquip(); renderPanel();
          }
        });
        tile.appendChild($('img', { src: c.img }));
        if (!unlocked) tile.appendChild($('div', { class: 'rpg-lock-overlay', html: 'Lv' + c.level }));
        charRow.appendChild(tile);
      }
      menuEl.appendChild(charRow);

    } else {
      // Pet collection for a specific slot
      const targetSlot = (slotIdx == null) ? 0 : slotIdx;
      menuEl.appendChild($('h4', { html: 'PICK PET FOR SLOT ' + (targetSlot + 1) }));

      if (state.collection.length === 0) {
        menuEl.appendChild($('div', { class: 'rpg-empty-msg', html: 'No pets yet! Encounter wild pets to build your collection.' }));
        root.appendChild(menuEl); setupMenuDismiss(); return;
      }

      const grid = $('div', { class: 'rpg-menu-grid' });

      // "Empty this slot" option
      const emptyItem = $('div', {
        class: 'rpg-menu-item' + (state.equip.petInstanceIds[targetSlot] == null ? ' active' : ''),
        onclick: () => {
          state.equip.petInstanceIds[targetSlot] = null;
          persistEquip(); renderPanel(); closeMenu();
          spawnRoamerAt(targetSlot);
        }
      });
      emptyItem.appendChild($('div', { html: '\u2715', style: { fontSize: '28px', color: '#555', height: '52px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '300' } }));
      emptyItem.appendChild($('div', { class: 'n', html: 'Empty' }));
      emptyItem.appendChild($('div', { class: 'l', html: '\u2014' }));
      grid.appendChild(emptyItem);

      for (const inst of state.collection) {
        const p = petById(inst.petId); if (!p) continue;
        // Show whether this pet is already assigned to a DIFFERENT slot
        const assignedTo = state.equip.petInstanceIds.indexOf(inst.instanceId);
        const active = assignedTo === targetSlot;
        const inOtherSlot = assignedTo !== -1 && assignedTo !== targetSlot;
        const v = variantOf(inst);
        const cls = 'rpg-menu-item' + (active ? ' active' : '') + variantClassStr(p, v) + (inOtherSlot ? ' rpg-in-other-slot' : '');
        const item = $('div', {
          class: cls,
          title: inOtherSlot ? ('Currently in slot ' + (assignedTo + 1)) : '',
          onclick: () => {
            // If this pet is currently in another slot, clear that slot first
            if (inOtherSlot) state.equip.petInstanceIds[assignedTo] = null;
            state.equip.petInstanceIds[targetSlot] = inst.instanceId;
            persistEquip(); renderPanel(); closeMenu();
            respawnAllRoamers();
          }
        });
        // Delete button — release this pet forever
        const delBtn = $('div', {
          class: 'rpg-menu-del',
          html: '\u00D7',
          title: 'Release ' + p.name,
          onclick: (e) => {
            e.stopPropagation();
            const labelName = (v !== 'normal' ? variantLabel(v) + ' ' : '') + p.name;
            if (!confirm('Release ' + labelName + '? This cannot be undone.')) return;
            state.collection = state.collection.filter(x => x.instanceId !== inst.instanceId);
            for (let s = 0; s < state.equip.petInstanceIds.length; s++) {
              if (state.equip.petInstanceIds[s] === inst.instanceId) state.equip.petInstanceIds[s] = null;
            }
            persistCollection(); persistEquip();
            closeMenu();
            renderPanel();
            respawnAllRoamers();
            openMenu('pet', targetSlot);
          }
        });
        item.appendChild(delBtn);
        item.appendChild($('img', { src: petImg(p, v) }));
        item.appendChild($('div', { class: 'n', html: (variantBadge(v) ? variantBadge(v) + ' ' : '') + p.name }));
        item.appendChild($('div', { class: 'l', html: (v !== 'normal' ? variantLabel(v) + ' \u00B7 ' : '') + p.rarity }));
        if (inOtherSlot) item.appendChild($('div', { class: 'rpg-in-slot-tag', html: 'Slot ' + (assignedTo + 1) }));
        grid.appendChild(item);
      }
      menuEl.appendChild(grid);
    }

    root.appendChild(menuEl);
    setupMenuDismiss();
  };

  // ================================================================
  // DEX MODAL
  // ================================================================
  const openDex = () => {
    const m = $('div', { class: 'rpg-modal', onclick: (e) => { if (e.target === m) m.remove(); } });
    const inner = $('div', { class: 'rpg-modal-inner rpg-dex' });
    inner.appendChild($('h3', { html: 'PET DEX', style: { margin: '0 0 12px', color: 'gold' } }));
    const grid = $('div', { class: 'rpg-dex-grid' });
    for (const p of PETS) {
      const nCount = state.collection.filter(i => i.petId === p.id && variantOf(i) === 'normal').length;
      const owned = nCount > 0;
      const card = $('div', { class: 'rpg-dex-card' + (owned ? '' : ' rpg-dex-silhouette') });
      // Top row: three small diamond badges (shiny / hollow / rainbow)
      const badgeRow = $('div', { class: 'rpg-dex-card-badges' });
      for (const vk of ['shiny', 'hollow', 'rainbow']) {
        const count = state.collection.filter(i => i.petId === p.id && variantOf(i) === vk).length;
        const isOwned = count > 0;
        const mini = $('div', {
          class: 'rpg-dex-mini rpg-dex-mini-' + vk + (isOwned ? ' owned' : ''),
          title: isOwned ? (variantLabel(vk) + ': ' + count + ' caught') : (variantLabel(vk) + ': not yet caught')
        });
        badgeRow.appendChild(mini);
      }
      card.appendChild(badgeRow);
      // Middle: image
      card.appendChild($('img', { src: p.img }));
      // Bottom: name + rarity/count
      card.appendChild($('div', { class: 'n', html: owned ? p.name : '???' }));
      card.appendChild($('div', { class: 'c', html: owned ? ('\u00D7' + nCount + ' \u00B7 ' + p.rarity) : '\u2014' }));
      grid.appendChild(card);
    }
    inner.appendChild(grid);
    inner.appendChild($('button', { html: 'Close', onclick: () => m.remove() }));
    m.appendChild(inner);
    document.body.appendChild(m);
  };

  // ================================================================
  // AUDIO + CELEBRATION EFFECTS
  // ================================================================
  const audioCtx = (() => {
    let ctx = null;
    return () => {
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
      }
      return ctx;
    };
  })();

  const beep = (freq, dur, delay, gain, type) => {
    delay = delay || 0; gain = gain == null ? 0.08 : gain; type = type || 'sine';
    const ctx = audioCtx(); if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.05);
  };

  const playCatchSound = (variant) => {
    if (variant === 'rainbow') {
      // Ascending arpeggio sweep
      const notes = [523, 659, 784, 1047, 1319, 1568, 2093, 2637];
      notes.forEach((f, i) => beep(f, 0.25, i * 0.08, 0.09, 'triangle'));
      return;
    }
    if (variant === 'hollow') {
      // Crystal bells — high triangle-wave arpeggio with a soft trailing chime
      beep(880,  0.20, 0.00, 0.09, 'triangle');
      beep(1319, 0.20, 0.12, 0.09, 'triangle');
      beep(1760, 0.22, 0.24, 0.09, 'triangle');
      beep(2093, 0.45, 0.38, 0.10, 'triangle');
      beep(1319, 0.35, 0.50, 0.06, 'sine');  // gentle echo
      return;
    }
    if (variant === 'shiny') {
      // Three-note ascending
      beep(659, 0.14, 0.00, 0.09, 'triangle');
      beep(880, 0.14, 0.11, 0.09, 'triangle');
      beep(1319, 0.30, 0.22, 0.10, 'triangle');
      return;
    }
    // Normal: two-note confirm
    beep(659, 0.12, 0.00, 0.08, 'sine');
    beep(988, 0.20, 0.10, 0.08, 'sine');
  };

  const spawnParticles = (originX, originY, count, colors, duration, spread) => {
    spread = spread || 220;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'rpg-particle';
      p.style.left = originX + 'px';
      p.style.top  = originY + 'px';
      p.style.background = colors[i % colors.length];
      const angle = Math.random() * Math.PI * 2;
      const dist  = 40 + Math.random() * spread;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist - 30; // slight upward bias
      p.style.setProperty('--dx', dx + 'px');
      p.style.setProperty('--dy', dy + 'px');
      p.style.animationDuration = duration + 'ms';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), duration + 100);
    }
  };

  const flashScreen = (color, duration) => {
    const f = document.createElement('div');
    f.className = 'rpg-screen-flash';
    f.style.background = color;
    f.style.animationDuration = duration + 'ms';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), duration + 50);
  };

  const showCelebrationBanner = (text, bg, fg, duration) => {
    const b = document.createElement('div');
    b.className = 'rpg-celebration-banner';
    b.innerHTML = text;
    b.style.background = bg;
    b.style.color = fg;
    b.style.animationDuration = duration + 'ms';
    document.body.appendChild(b);
    setTimeout(() => b.remove(), duration + 50);
  };

  const shakePanel = () => {
    if (!el.panel) return;
    el.panel.classList.add('rpg-panel-shake');
    setTimeout(() => el.panel && el.panel.classList.remove('rpg-panel-shake'), 700);
  };

  // Returns extra delay (ms) to wait before showing the catch modal
  const playCatchCelebration = (variant, x, y) => {
    playCatchSound(variant);
    if (variant === 'normal') {
      spawnParticles(x, y, 14, ['#facc15','#fef3c7','#fff'], 900, 150);
      return 250;
    }
    if (variant === 'shiny') {
      spawnParticles(x, y, 28, ['#facc15','#fef3c7','#fff59d','#eab308'], 1300, 220);
      showCelebrationBanner('&#9733; SHINY! &#9733;',
        'radial-gradient(circle at 50% 40%, #fef3c7, #facc15 70%, #eab308)', '#78350f', 1600);
      return 1400;
    }
    if (variant === 'hollow') {
      spawnParticles(x, y, 42, ['#f8fafc','#e2e8f0','#cbd5e1','#94a3b8','#dbeafe','#fff'], 1600, 280);
      flashScreen('rgba(226,232,240,0.32)', 480);
      showCelebrationBanner('&#9670; HOLLOW! &#9670;',
        'linear-gradient(135deg, #f8fafc 0%, #cbd5e1 30%, #94a3b8 55%, #cbd5e1 80%, #f1f5f9 100%)', '#1e293b', 1900);
      return 1700;
    }
    if (variant === 'rainbow') {
      spawnParticles(x, y, 100, ['#ff5555','#ffaa00','#ffff55','#55ff77','#55ccff','#aa66ff','#ff66cc','#fff'], 2200, 380);
      flashScreen('rgba(255,105,180,0.35)', 600);
      shakePanel();
      showCelebrationBanner('&#10022; RAINBOW! &#10022;',
        'conic-gradient(from 0deg, #ff5555, #ffaa00, #ffff55, #55ff77, #55ccff, #aa66ff, #ff66cc, #ff5555)',
        '#000', 2400);
      return 2200;
    }
    return 0;
  };

  // ================================================================
  // XP + LEVEL-UP
  // ================================================================
  const flashLevelUp = (targetEl, text) => {
    if (targetEl && targetEl.classList) { targetEl.classList.add('rpg-levelup-anim'); setTimeout(() => targetEl.classList.remove('rpg-levelup-anim'), 950); }
    const toast = $('div', { class: 'rpg-levelup-toast', html: text });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1500);
  };

  const playXPGainSound = () => {
    beep(880,  0.09, 0.00, 0.05, 'sine');
    beep(1319, 0.16, 0.07, 0.06, 'sine');
  };
  const flashXPGain = (amount) => {
    if (!el.stats || !el.bar) return;
    const t = document.createElement('div');
    t.className = 'rpg-xp-gain';
    t.textContent = '+' + amount + ' XP';
    el.stats.appendChild(t);
    setTimeout(() => t.remove(), 1300);
    // Bar pulse — remove any lingering class to allow retriggering
    el.bar.classList.remove('rpg-bar-pulse');
    void el.bar.offsetWidth;
    el.bar.classList.add('rpg-bar-pulse');
    setTimeout(() => el.bar && el.bar.classList.remove('rpg-bar-pulse'), 500);
    playXPGainSound();
  };
  const grantPlayerXP = (amount, reason) => {
    if (!amount) return;
    // Refresh player from storage first to pick up any changes from other tabs
    // that arrived between the last listener event and now.
    state.player = load(K.player, state.player);
    state.player.xp += amount;
    let leveled = false;
    while (state.player.xp >= xpToNextLevel(state.player.level)) { state.player.xp -= xpToNextLevel(state.player.level); state.player.level++; leveled = true; }
    persistPlayer(); renderPanel();
    flashXPGain(amount);
    if (leveled) { flashLevelUp(el.charSlot, 'LEVEL UP! ' + state.player.level); respawnAllRoamers(); }
    console.log('[APM RPG] +' + amount + ' XP (' + reason + ')');
  };

  // ================================================================
  // ACTION DETECTION
  // ================================================================
  const cooldown = { complete: 0 };
  const canFire = (k, ms) => { ms = ms || 1500; const now = Date.now(); if (now - cooldown[k] < ms) return false; cooldown[k] = now; return true; };
  const textOf = (n) => ((n && (n.textContent || n.value || (n.getAttribute && n.getAttribute('aria-label')))) || '').trim().toLowerCase();

  document.addEventListener('click', (e) => {
    let n = e.target;
    for (let i = 0; i < 6 && n && n !== document.body; i++, n = n.parentElement) {
      const t = textOf(n); if (!t) continue;
      if (/\bcomplete\b/.test(t) && !/incomplete/.test(t) && canFire('complete')) { grantPlayerXP(XP_REWARDS.completeWorkOrder, 'complete WO'); return; }
    }
  }, true);

  // ================================================================
  // ROAMING PETS (up to 3, one per unlocked active slot)
  // ================================================================
  const roamers = [null, null, null];
  const removeRoamerAt = (i) => { if (roamers[i]) { roamers[i].remove(); roamers[i] = null; } };
  const removeAllRoamers = () => { for (let i = 0; i < roamers.length; i++) removeRoamerAt(i); };
  const moveRoamerAt = (i) => {
    const r = roamers[i]; if (!r) return;
    r.style.left = Math.floor(rand(20, window.innerWidth - 80)) + 'px';
    r.style.top  = Math.floor(rand(20, window.innerHeight - 80)) + 'px';
  };
  const spawnRoamerAt = (i) => {
    removeRoamerAt(i);
    if (state.player.hideRoamers) return;
    if (i >= unlockedSlotCount()) return;
    const iid = state.equip.petInstanceIds[i];
    const inst = instanceById(iid);
    if (!inst) return;
    const p = petById(inst.petId);
    if (!p) return;
    const v = variantOf(inst);
    const cls = 'rpg-roam' + variantClassStr(p, v);
    const el = $('div', { class: cls });
    el.appendChild($('div', { class: 'label', html: (variantBadge(v) ? variantBadge(v) + ' ' : '') + p.name }));
    el.appendChild($('img', { src: petImg(p, v) }));
    el.style.left = Math.floor(rand(20, window.innerWidth - 80)) + 'px';
    el.style.top  = Math.floor(rand(20, window.innerHeight - 80)) + 'px';
    document.body.appendChild(el);
    roamers[i] = el;
    requestAnimationFrame(() => requestAnimationFrame(() => moveRoamerAt(i)));
  };
  const respawnAllRoamers = () => {
    removeAllRoamers();
    for (let i = 0; i < PET_SLOTS.length; i++) spawnRoamerAt(i);
  };
  setInterval(() => {
    for (let i = 0; i < PET_SLOTS.length; i++) {
      if (i >= unlockedSlotCount()) { removeRoamerAt(i); continue; }
      if (!roamers[i]) { spawnRoamerAt(i); continue; }
      moveRoamerAt(i);
    }
  }, 10000);

  // ================================================================
  // WILD SPAWN + CATCH
  // ================================================================
  let wildEl = null, wildPet = null, wildVariant = 'normal', wildAttempts = 0, wildRoamTimer = null, catchInProgress = false;

  const pickWildPet = () => {
    const total = PETS.reduce((s, p) => s + p.spawnWeight, 0);
    let r = Math.random() * total;
    for (const p of PETS) { r -= p.spawnWeight; if (r <= 0) return p; }
    return PETS[0];
  };

  const moveWild = () => {
    if (!wildEl) return;
    wildEl.style.left = Math.floor(rand(40, window.innerWidth - 160)) + 'px';
    wildEl.style.top = Math.floor(rand(40, window.innerHeight - 220)) + 'px';
  };

  const spawnWild = () => {
    if (wildEl) return;
    wildPet = pickWildPet();
    wildVariant = rollVariant();
    wildAttempts = 0;
    const special = wildVariant !== 'normal';
    const cls = 'rpg-wild rpg-catchable' + variantClassStr(wildPet, wildVariant) + (special ? ' rpg-wild-special' : '');
    wildEl = $('div', { class: cls, title: 'Click to attempt catch!', onclick: attemptCatch });
    const vLabel = special ? (variantBadge(wildVariant) + ' WILD ' + variantLabel(wildVariant).toUpperCase() + ' ' + wildPet.name + '!') : ('WILD ' + wildPet.name + '!');
    wildEl.appendChild($('div', { class: 'label', html: vLabel }));
    wildEl.appendChild($('img', { src: petImg(wildPet, wildVariant) }));
    wildEl.appendChild($('div', { class: 'catch-hint', html: 'CATCH!' }));
    wildEl.style.left = Math.floor(rand(80, window.innerWidth - 240)) + 'px';
    wildEl.style.top = Math.floor(rand(80, window.innerHeight - 280)) + 'px';
    document.body.appendChild(wildEl);
    requestAnimationFrame(() => requestAnimationFrame(moveWild));
    wildRoamTimer = setInterval(moveWild, 8000);
    console.log('[APM RPG] Wild ' + (special ? (variantLabel(wildVariant).toUpperCase() + ' ') : '') + wildPet.name + ' appeared!');
  };

  const despawnWild = () => {
    if (wildRoamTimer) { clearInterval(wildRoamTimer); wildRoamTimer = null; }
    if (wildEl) { wildEl.remove(); wildEl = null; }
    wildPet = null; wildVariant = 'normal'; wildAttempts = 0; catchInProgress = false;
  };

  const showModal = (html) => new Promise((resolve) => {
    const m = $('div', { class: 'rpg-modal' });
    const inner = $('div', { class: 'rpg-modal-inner' });
    inner.appendChild($('div', { html: html, style: { fontSize: '15px', lineHeight: '1.4' } }));
    inner.appendChild($('button', { html: 'OK', onclick: () => { m.remove(); resolve(); } }));
    m.appendChild(inner);
    document.body.appendChild(m);
  });

  async function attemptCatch(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (!wildPet || catchInProgress) return;
    catchInProgress = true;
    const vMeta = VARIANT_META[wildVariant] || VARIANT_META.normal;
    const rate = wildPet.catchBaseRate * vMeta.catchMult;
    const success = Math.random() < rate;
    if (success) {
      // Capture wild pet screen position BEFORE despawning for celebration origin
      let cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      if (wildEl) {
        const r = wildEl.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        wildEl.classList.add('rpg-caught-anim');
      }
      await new Promise(r => setTimeout(r, 600));
      const caughtName = wildPet.name, caughtPetId = wildPet.id, caughtVariant = wildVariant;
      despawnWild();
      const inst = { instanceId: genInstanceId(), petId: caughtPetId, variant: caughtVariant, caughtAt: Date.now() };
      state.collection.push(inst); persistCollection();
      const isFirst = state.collection.filter(i => i.petId === caughtPetId && variantOf(i) === caughtVariant).length === 1;
      const label = variantLabel(caughtVariant).toUpperCase();
      const badge = variantBadge(caughtVariant);
      const specialLine = caughtVariant !== 'normal'
        ? '<span style="color:' + (VARIANT_META[caughtVariant].color === 'rainbow' ? '#ff69b4' : VARIANT_META[caughtVariant].color) + ';font-size:18px">' + badge + ' ' + label + ' ' + badge + '</span><br>' : '';
      const firstLine = isFirst
        ? '<br><i>' + (caughtVariant !== 'normal' ? 'Extremely rare variant!' : 'New species unlocked!') + '</i>' : '';
      renderPanel();
      // Fire audio + particles + banner. Delay modal to let the celebration breathe.
      const extraDelay = playCatchCelebration(caughtVariant, cx, cy);
      if (extraDelay > 0) await new Promise(r => setTimeout(r, extraDelay));
      await showModal(specialLine + 'Caught <b>' + caughtName + '</b>!' + firstLine);
    } else {
      wildAttempts++;
      if (wildEl) {
        wildEl.classList.add('rpg-wild-shake');
        setTimeout(() => { if (wildEl) wildEl.classList.remove('rpg-wild-shake'); }, 400);
      }
      setTimeout(moveWild, 350);
      if (wildAttempts >= 3) {
        const name = (wildPet && wildPet.name) || 'pet';
        const wasVar = wildVariant;
        despawnWild();
        const prefix = wasVar !== 'normal' ? ('<span style="color:' + (VARIANT_META[wasVar].color === 'rainbow' ? '#ff69b4' : VARIANT_META[wasVar].color) + '">' + variantLabel(wasVar).toUpperCase() + '</span> ') : '';
        await showModal('The ' + prefix + '<b>' + name + '</b> ran away!');
      } else {
        catchInProgress = false;
      }
    }
  }

  const rollWildSpawn = () => { if (!wildEl && Math.random() < WILD_SPAWN_CHANCE) spawnWild(); };
  const onPageChange = () => {
    setTimeout(rollWildSpawn, 500);
    if (Math.random() < PAGE_CHANGE_XP_CHANCE) {
      grantPlayerXP(XP_REWARDS.pageChange, 'page change');
    }
  };
  window.addEventListener('hashchange', onPageChange);
  window.addEventListener('popstate', onPageChange);

  // ================================================================
  // BOOT
  // ================================================================
  const showStarterModal = () => {
    // Don't stack if one is already open
    if (document.querySelector('.rpg-starter-modal')) return;
    const modal = $('div', { class: 'rpg-modal rpg-starter-modal' });
    const inner = $('div', { class: 'rpg-modal-inner rpg-starter-inner' });
    inner.appendChild($('h3', { html: 'CHOOSE YOUR STARTER', style: { margin: '0 0 4px', color: '#ffd166' } }));
    inner.appendChild($('div', { html: 'Pick one pet to begin your journey. You can catch the others in the wild.', style: { fontSize: '12px', color: '#aaa', marginBottom: '16px' } }));
    const choices = $('div', { class: 'rpg-starter-choices' });
    for (const p of PETS.slice(0, 3)) {
      const card = $('div', {
        class: 'rpg-starter-card',
        title: p.rarity + ' \u00B7 base catch ' + Math.round((p.catchBaseRate || 0) * 100) + '%',
        onclick: () => {
          const inst = { instanceId: 'starter_' + Date.now(), petId: p.id, variant: 'normal', caughtAt: Date.now() };
          state.collection.push(inst);
          state.equip.petInstanceIds[0] = inst.instanceId;
          persistCollection(); persistEquip(); writeRaw(K.starter, '1');
          modal.remove();
          renderPanel();
          respawnAllRoamers();
        }
      });
      card.appendChild($('img', { src: p.img }));
      card.appendChild($('div', { class: 'n', html: p.name }));
      card.appendChild($('div', { class: 'r', html: p.rarity }));
      choices.appendChild(card);
    }
    inner.appendChild(choices);
    modal.appendChild(inner);
    document.body.appendChild(modal);
  };

  // Periodic polling: try both the GitHub update fetch (rate-limited internally)
  // and the installed-version re-check. Also runs on tab visibility change so a
  // tab that has been idle picks up updates the moment it's focused again.
  const startSyncPolling = () => {
    const tick = () => { try { checkForUpdate(false); } catch (e) {} bumpInstalledVersion(); };
    setInterval(tick, UPDATE_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    window.addEventListener('focus', tick);
  };

  const boot = () => {
    console.log('[APM RPG] v' + LOCAL_VERSION + ' loaded');
    setupMultiTabSync();
    bumpInstalledVersion();
    loadUpdateCache();
    buildPanel(); renderPanel();
    respawnAllRoamers();
    // Roll a wild spawn shortly after load
    setTimeout(rollWildSpawn, 1500);
    // Starter pet choice for new users
    if (!readRaw(K.starter) && state.collection.length === 0 && PETS.length > 0) {
      setTimeout(showStarterModal, 800);
    }
    // Poll the hosted script for a newer version (respects 1h cache)
    setTimeout(() => checkForUpdate(false), 3000);
    startSyncPolling();
    if (!state.player.username) {
      let attempts = 0;
      const uInterval = setInterval(() => {
        attempts++;
        const before = state.player.username;
        ensureUsername();
        if (state.player.username && !before) renderPanel();
        if (state.player.username || attempts >= 15) clearInterval(uInterval);
      }, 2000);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  const APM_RPG_API = {
    grantXP: (n) => grantPlayerXP(n || 50, 'debug'),
    setLevel: (lvl) => { state.player.level = Math.max(1, lvl|0); state.player.xp = 0; persistPlayer(); renderPanel(); respawnAllRoamers(); },
    spawn: () => spawnWild(),
    spawnVariant: (v) => { const orig = Math.random; Math.random = (() => { let n = 0; return () => n++ === 0 ? 0 : orig(); })(); const targetChance = { rainbow: 0, hollow: VARIANT_META.rainbow.chance, shiny: VARIANT_META.rainbow.chance + VARIANT_META.hollow.chance }[v]; Math.random = (() => { let n = 0; return () => n++ === 0 ? (targetChance !== undefined ? targetChance : 0.99) : orig(); })(); spawnWild(); Math.random = orig; },
    rollSpawn: () => rollWildSpawn(),
    despawn: despawnWild,
    detect: () => { const raw = detectUsername(); const norm = normalizeAlias(raw); console.log('raw:', raw, '-> alias:', norm); return norm; },
    state: state,
    setUsername: (u) => { state.player.username = u; persistPlayer(); renderPanel(); },
    reset: () => { Object.values(K).forEach(deleteRaw); setTimeout(() => location.reload(), 50); },
    devMode: DEV_MODE,
    checkUpdate: () => checkForUpdate(true),
    updateInfo: () => ({ local: LOCAL_VERSION, latest: updateInfo.latest, available: updateInfo.available, checkedAt: updateInfo.checkedAt ? new Date(updateInfo.checkedAt).toISOString() : 'never', url: UPDATE_DOWNLOAD_URL }),
    debugUpdate: () => ({
      local: LOCAL_VERSION,
      updateInfo: { latest: updateInfo.latest, available: updateInfo.available, newerLocalVersion: updateInfo.newerLocalVersion, checkedAt: updateInfo.checkedAt ? new Date(updateInfo.checkedAt).toISOString() : 'never' },
      installedRecord: (() => { try { return JSON.parse(readRaw(K.installedVersion)); } catch(e) { return null; } })(),
      url: UPDATE_META_URL,
      hasGmXhr: typeof GM_xmlhttpRequest !== 'undefined',
      hasChangeListener: typeof GM_addValueChangeListener !== 'undefined',
      grants: (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.grant) || [],
      buttonExists: !!(el && el.updateBtn),
      buttonVisible: !!(el && el.updateBtn && el.updateBtn.style.display !== 'none'),
      cacheIntervalMs: UPDATE_CHECK_INTERVAL_MS
    }),
    clearUpdateCache: () => { updateInfo.checkedAt = 0; updateInfo.latest = null; updateInfo.available = false; saveUpdateCache(); return 'cleared'; },
  };
  // Sandbox-context handle (works from Tampermonkey's isolated context).
  window.APM_RPG = APM_RPG_API;

  // Page-context bridge: Chrome's isolated worlds silently block cross-context
  // property writes via unsafeWindow, so instead we inject a proxy into the page
  // and communicate via postMessage. Methods become async on the page side.
  const APM_RPG_METHODS = ['grantXP','setLevel','spawn','spawnVariant','rollSpawn','despawn','detect','setUsername','reset','checkUpdate','updateInfo','debugUpdate','clearUpdateCache'];

  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.__apm_rpg !== 'call') return;
    const req = e.data;
    let result, error;
    try {
      const target = APM_RPG_API[req.method];
      if (typeof target === 'function') {
        result = target.apply(APM_RPG_API, req.args || []);
      } else if (req.method === 'state') {
        result = APM_RPG_API.state;
      } else {
        result = target;
      }
      // If the sandbox returned a Promise, await it so the page gets the resolved value
      if (result && typeof result.then === 'function') {
        result = await result;
      }
      try { result = JSON.parse(JSON.stringify(result === undefined ? null : result)); }
      catch (err) { result = String(result); }
    } catch (err) {
      error = String((err && err.message) || err);
    }
    window.postMessage({ __apm_rpg: 'result', id: req.id, result: result, error: error }, '*');
  });

  const injectPageBridge = () => {
    const script = document.createElement('script');
    script.setAttribute('data-apm-rpg-bridge', '1');
    script.textContent =
      '(function(){' +
        'if(window.APM_RPG&&window.APM_RPG.__bridge)return;' +
        'var pending=new Map();' +
        'window.addEventListener("message",function(e){' +
          'if(e.source!==window||!e.data||e.data.__apm_rpg!=="result")return;' +
          'var p=pending.get(e.data.id);' +
          'if(!p)return;' +
          'pending.delete(e.data.id);' +
          'if(e.data.error)p.reject(new Error(e.data.error));' +
          'else p.resolve(e.data.result);' +
        '});' +
        'var call=function(method,args){' +
          'return new Promise(function(resolve,reject){' +
            'var id="r"+Math.random().toString(36).slice(2)+Date.now().toString(36);' +
            'pending.set(id,{resolve:resolve,reject:reject});' +
            'window.postMessage({__apm_rpg:"call",id:id,method:method,args:args||[]},"*");' +
            'setTimeout(function(){if(pending.has(id)){pending.delete(id);reject(new Error("APM_RPG bridge timeout"));}},5000);' +
          '});' +
        '};' +
        'var methods=' + JSON.stringify(APM_RPG_METHODS) + ';' +
        'var api={__bridge:true};' +
        'methods.forEach(function(m){api[m]=function(){return call(m,Array.prototype.slice.call(arguments));};});' +
        'Object.defineProperty(api,"state",{get:function(){return call("state",[]);}});' +
        'window.APM_RPG=api;' +
        'console.log("%c[APM RPG]%c page bridge ready. Use: await APM_RPG.updateInfo()","color:#22c55e;font-weight:bold","color:inherit");' +
      '})();';
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  };
  try { injectPageBridge(); } catch (e) { console.error('[APM RPG] bridge injection failed', e); }
})();
