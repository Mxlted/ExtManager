/* ExtManager - background service worker
 * Handles keyboard commands, badge updates, and last-state memory for toggle-all.
 */
"use strict";

const STORAGE_KEYS = {
  LAST_BULK_SNAPSHOT: "lastBulkSnapshot",
  LOCKED: "locked"
};

const SELF_ID = chrome.runtime.id;

async function listManageable() {
  const all = await chrome.management.getAll();
  return all.filter(e =>
    e.id !== SELF_ID &&
    (e.type === "extension" || e.type === "theme")
  );
}

async function getLockedSet() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LOCKED);
  const arr = Array.isArray(data[STORAGE_KEYS.LOCKED]) ? data[STORAGE_KEYS.LOCKED] : [];
  return new Set(arr);
}

async function setAll(enabled) {
  const [exts, locked] = await Promise.all([listManageable(), getLockedSet()]);
  const ops = [];
  for (const ext of exts) {
    if (locked.has(ext.id)) continue;
    if (ext.enabled === enabled) continue;
    if (!ext.mayDisable && !enabled) continue;
    ops.push(
      chrome.management.setEnabled(ext.id, enabled)
        .catch(err => console.warn("setAll skip", ext.id, err))
    );
  }
  await Promise.all(ops);
  await updateBadge();
}

async function toggleAll() {
  const [exts, locked] = await Promise.all([listManageable(), getLockedSet()]);
  const anyEnabled = exts.some(e => !locked.has(e.id) && e.enabled && e.mayDisable);

  if (anyEnabled) {
    // disabling all — snapshot current (non-locked) state so we can restore later
    const snapshot = {};
    for (const e of exts) {
      if (locked.has(e.id)) continue;
      snapshot[e.id] = !!e.enabled;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_BULK_SNAPSHOT]: snapshot });
    await setAll(false);
    notify("All extensions disabled", "Use the shortcut again to restore.");
  } else {
    // restore from snapshot if present, otherwise enable all
    const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_BULK_SNAPSHOT);
    const snap = data[STORAGE_KEYS.LAST_BULK_SNAPSHOT];
    if (snap && typeof snap === "object") {
      const ops = [];
      for (const ext of exts) {
        if (locked.has(ext.id)) continue;
        if (!(ext.id in snap)) continue;
        const want = !!snap[ext.id];
        if (ext.enabled === want) continue;
        if (!ext.mayDisable && !want) continue;
        ops.push(
          chrome.management.setEnabled(ext.id, want)
            .catch(err => console.warn(ext.id, err))
        );
      }
      await Promise.all(ops);
      notify("Extensions restored", "Previous state has been recovered.");
    } else {
      await setAll(true);
      notify("All extensions enabled", "");
    }
    await updateBadge();
  }
}

function notify(title, message) {
  // Notifications are nice-to-have; silently skip on failure.
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message: message || ""
    });
  } catch (e) { /* no-op */ }
}

async function updateBadge() {
  try {
    const exts = await listManageable();
    const onCount = exts.filter(e => e.enabled).length;
    const total = exts.length;
    if (total === 0) {
      await chrome.action.setBadgeText({ text: "" });
      return;
    }
    await chrome.action.setBadgeBackgroundColor({ color: onCount === 0 ? "#e0524a" : "#4f8cff" });
    await chrome.action.setBadgeText({ text: String(onCount) });
    await chrome.action.setTitle({ title: `ExtManager — ${onCount}/${total} extensions on` });
  } catch (e) {
    console.warn("badge update failed", e);
  }
}

// ---------- Listeners ----------

chrome.commands.onCommand.addListener(async (cmd) => {
  try {
    if (cmd === "toggle-all") await toggleAll();
    else if (cmd === "enable-all") { await setAll(true); notify("All extensions enabled", ""); }
    else if (cmd === "disable-all") {
      const [exts, locked] = await Promise.all([listManageable(), getLockedSet()]);
      const snapshot = {};
      for (const e of exts) {
        if (locked.has(e.id)) continue;
        snapshot[e.id] = !!e.enabled;
      }
      await chrome.storage.local.set({ [STORAGE_KEYS.LAST_BULK_SNAPSHOT]: snapshot });
      await setAll(false);
      notify("All extensions disabled", "");
    }
  } catch (err) {
    console.error("Command failed", cmd, err);
  }
});

chrome.management.onEnabled.addListener(updateBadge);
chrome.management.onDisabled.addListener(updateBadge);
chrome.management.onInstalled.addListener(updateBadge);
chrome.management.onUninstalled.addListener(updateBadge);

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

// Initial badge paint when service worker spins up
updateBadge();
