// Two-way sync between the watch's checklist and an online list (a Cookidoo
// shopping list or a Home Assistant to-do list). Each synced list has its own
// state, stored under its own key (see lists.js).
//
// Every list sent to the watch gets a version number, and each item in it a
// remote id ("i", 1-based) pointing into a snapshot ("base") of that list,
// which is kept here: [{id, t: 'i'|'a', n, c}]. The watch keeps the ids with
// its items and echoes them, along with the version, whenever it sends its
// list back. Comparing that list with the base of the same version shows what
// was changed on the watch (or on the config page) since:
//   - an item whose checked state differs was checked/unchecked
//   - an item without an id was added
//   - a base item that's missing was deleted ("clear completed")
// Those changes are applied to the online list, then the whole list is fetched
// again and sent to the watch as the next version.
//
// Items of type 'i' (Cookidoo recipe ingredients) can only be checked: they're
// sent with "l":1, and the watch and config page don't offer to delete or
// rename them. One that's missing anyway comes back with the next list.
//
// The online list is reached through a provider:
//   getList(callback(err, [{id, type: 'i'|'a', name, owned}]))
//   applyChanges(changes, callback(err))  (changes: see planChanges)

// limits shared with the watchapp (MAX_CHECKLIST_ITEMS, MAX_NAME_LENGTH - 1
// and LIST_JSON_MAX_BYTES in the C code)
var MAX_ITEMS = 52;
var MAX_NAME_BYTES = 89;
var LIST_JSON_MAX_BYTES = 4000;

// how many list versions to remember, for changes the watch reports against
// a list that was replaced in the meantime
var VERSIONS_KEPT = 4;

function loadState(key) {
  var state = null;
  try { state = JSON.parse(localStorage.getItem(key)); } catch (e) { /* reset below */ }
  if (!state || typeof state !== 'object') state = {};
  state.version = state.version || 0;
  state.bases = state.bases || {};
  // ingredients hidden by older versions, which deleted them on the watch
  delete state.hidden;
  return state;
}

function saveState(key, state) {
  localStorage.setItem(key, JSON.stringify(state));
}

// Starts over: the next sync replaces the watch's list with the online list
// instead of uploading the watch's (unsynced) items
function reset(key) {
  saveState(key, { version: 0, bases: {}, firstSync: true });
}

// The version of the last list sent to the watch
function currentVersion(key) {
  return loadState(key).version;
}

function clear(key) {
  localStorage.removeItem(key);
}

// The last list fetched, as the watch shows it ({list, version}), for when the
// online list can't be reached
function cachedList(key) {
  var state = loadState(key);
  var list = null;
  try { list = JSON.parse(state.lastSentJson); } catch (e) { /* none yet */ }
  return { list: Array.isArray(list) ? list : [], version: state.version };
}

// What the config page shows about the sync
function getStatus(key) {
  var state = loadState(key);
  return {
    lastSync: state.lastSync || 0,
    lastError: state.lastError || null,
    authFailed: !!state.authFailed
  };
}

function utf8Length(text) {
  return unescape(encodeURIComponent(text)).length;
}

// Shortens a name to what the watch can store, without splitting a character
function truncateName(text) {
  var chars = [];
  var str = String(text).replace(/\s+/g, ' ').trim();
  // split into code points, keeping surrogate pairs together
  for (var k = 0; k < str.length; k++) {
    var code = str.charCodeAt(k);
    if (code >= 0xD800 && code <= 0xDBFF && k + 1 < str.length) {
      chars.push(str.substr(k, 2));
      k++;
    } else {
      chars.push(str.charAt(k));
    }
  }
  while (chars.length && utf8Length(chars.join('')) > MAX_NAME_BYTES) chars.pop();
  return chars.join('');
}

// Works out what changed in the local list (from the watch or the config page)
// relative to the base it was made from. originalNames (remote id -> name, as
// last shown on the config page) enables detecting renames. Returns
//   owned:   [{id, t, owned}]  checked/unchecked
//   renames: [{id, name}]
//   added:   [{name, owned}]
//   removed: [id]
function planChanges(local, base, originalNames) {
  var changes = { owned: [], renames: [], added: [], removed: [] };
  var seen = {};

  local.forEach(function (item) {
    var name = truncateName(item.n || '');
    var checked = !!item.c;
    var slot = base && item.i ? base[item.i - 1] : null;

    if (!item.i) {
      if (name) changes.added.push({ name: name, owned: checked });
      return;
    }
    // an id that can't be matched (unknown list version) belongs to an item
    // that's already online, so it must not be added again
    if (!slot || seen[item.i]) return;
    seen[item.i] = true;

    if (checked !== !!slot.c) {
      changes.owned.push({ id: slot.id, t: slot.t, owned: checked });
    }
    if (slot.t === 'a' && originalNames && originalNames[item.i] !== undefined &&
      name && name !== truncateName(originalNames[item.i])) {
      changes.renames.push({ id: slot.id, name: name });
    }
  });

  // locked items (recipe ingredients) can't be deleted
  (base || []).forEach(function (slot, index) {
    if (!seen[index + 1] && slot.t === 'a') changes.removed.push(slot.id);
  });

  return changes;
}

function hasChanges(changes) {
  return changes.owned.length || changes.renames.length ||
    changes.added.length || changes.removed.length;
}

// Turns the online list into the list for the watch and its base, leaving
// out whatever doesn't fit on the watch
function buildWatchList(items) {
  var list = [];
  var base = [];
  var jsonBytes = 2; // []
  var total = 0;

  items.forEach(function (item) {
    var name = truncateName(item.name);
    if (!name) return;
    total++;
    if (list.length >= MAX_ITEMS) return;

    var entry = { n: name, c: item.owned ? 1 : 0, i: base.length + 1 };
    if (item.type === 'i') entry.l = 1;
    var bytes = utf8Length(JSON.stringify(entry)) + (list.length ? 1 : 0);
    if (jsonBytes + bytes > LIST_JSON_MAX_BYTES) return;

    jsonBytes += bytes;
    list.push(entry);
    base.push({ id: item.id, t: item.type, n: name, c: entry.c });
  });

  return { list: list, base: base, total: total };
}

// Syncs the local list with the online list.
//   provider: see the top of this file
//   key: where this list's sync state is stored
//   local: the watch's (or config page's) items [{n, c, i}], or null to only
//          fetch the online list
//   version: the list version local's ids refer to
//   originalNames: see planChanges
// Calls back with (err, result), where result.list is the current list (as
// the watch shows it), result.version its version and result.total the number
// of items online. result.unchanged is true if the watch already has this list.
function sync(provider, key, local, version, originalNames, callback) {
  var state = loadState(key);
  var base = state.bases[version];
  var changes = null;

  if (local && !state.firstSync) {
    // ids from an unknown version can't be matched, so only new items
    // (without an id) are uploaded then
    changes = planChanges(local, base || null, originalNames);
    if (!base) {
      changes.owned = [];
      changes.renames = [];
      changes.removed = [];
    }
  }

  var watchOutdated = state.firstSync || version !== state.version || !base;

  function pull() {
    provider.getList(function (err, items) {
      if (err) return finish(err);

      var built = buildWatchList(items);
      var json = JSON.stringify(built.list);
      state = loadState(key);

      if (!watchOutdated && !(changes && hasChanges(changes)) && json === state.lastSentJson) {
        state.lastSync = Date.now();
        state.lastError = null;
        state.authFailed = false;
        saveState(key, state);
        return callback(null, {
          list: built.list, version: state.version, total: built.total, unchanged: true
        });
      }

      state.version = (state.version % 1000000) + 1;
      state.bases[state.version] = built.base;
      Object.keys(state.bases).forEach(function (v) {
        if (parseInt(v, 10) <= state.version - VERSIONS_KEPT) delete state.bases[v];
      });
      state.lastSentJson = json;
      state.firstSync = false;
      state.lastSync = Date.now();
      state.lastError = null;
      state.authFailed = false;
      saveState(key, state);

      if (built.total > built.list.length) {
        console.log(provider.name + ': sent ' + built.list.length + ' of ' + built.total + ' items');
      }
      callback(null, { list: built.list, version: state.version, total: built.total });
    });
  }

  function finish(err) {
    console.log(provider.name + ' sync failed: ' + err);
    var saved = loadState(key);
    saved.lastError = String(err);
    saved.authFailed = !!err.authFailed;
    saveState(key, saved);
    callback(err);
  }

  if (changes && hasChanges(changes)) {
    console.log(provider.name + ': uploading changes ' + JSON.stringify(changes));
    provider.applyChanges(changes, function (err) {
      if (err) return finish(err);
      pull();
    });
  } else {
    pull();
  }
}

module.exports = {
  sync: sync,
  reset: reset,
  clear: clear,
  cachedList: cachedList,
  getStatus: getStatus,
  currentVersion: currentVersion,
  planChanges: planChanges,
  buildWatchList: buildWatchList,
  truncateName: truncateName,
  MAX_ITEMS: MAX_ITEMS,
  LIST_JSON_MAX_BYTES: LIST_JSON_MAX_BYTES
};
