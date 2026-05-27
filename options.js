/* ExtManager - options/manager page */
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
  showThemes: false
};

const state = {
  selfId: chrome.runtime.id,
  extensions: [],
  profiles: {},
  activeProfile: null,
  settings: { ...DEFAULT_SETTINGS },
  selectedProfile: null,
  extQuery: "",
  profileExtQuery: "",
  pinned: new Set(),
  locked: new Set()
};

// ---------- Storage ----------
async function loadAll() {
  const data = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  state.profiles = data[STORAGE_KEYS.PROFILES] || {};
  state.activeProfile = data[STORAGE_KEYS.ACTIVE_PROFILE] || null;
  state.settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
  state.pinned = new Set(data[STORAGE_KEYS.PINNED] || []);
  state.locked = new Set(data[STORAGE_KEYS.LOCKED] || []);
}

async function saveProfiles() {
  await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: state.profiles });
}
async function saveActive() {
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_PROFILE]: state.activeProfile });
}
async function saveSettings() {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: state.settings });
}
async function savePinned() {
  await chrome.storage.local.set({ [STORAGE_KEYS.PINNED]: [...state.pinned] });
}
async function saveLocked() {
  await chrome.storage.local.set({ [STORAGE_KEYS.LOCKED]: [...state.locked] });
}

// ---------- Extensions ----------
async function loadExtensions() {
  const all = await chrome.management.getAll();
  state.extensions = all
    .filter(e => e.id !== state.selfId)
    .filter(e => state.settings.showThemes || e.type !== "theme")
    .filter(e => e.type === "extension" || e.type === "theme")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function bestIcon(ext) {
  if (!ext.icons || ext.icons.length === 0) return "";
  const sorted = [...ext.icons].sort((a, b) => a.size - b.size);
  let pick = sorted[0];
  for (const ic of sorted) if (ic.size <= 64) pick = ic;
  return pick.url;
}

async function setEnabled(ext, enabled) {
  if (ext.id === state.selfId) return;
  if (!ext.mayDisable && !enabled) throw new Error("Cannot disable.");
  await chrome.management.setEnabled(ext.id, enabled);
  ext.enabled = enabled;
}

// ---------- DOM helpers ----------
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function toast(msg, kind = "", action = null) {
  const el = $("#toast");
  el.textContent = "";
  el.className = "toast" + (kind ? " " + kind : "");
  el.appendChild(document.createTextNode(msg));
  if (action && action.label && typeof action.onClick === "function") {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      clearTimeout(toast._t);
      el.classList.add("hidden");
      action.onClick();
    });
    el.appendChild(btn);
  }
  clearTimeout(toast._t);
  setTimeout(() => el.classList.remove("hidden"), 0);
  const ttl = action ? 8000 : 2400;
  toast._t = setTimeout(() => el.classList.add("hidden"), ttl);
}

// ---------- Tabs ----------
function wireTabs() {
  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".tab").forEach(b => b.classList.remove("active"));
      $$(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $(`#tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

// ---------- Extensions table ----------
function compareExt(a, b) {
  const aPin = state.pinned.has(a.id);
  const bPin = state.pinned.has(b.id);
  if (aPin !== bPin) return aPin ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function renderExtTable() {
  const tbody = $("#extTableBody");
  tbody.innerHTML = "";
  const q = state.extQuery.trim().toLowerCase();
  const list = state.extensions
    .filter(e =>
      !q || e.name.toLowerCase().includes(q) || (e.description || "").toLowerCase().includes(q)
    )
    .sort(compareExt);

  for (const ext of list) {
    const tr = document.createElement("tr");
    if (!ext.enabled) tr.classList.add("disabled");
    if (state.pinned.has(ext.id)) tr.classList.add("pinned");
    if (state.locked.has(ext.id)) tr.classList.add("locked");

    const pinTd = document.createElement("td");
    pinTd.className = "pin-cell";
    const pinBtn = document.createElement("button");
    pinBtn.className = "pin-btn";
    pinBtn.title = state.pinned.has(ext.id) ? "Unpin" : "Pin to top";
    pinBtn.textContent = state.pinned.has(ext.id) ? "★" : "☆";
    pinBtn.addEventListener("click", async () => {
      if (state.pinned.has(ext.id)) state.pinned.delete(ext.id);
      else state.pinned.add(ext.id);
      await savePinned();
      renderExtTable();
    });
    pinTd.appendChild(pinBtn);

    const lockTd = document.createElement("td");
    lockTd.className = "lock-cell";
    const lockBtn = document.createElement("button");
    lockBtn.className = "lock-btn";
    const isLocked = state.locked.has(ext.id);
    lockBtn.textContent = isLocked ? "🔒" : "🔓";
    lockBtn.title = isLocked
      ? "Unlock — allow bulk Enable/Disable to affect this extension"
      : "Lock — exempt from bulk Enable/Disable";
    lockBtn.addEventListener("click", async () => {
      if (state.locked.has(ext.id)) state.locked.delete(ext.id);
      else state.locked.add(ext.id);
      await saveLocked();
      renderExtTable();
    });
    lockTd.appendChild(lockBtn);

    const iconTd = document.createElement("td");
    const img = document.createElement("img");
    const url = bestIcon(ext);
    if (url) img.src = url;
    img.alt = "";
    iconTd.appendChild(img);

    const nameTd = document.createElement("td");
    nameTd.textContent = ext.name;

    const typeTd = document.createElement("td");
    typeTd.textContent = ext.type;

    const versionTd = document.createElement("td");
    versionTd.textContent = ext.version || "";

    const statusTd = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "status-pill " + (ext.enabled ? "on" : "off");
    pill.textContent = ext.enabled ? "On" : "Off";
    statusTd.appendChild(pill);

    const actionTd = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = ext.enabled ? "Disable" : "Enable";
    if (!ext.mayDisable && ext.enabled) btn.disabled = true;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await setEnabled(ext, !ext.enabled);
        renderExtTable();
        updateExtCount();
      } catch (err) {
        toast(err.message || "Failed", "error");
      } finally {
        btn.disabled = false;
      }
    });
    actionTd.appendChild(btn);

    tr.append(pinTd, lockTd, iconTd, nameTd, typeTd, versionTd, statusTd, actionTd);
    tbody.appendChild(tr);
  }
}

function updateExtCount() {
  const total = state.extensions.length;
  const on = state.extensions.filter(e => e.enabled).length;
  $("#extCount").textContent = `${on}/${total} enabled`;
}

function wireExtensionsTab() {
  $("#extSearch").addEventListener("input", (e) => {
    state.extQuery = e.target.value;
    renderExtTable();
  });
  $("#extEnableAll").addEventListener("click", () => bulkSet(true));
  $("#extDisableAll").addEventListener("click", () => bulkSet(false));
}

async function bulkSet(target) {
  if (state.settings.confirmBulk) {
    if (!confirm(`${target ? "Enable" : "Disable"} all extensions?`)) return;
  }

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
    if (ext.enabled === target) continue;
    if (!ext.mayDisable && !target) continue;
    ops.push(setEnabled(ext, target).catch(e => console.warn("bulk", ext.id, e)));
  }
  await Promise.all(ops);
  renderExtTable();
  updateExtCount();
  const lockedNote = skippedLocked ? ` (${skippedLocked} locked)` : "";
  toast(`Bulk done${lockedNote}`, "ok", { label: "Undo", onClick: undoLastBulk });
}

async function undoLastBulk() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_BULK_SNAPSHOT);
  const snap = data[STORAGE_KEYS.LAST_BULK_SNAPSHOT];
  if (!snap || typeof snap !== "object") {
    toast("Nothing to undo", "error");
    return;
  }
  const ops = [];
  for (const ext of state.extensions) {
    if (!(ext.id in snap)) continue;
    if (state.locked.has(ext.id)) continue; // lock added after the snapshot still wins
    const want = !!snap[ext.id];
    if (ext.enabled === want) continue;
    if (!ext.mayDisable && !want) continue;
    ops.push(setEnabled(ext, want).catch(e => console.warn("undo", ext.id, e)));
  }
  await Promise.all(ops);
  await chrome.storage.local.remove(STORAGE_KEYS.LAST_BULK_SNAPSHOT);
  renderExtTable();
  updateExtCount();
  toast("Undone", "ok");
}

// ---------- Profiles tab ----------

function renderProfileList() {
  const ul = $("#profileList");
  ul.innerHTML = "";
  const names = Object.keys(state.profiles).sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const li = document.createElement("li");
    if (name === state.selectedProfile) li.classList.add("active");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = name + (state.activeProfile === name ? " ●" : "");
    const count = document.createElement("span");
    count.className = "count";
    const enabledCount = Object.values(state.profiles[name]).filter(Boolean).length;
    count.textContent = `${enabledCount} on`;
    li.append(nameSpan, count);
    li.addEventListener("click", () => selectProfile(name));
    ul.appendChild(li);
  }
}

function selectProfile(name) {
  state.selectedProfile = name;
  renderProfileList();
  renderProfileDetail();
}

function renderProfileDetail() {
  const empty = $("#profileDetailEmpty");
  const detail = $("#profileDetail");
  const name = state.selectedProfile;
  if (!name || !state.profiles[name]) {
    empty.classList.remove("hidden");
    detail.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  detail.classList.remove("hidden");

  $("#profileNameInput").value = name;

  const ul = $("#profileExtList");
  ul.innerHTML = "";
  const profile = state.profiles[name];
  const q = state.profileExtQuery.trim().toLowerCase();
  const list = state.extensions.filter(e =>
    !q || e.name.toLowerCase().includes(q)
  );

  for (const ext of list) {
    const li = document.createElement("li");
    const img = document.createElement("img");
    const url = bestIcon(ext);
    if (url) img.src = url;
    img.alt = "";
    const nameDiv = document.createElement("div");
    nameDiv.className = "name";
    nameDiv.textContent = ext.name;

    const label = document.createElement("label");
    label.className = "switch";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "ext-toggle";
    // default: if not in profile, use current ext.enabled
    cb.checked = ext.id in profile ? !!profile[ext.id] : !!ext.enabled;
    cb.addEventListener("change", () => {
      profile[ext.id] = cb.checked;
      saveProfiles().then(() => renderProfileList());
    });
    const span = document.createElement("span");
    span.className = "slider";
    label.append(cb, span);

    li.append(img, nameDiv, label);
    ul.appendChild(li);
  }
}

function wireProfilesTab() {
  $("#newProfileBtn").addEventListener("click", async () => {
    const name = (prompt("Profile name:") || "").trim();
    if (!name) return;
    if (state.profiles[name] && !confirm(`"${name}" exists. Overwrite?`)) return;
    const snap = {};
    for (const ext of state.extensions) snap[ext.id] = !!ext.enabled;
    state.profiles[name] = snap;
    await saveProfiles();
    state.selectedProfile = name;
    renderProfileList();
    renderProfileDetail();
    toast(`Created "${name}"`, "ok");
  });

  $("#applyProfileBtn").addEventListener("click", async () => {
    const name = state.selectedProfile;
    if (!name) return;
    const profile = state.profiles[name];
    const ops = [];
    for (const ext of state.extensions) {
      if (!(ext.id in profile)) continue;
      const want = !!profile[ext.id];
      if (ext.enabled !== want) {
        if (!ext.mayDisable && !want) continue;
        ops.push(setEnabled(ext, want).catch(e => console.warn(ext.id, e)));
      }
    }
    await Promise.all(ops);
    state.activeProfile = name;
    await saveActive();
    await loadExtensions();
    renderProfileList();
    renderProfileDetail();
    renderExtTable();
    updateExtCount();
    toast(`Applied "${name}"`, "ok");
  });

  $("#snapshotProfileBtn").addEventListener("click", async () => {
    const name = state.selectedProfile;
    if (!name) return;
    if (!confirm(`Overwrite "${name}" with current state?`)) return;
    const snap = {};
    for (const ext of state.extensions) snap[ext.id] = !!ext.enabled;
    state.profiles[name] = snap;
    await saveProfiles();
    renderProfileList();
    renderProfileDetail();
    toast("Snapshot saved", "ok");
  });

  $("#duplicateProfileBtn").addEventListener("click", async () => {
    const name = state.selectedProfile;
    if (!name) return;
    let copy = `${name} (copy)`;
    let i = 2;
    while (state.profiles[copy]) copy = `${name} (copy ${i++})`;
    state.profiles[copy] = { ...state.profiles[name] };
    await saveProfiles();
    state.selectedProfile = copy;
    renderProfileList();
    renderProfileDetail();
    toast(`Duplicated as "${copy}"`, "ok");
  });

  $("#deleteProfileBtn").addEventListener("click", async () => {
    const name = state.selectedProfile;
    if (!name) return;
    if (!confirm(`Delete "${name}"?`)) return;
    delete state.profiles[name];
    if (state.activeProfile === name) {
      state.activeProfile = null;
      await saveActive();
    }
    state.selectedProfile = null;
    await saveProfiles();
    renderProfileList();
    renderProfileDetail();
    toast("Deleted", "ok");
  });

  $("#profileNameInput").addEventListener("change", async (e) => {
    const oldName = state.selectedProfile;
    const newName = e.target.value.trim();
    if (!oldName || !newName || newName === oldName) {
      e.target.value = oldName || "";
      return;
    }
    if (state.profiles[newName]) {
      toast("Name already exists", "error");
      e.target.value = oldName;
      return;
    }
    state.profiles[newName] = state.profiles[oldName];
    delete state.profiles[oldName];
    if (state.activeProfile === oldName) {
      state.activeProfile = newName;
      await saveActive();
    }
    state.selectedProfile = newName;
    await saveProfiles();
    renderProfileList();
    renderProfileDetail();
    toast("Renamed", "ok");
  });

  $("#profileExtSearch").addEventListener("input", (e) => {
    state.profileExtQuery = e.target.value;
    renderProfileDetail();
  });

  $("#profileSelectAll").addEventListener("click", async () => {
    const name = state.selectedProfile;
    if (!name) return;
    for (const ext of state.extensions) state.profiles[name][ext.id] = true;
    await saveProfiles();
    renderProfileList();
    renderProfileDetail();
  });

  $("#profileSelectNone").addEventListener("click", async () => {
    const name = state.selectedProfile;
    if (!name) return;
    for (const ext of state.extensions) state.profiles[name][ext.id] = false;
    await saveProfiles();
    renderProfileList();
    renderProfileDetail();
  });

  // Export / Import
  $("#exportBtn").addEventListener("click", () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles: state.profiles,
      // include extension names alongside ids so they're recognizable across installs
      knownExtensions: Object.fromEntries(state.extensions.map(e => [e.id, e.name]))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extmanager-profiles-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.profiles || typeof data.profiles !== "object") {
        throw new Error("Invalid file");
      }
      const merge = confirm("OK = merge with existing profiles. Cancel = replace.");
      if (merge) {
        for (const [name, prof] of Object.entries(data.profiles)) {
          let target = name;
          let i = 2;
          while (state.profiles[target] && JSON.stringify(state.profiles[target]) !== JSON.stringify(prof)) {
            target = `${name} (${i++})`;
          }
          state.profiles[target] = prof;
        }
      } else {
        state.profiles = data.profiles;
      }
      await saveProfiles();
      renderProfileList();
      renderProfileDetail();
      toast("Imported", "ok");
    } catch (err) {
      toast("Import failed: " + err.message, "error");
    } finally {
      e.target.value = "";
    }
  });
}

// ---------- Settings tab ----------
function wireSettingsTab() {
  const cb1 = $("#setConfirmBulk");
  const cb2 = $("#setShowThemes");
  cb1.checked = state.settings.confirmBulk;
  cb2.checked = state.settings.showThemes;

  cb1.addEventListener("change", async () => {
    state.settings.confirmBulk = cb1.checked;
    await saveSettings();
  });
  cb2.addEventListener("change", async () => {
    state.settings.showThemes = cb2.checked;
    await saveSettings();
    await loadExtensions();
    renderExtTable();
    updateExtCount();
    renderProfileDetail();
  });

  $("#resetBtn").addEventListener("click", async () => {
    if (!confirm("Erase all ExtManager profiles and settings? This cannot be undone.")) return;
    await chrome.storage.local.clear();
    state.profiles = {};
    state.activeProfile = null;
    state.selectedProfile = null;
    state.settings = { ...DEFAULT_SETTINGS };
    cb1.checked = state.settings.confirmBulk;
    cb2.checked = state.settings.showThemes;
    renderProfileList();
    renderProfileDetail();
    toast("Reset", "ok");
  });
}

// ---------- Live updates ----------
function wireLive() {
  const refresh = async () => {
    await loadExtensions();
    renderExtTable();
    updateExtCount();
    renderProfileDetail();
  };
  chrome.management.onEnabled.addListener(refresh);
  chrome.management.onDisabled.addListener(refresh);
  chrome.management.onInstalled.addListener(refresh);
  chrome.management.onUninstalled.addListener(refresh);

  // Pinned set may change from the popup while this page is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEYS.PINNED]) {
      state.pinned = new Set(changes[STORAGE_KEYS.PINNED].newValue || []);
      renderExtTable();
    }
    if (changes[STORAGE_KEYS.LOCKED]) {
      state.locked = new Set(changes[STORAGE_KEYS.LOCKED].newValue || []);
      renderExtTable();
    }
    if (changes[STORAGE_KEYS.PROFILES]) {
      state.profiles = changes[STORAGE_KEYS.PROFILES].newValue || {};
      renderProfileList();
      renderProfileDetail();
    }
  });
}

// ---------- Init ----------
(async function init() {
  try {
    await loadAll();
    await loadExtensions();
    wireTabs();
    wireExtensionsTab();
    wireProfilesTab();
    wireSettingsTab();
    wireLive();
    renderExtTable();
    updateExtCount();
    renderProfileList();
    renderProfileDetail();
  } catch (err) {
    console.error(err);
    toast("Init failed: " + (err.message || err), "error");
  }
})();
