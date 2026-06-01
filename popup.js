/* ExtManager - popup logic */
"use strict";

const STORAGE_KEYS = {
  PROFILES: "profiles",
  ACTIVE_PROFILE: "activeProfile",
  PINNED: "pinned",
  LOCKED: "locked",
  RECENT: "recent",
  SORT: "sortBy",
  SETTINGS: "settings",
  LAST_BULK_SNAPSHOT: "lastBulkSnapshot"
};

const DEFAULT_SETTINGS = {
  confirmBulk: true,
  showThemes: false // include theme extensions in the list
};

const TASK_MANAGER_HELP = "Chrome does not expose a direct Task Manager launcher to extensions.\n\nPress Shift+Esc in Chrome, or open Chrome menu > More tools > Task manager. Sort by CPU or Memory footprint and look for rows labeled Extension.";

const BLOCKED_PROFILE_NAMES = new Set(["__proto__", "prototype", "constructor"]);

const state = {
  extensions: [],          // filtered chrome.management items (no self, no themes unless enabled)
  selfId: chrome.runtime.id,
  profiles: {},            // { name: { [extId]: bool } }
  activeProfile: null,
  pinned: new Set(),       // extension ids pinned to top
  locked: new Set(),       // extension ids exempt from bulk Enable/Disable/Invert
  recent: [],              // ordered ext ids most-recently toggled first
  settings: { ...DEFAULT_SETTINGS },
  query: "",
  sortBy: "name"
};

// ---------- Storage helpers ----------

async function loadAllStorage() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.PROFILES,
    STORAGE_KEYS.ACTIVE_PROFILE,
    STORAGE_KEYS.PINNED,
    STORAGE_KEYS.LOCKED,
    STORAGE_KEYS.RECENT,
    STORAGE_KEYS.SORT,
    STORAGE_KEYS.SETTINGS
  ]);
  state.profiles = sanitizeProfiles(data[STORAGE_KEYS.PROFILES]);
  state.activeProfile = data[STORAGE_KEYS.ACTIVE_PROFILE] || null;
  state.pinned = new Set(data[STORAGE_KEYS.PINNED] || []);
  state.locked = new Set(data[STORAGE_KEYS.LOCKED] || []);
  state.recent = Array.isArray(data[STORAGE_KEYS.RECENT]) ? data[STORAGE_KEYS.RECENT] : [];
  state.sortBy = data[STORAGE_KEYS.SORT] || "name";
  state.settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
}

function isSafeProfileName(name) {
  return typeof name === "string" && !!name.trim() && !BLOCKED_PROFILE_NAMES.has(name.trim());
}

function sanitizeProfiles(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [rawName, profile] of Object.entries(value)) {
    const name = rawName.trim();
    if (!isSafeProfileName(name) || !profile || typeof profile !== "object" || Array.isArray(profile)) continue;
    const cleanProfile = {};
    for (const [extId, enabled] of Object.entries(profile)) {
      if (typeof extId === "string" && extId) cleanProfile[extId] = !!enabled;
    }
    out[name] = cleanProfile;
  }
  return out;
}

function hasProfile(name) {
  return Object.prototype.hasOwnProperty.call(state.profiles, name);
}

async function saveProfiles() {
  await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: state.profiles });
}
async function saveActiveProfile() {
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_PROFILE]: state.activeProfile });
}
async function savePinned() {
  await chrome.storage.local.set({ [STORAGE_KEYS.PINNED]: [...state.pinned] });
}
async function saveLocked() {
  await chrome.storage.local.set({ [STORAGE_KEYS.LOCKED]: [...state.locked] });
}
async function saveRecent() {
  // cap to last 50
  await chrome.storage.local.set({ [STORAGE_KEYS.RECENT]: state.recent.slice(0, 50) });
}
async function saveSort() {
  await chrome.storage.local.set({ [STORAGE_KEYS.SORT]: state.sortBy });
}

// ---------- Extension list ----------

async function loadExtensions() {
  const all = await chrome.management.getAll();
  state.extensions = all
    .filter(e => e.id !== state.selfId)
    .filter(e => state.settings.showThemes || e.type !== "theme")
    .filter(e => e.type === "extension" || e.type === "theme");
}

function bestIcon(ext) {
  if (!ext.icons || ext.icons.length === 0) return "";
  // pick the largest icon at or below 64
  const sorted = [...ext.icons].sort((a, b) => a.size - b.size);
  let pick = sorted[0];
  for (const ic of sorted) {
    if (ic.size <= 64) pick = ic;
  }
  return pick.url;
}

function recordRecent(extId) {
  state.recent = [extId, ...state.recent.filter(id => id !== extId)].slice(0, 50);
  return saveRecent();
}

async function setEnabled(ext, enabled, { skipRecent = false } = {}) {
  if (ext.id === state.selfId) return; // safety: never touch self
  if (!ext.mayDisable && !enabled) {
    throw new Error("This extension cannot be disabled.");
  }
  await chrome.management.setEnabled(ext.id, enabled);
  ext.enabled = enabled;
  if (!skipRecent) await recordRecent(ext.id);
}

// ---------- Profiles ----------

function snapshotCurrentState() {
  const snap = {};
  for (const ext of state.extensions) snap[ext.id] = !!ext.enabled;
  return snap;
}

async function applyProfile(name) {
  const profile = state.profiles[name];
  if (!profile) return;
  const ops = [];
  for (const ext of state.extensions) {
    if (!(ext.id in profile)) continue; // leave unknowns as-is
    const want = !!profile[ext.id];
    if (ext.enabled !== want) {
      if (!ext.mayDisable && !want) continue; // can't disable, skip
      ops.push(setEnabled(ext, want, { skipRecent: true }).catch(err => console.warn("apply skip", ext.id, err)));
    }
  }
  await Promise.all(ops);
  state.activeProfile = name;
  await saveActiveProfile();
}

async function saveCurrentToProfile(name) {
  state.profiles[name] = snapshotCurrentState();
  await saveProfiles();
}

async function deleteProfile(name) {
  delete state.profiles[name];
  if (state.activeProfile === name) {
    state.activeProfile = null;
    await saveActiveProfile();
  }
  await saveProfiles();
}

// ---------- Modal (native prompt/confirm close the popup, so we use our own) ----------

function modalShow({ title, withInput = false, defaultValue = "", showCancel = true }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("modal");
    const titleEl = document.getElementById("modalTitle");
    const input = document.getElementById("modalInput");
    const ok = document.getElementById("modalOk");
    const cancel = document.getElementById("modalCancel");

    titleEl.textContent = title;
    if (withInput) {
      input.classList.remove("hidden");
      input.value = defaultValue;
    } else {
      input.classList.add("hidden");
    }
    cancel.classList.toggle("hidden", !showCancel);
    modal.classList.remove("hidden");
    const previousActive = document.activeElement;

    if (withInput) {
      setTimeout(() => { input.focus(); input.select(); }, 0);
    } else {
      setTimeout(() => ok.focus(), 0);
    }

    const cleanup = (result) => {
      modal.classList.add("hidden");
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKey);
      modal.removeEventListener("keydown", onKey);
      document.removeEventListener("keydown", onDocKey);
      if (previousActive && typeof previousActive.focus === "function") {
        previousActive.focus();
      }
      resolve(result);
    };
    const onOk = () => cleanup(withInput ? input.value : true);
    const onCancel = () => cleanup(withInput ? null : false);
    const onKey = (e) => {
      if (e.key === "Enter") { e.preventDefault(); onOk(); }
      else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    const onDocKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onDocKey);
  });
}

function modalConfirm(title) {
  return modalShow({ title, withInput: false });
}
function modalAlert(title) {
  return modalShow({ title, withInput: false, showCancel: false });
}
function modalPrompt(title, defaultValue = "") {
  return modalShow({ title, withInput: true, defaultValue });
}

// ---------- Rendering ----------

function $(sel) { return document.querySelector(sel); }

function setStatus(msg, kind = "", action = null) {
  const el = $("#statusMsg");
  el.textContent = "";
  el.className = "status" + (kind ? " " + kind : "");
  if (msg) {
    el.appendChild(document.createTextNode(msg));
    if (action && action.label && typeof action.onClick === "function") {
      el.appendChild(document.createTextNode(" "));
      const a = document.createElement("a");
      a.href = "#";
      a.className = "status-action";
      a.textContent = action.label;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        clearTimeout(setStatus._t);
        el.textContent = "";
        el.className = "status";
        action.onClick();
      });
      el.appendChild(a);
    }
    clearTimeout(setStatus._t);
    const timeout = action ? 8000 : 2500;
    setStatus._t = setTimeout(() => {
      el.textContent = "";
      el.className = "status";
    }, timeout);
  }
}

function renderProfiles() {
  const sel = $("#profileSelect");
  const names = Object.keys(state.profiles).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = "";

  if (names.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— no profiles —";
    sel.appendChild(opt);
    sel.disabled = true;
  } else {
    sel.disabled = false;
    for (const n of names) {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    }
    if (state.activeProfile && names.includes(state.activeProfile)) {
      sel.value = state.activeProfile;
    }
  }
}

function compareExt(a, b) {
  const aPin = state.pinned.has(a.id);
  const bPin = state.pinned.has(b.id);
  if (aPin !== bPin) return aPin ? -1 : 1;

  switch (state.sortBy) {
    case "enabled":
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      break;
    case "disabled":
      if (a.enabled !== b.enabled) return a.enabled ? 1 : -1;
      break;
    case "recent": {
      const ai = state.recent.indexOf(a.id);
      const bi = state.recent.indexOf(b.id);
      const av = ai === -1 ? Infinity : ai;
      const bv = bi === -1 ? Infinity : bi;
      if (av !== bv) return av - bv;
      break;
    }
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function renderList() {
  const list = $("#extList");
  const tpl = $("#extItemTpl");
  const q = state.query.trim().toLowerCase();

  const filtered = state.extensions
    .filter(e => !q || e.name.toLowerCase().includes(q) || (e.description || "").toLowerCase().includes(q))
    .sort(compareExt);

  list.innerHTML = "";
  for (const ext of filtered) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = ext.id;
    if (!ext.enabled) node.classList.add("disabled");
    if (state.pinned.has(ext.id)) node.classList.add("pinned");
    if (state.locked.has(ext.id)) node.classList.add("locked");

    const img = node.querySelector(".ext-icon");
    const iconUrl = bestIcon(ext);
    if (iconUrl) img.src = iconUrl;

    node.querySelector(".ext-name").textContent = ext.name;
    const sub = node.querySelector(".ext-sub");
    sub.textContent = ext.shortName && ext.shortName !== ext.name
      ? ext.shortName
      : (ext.description || "");

    const cb = node.querySelector(".ext-toggle");
    cb.checked = !!ext.enabled;
    cb.disabled = !ext.mayDisable && ext.enabled; // can only fail when trying to disable
    cb.setAttribute("aria-label", `${ext.enabled ? "Disable" : "Enable"} ${ext.name}`);
    cb.addEventListener("change", async () => {
      const desired = cb.checked;
      cb.disabled = true;
      try {
        await setEnabled(ext, desired);
        node.classList.toggle("disabled", !desired);
        updateCounts();
        setStatus(`${ext.name}: ${desired ? "enabled" : "disabled"}`, "ok");
      } catch (err) {
        cb.checked = !desired;
        setStatus(err.message || "Failed to toggle", "error");
      } finally {
        cb.disabled = !ext.mayDisable && ext.enabled;
        cb.setAttribute("aria-label", `${ext.enabled ? "Disable" : "Enable"} ${ext.name}`);
      }
    });

    const pinBtn = node.querySelector(".pin-btn");
    pinBtn.setAttribute("aria-label", state.pinned.has(ext.id) ? `Unpin ${ext.name}` : `Pin ${ext.name}`);
    pinBtn.addEventListener("click", async () => {
      if (state.pinned.has(ext.id)) state.pinned.delete(ext.id);
      else state.pinned.add(ext.id);
      await savePinned();
    });

    const lockBtn = node.querySelector(".lock-btn");
    const setLockGlyph = () => {
      const isLocked = state.locked.has(ext.id);
      // 🔒 (U+1F512) when locked, 🔓 (U+1F513) when unlocked
      lockBtn.textContent = isLocked ? "🔒" : "🔓";
      lockBtn.setAttribute("aria-label", isLocked ? `Unlock ${ext.name}` : `Lock ${ext.name}`);
      lockBtn.title = isLocked
        ? "Unlock — allow bulk Enable/Disable/Invert to affect this extension"
        : "Lock — exempt from bulk Enable/Disable/Invert";
    };
    setLockGlyph();
    lockBtn.addEventListener("click", async () => {
      if (state.locked.has(ext.id)) state.locked.delete(ext.id);
      else state.locked.add(ext.id);
      await saveLocked();
      node.classList.toggle("locked", state.locked.has(ext.id));
      setLockGlyph();
      setStatus(
        state.locked.has(ext.id)
          ? `${ext.name} locked — bulk actions will skip it`
          : `${ext.name} unlocked`,
        "ok"
      );
    });

    list.appendChild(node);
  }

  $("#emptyState").classList.toggle("hidden", filtered.length > 0);
  updateCounts();
}

function updateCounts() {
  const total = state.extensions.length;
  const on = state.extensions.filter(e => e.enabled).length;
  $("#counts").textContent = `${on}/${total} on`;
}

// ---------- Bulk actions ----------

async function bulkSet(target) {
  // target: "on" | "off" | "invert"
  if (state.settings.confirmBulk) {
    const verb = target === "on" ? "enable" : target === "off" ? "disable" : "invert";
    const ok = await modalConfirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} all extensions?`);
    if (!ok) return;
  }

  // Snapshot pre-bulk state so Undo can restore it. Shared key with background worker.
  // Locked extensions are excluded from the snapshot so Undo never touches them either.
  const snapshot = {};
  for (const ext of state.extensions) {
    if (state.locked.has(ext.id)) continue;
    snapshot[ext.id] = !!ext.enabled;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_BULK_SNAPSHOT]: snapshot });

  const ops = [];
  let skippedLocked = 0;
  for (const ext of state.extensions) {
    if (state.locked.has(ext.id)) { skippedLocked++; continue; }

    let want;
    if (target === "on") want = true;
    else if (target === "off") want = false;
    else want = !ext.enabled;

    if (ext.enabled === want) continue;
    if (!ext.mayDisable && !want) continue;
    ops.push(setEnabled(ext, want, { skipRecent: true }).catch(err => console.warn("bulk skip", ext.id, err)));
  }
  await Promise.all(ops);
  renderList();
  const lockedNote = skippedLocked ? ` (${skippedLocked} locked)` : "";
  setStatus(`Bulk action complete${lockedNote}`, "ok", { label: "Undo", onClick: undoLastBulk });
}

async function undoLastBulk() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_BULK_SNAPSHOT);
  const snap = data[STORAGE_KEYS.LAST_BULK_SNAPSHOT];
  if (!snap || typeof snap !== "object") {
    setStatus("Nothing to undo.", "error");
    return;
  }
  const ops = [];
  for (const ext of state.extensions) {
    if (!(ext.id in snap)) continue;
    if (state.locked.has(ext.id)) continue; // safety: a lock added after the snapshot still wins
    const want = !!snap[ext.id];
    if (ext.enabled === want) continue;
    if (!ext.mayDisable && !want) continue;
    ops.push(setEnabled(ext, want, { skipRecent: true }).catch(err => console.warn("undo skip", ext.id, err)));
  }
  await Promise.all(ops);
  // Consume the snapshot so a second Undo press doesn't re-toggle.
  await chrome.storage.local.remove(STORAGE_KEYS.LAST_BULK_SNAPSHOT);
  renderList();
  setStatus("Undid bulk action", "ok");
}

// ---------- Profile UI handlers ----------

async function onNewProfile() {
  const raw = await modalPrompt("New profile name:");
  if (raw === null) return;
  const name = raw.trim();
  if (!name) return;
  if (!isSafeProfileName(name)) {
    setStatus("Choose a different profile name.", "error");
    return;
  }
  if (hasProfile(name)) {
    const ok = await modalConfirm(`Profile "${name}" exists. Overwrite?`);
    if (!ok) return;
  }
  await saveCurrentToProfile(name);
  state.activeProfile = name;
  await saveActiveProfile();
  renderProfiles();
  setStatus(`Saved profile "${name}"`, "ok");
}

async function onSaveProfile() {
  const sel = $("#profileSelect");
  const name = sel.value;
  if (!name) {
    setStatus("No profile selected. Click 'New' to create one.", "error");
    return;
  }
  const ok = await modalConfirm(`Overwrite profile "${name}" with current state?`);
  if (!ok) return;
  await saveCurrentToProfile(name);
  state.activeProfile = name;
  await saveActiveProfile();
  setStatus(`Saved "${name}"`, "ok");
}

async function onApplyProfile() {
  const sel = $("#profileSelect");
  const name = sel.value;
  if (!name) return;
  await applyProfile(name);
  await loadExtensions(); // refresh enabled flags from source of truth
  renderList();
  setStatus(`Applied "${name}"`, "ok");
}

async function onDeleteProfile() {
  const sel = $("#profileSelect");
  const name = sel.value;
  if (!name) return;
  const ok = await modalConfirm(`Delete profile "${name}"?`);
  if (!ok) return;
  await deleteProfile(name);
  renderProfiles();
  setStatus(`Deleted "${name}"`, "ok");
}

// ---------- Event wiring ----------

function wire() {
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList();
  });

  $("#sortBy").value = state.sortBy;
  $("#sortBy").addEventListener("change", async (e) => {
    state.sortBy = e.target.value;
    await saveSort();
    renderList();
  });

  $("#enableAll").addEventListener("click", () => bulkSet("on"));
  $("#disableAll").addEventListener("click", () => bulkSet("off"));
  $("#toggleAll").addEventListener("click", () => bulkSet("invert"));

  $("#newProfile").addEventListener("click", onNewProfile);
  $("#saveProfile").addEventListener("click", onSaveProfile);
  $("#applyProfile").addEventListener("click", onApplyProfile);
  $("#deleteProfile").addEventListener("click", onDeleteProfile);

  $("#profileSelect").addEventListener("change", (e) => {
    e.target.title = e.target.value ? `Selected profile: ${e.target.value}` : "Active profile";
  });

  $("#openOptions").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  $("#taskManagerHelp").addEventListener("click", () => {
    modalAlert(TASK_MANAGER_HELP);
  });

  // Live updates if other UI (options page) changes things
  chrome.management.onEnabled.addListener(refreshSoft);
  chrome.management.onDisabled.addListener(refreshSoft);
  chrome.management.onInstalled.addListener(refreshHard);
  chrome.management.onUninstalled.addListener(refreshHard);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let needsRender = false;
    if (changes[STORAGE_KEYS.PINNED]) {
      state.pinned = new Set(changes[STORAGE_KEYS.PINNED].newValue || []);
      needsRender = true;
    }
    if (changes[STORAGE_KEYS.LOCKED]) {
      state.locked = new Set(changes[STORAGE_KEYS.LOCKED].newValue || []);
      needsRender = true;
    }
    if (changes[STORAGE_KEYS.PROFILES]) {
      state.profiles = sanitizeProfiles(changes[STORAGE_KEYS.PROFILES].newValue);
      renderProfiles();
    }
    if (changes[STORAGE_KEYS.ACTIVE_PROFILE]) {
      state.activeProfile = changes[STORAGE_KEYS.ACTIVE_PROFILE].newValue || null;
      renderProfiles();
    }
    if (needsRender) renderList();
  });
}

async function refreshSoft(info) {
  const ext = state.extensions.find(e => e.id === info.id);
  if (ext) {
    ext.enabled = info.enabled;
    renderList();
  } else {
    await loadExtensions();
    renderList();
  }
}

async function refreshHard() {
  await loadExtensions();
  renderList();
}

// ---------- Init ----------

(async function init() {
  try {
    await loadAllStorage();
    await loadExtensions();
    renderProfiles();
    wire();
    renderList();
  } catch (err) {
    console.error(err);
    setStatus("Failed to load: " + (err.message || err), "error");
  }
})();
