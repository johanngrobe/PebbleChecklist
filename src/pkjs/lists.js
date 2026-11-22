// The user's checklists. The phone keeps the directory of lists and the items
// of every local list that isn't open on the watch; the watch only stores the
// list it shows (its persistent storage is too small for more), plus the
// directory so it can show the list picker.
//
// A list is {id, name, type, entity, hidden}:
//   id      1..255 (sent to the watch as a byte)
//   type    'local'    a plain checklist, kept on the watch and phone
//           'cookidoo' the Cookidoo shopping list (at most one)
//           'ha'       a Home Assistant to-do list; entity is its entity id.
//                      Every to-do list in Home Assistant gets one (see
//                      addHomeAssistantLists). A list created on the config
//                      page has no entity until it's created there
//   hidden  not shown on the watch (only in the config page)
//
// Synced lists keep their sync state (see sync.js) under syncKey(id).

// lists the watch can show (MAX_LISTS in lists.h); hidden lists don't count
var MAX_LISTS = 8;
// lists the phone keeps, hidden ones included
var MAX_ALL_LISTS = 32;
// bytes, including the terminating NUL on the watch (LIST_NAME_LENGTH)
var MAX_LIST_NAME_BYTES = 29;
var MAX_ID = 255;

var t = require('./i18n').t;

var STORAGE_KEY = 'lists';
var LOCAL_ITEMS_PREFIX = 'list_items_';
var SYNC_PREFIX = 'list_sync_';

// what the watch calls each type (one character each)
var WATCH_TYPES = { local: 'l', cookidoo: 'c', ha: 'h' };

function syncKey(id) {
  return SYNC_PREFIX + id;
}

function utf8Length(text) {
  return unescape(encodeURIComponent(text)).length;
}

// A list name that fits on the watch, without tabs or line breaks (which
// separate the fields of the directory sent to the watch)
function cleanName(name) {
  var chars = Array.prototype.slice.call(String(name || '').replace(/\s+/g, ' ').trim());
  // keep surrogate pairs together
  var joined = [];
  for (var k = 0; k < chars.length; k++) {
    var code = chars[k].charCodeAt(0);
    if (code >= 0xD800 && code <= 0xDBFF && k + 1 < chars.length) {
      joined.push(chars[k] + chars[k + 1]);
      k++;
    } else {
      joined.push(chars[k]);
    }
  }
  while (joined.length && utf8Length(joined.join('')) > MAX_LIST_NAME_BYTES) joined.pop();
  return joined.join('').trim();
}

// Sets up the directory on first run after the update: the list that was on
// the watch becomes the first (and only) list
function migrate(cookidooLinked) {
  var dir = {
    lists: [{
      id: 1,
      name: cookidooLinked ? t('Shopping list', 'Einkaufsliste') : t('Checklist', 'Checkliste'),
      type: cookidooLinked ? 'cookidoo' : 'local'
    }],
    active: 1
  };
  var oldSync = localStorage.getItem('cookidoo_sync');
  if (oldSync) {
    localStorage.setItem(syncKey(1), oldSync);
    localStorage.removeItem('cookidoo_sync');
  }
  save(dir);
  return dir;
}

// Returns {lists: [...], active: id}
function load(cookidooLinked) {
  var dir = null;
  try { dir = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { /* migrate */ }
  if (!dir || !Array.isArray(dir.lists) || !dir.lists.length) return migrate(cookidooLinked);
  fixVisibility(dir);
  if (localizeDefaultNames(dir)) save(dir);
  return dir;
}

// default names given to new lists, [English, German]
var DEFAULT_NAMES = [['Shopping list', 'Einkaufsliste'], ['Checklist', 'Checkliste'], ['List', 'Liste']];

// Lists that still have a default name get it in the current language, so a
// list created as "Einkaufsliste" becomes "Shopping list" in English and back.
// Home Assistant lists keep the name Home Assistant gives them.
// Returns whether a name changed.
function localizeDefaultNames(dir) {
  var changed = false;
  dir.lists.forEach(function (list) {
    if (list.type === 'ha') return;
    DEFAULT_NAMES.forEach(function (pair) {
      if (list.name !== pair[0] && list.name !== pair[1]) return;
      var name = t(pair[0], pair[1]);
      if (list.name !== name) {
        list.name = name;
        changed = true;
      }
    });
  });
  return changed;
}

function visibleLists(dir) {
  return dir.lists.filter(function (list) { return !list.hidden; });
}

// At least one and at most MAX_LISTS lists are shown on the watch, and the
// watch shows one of them
function fixVisibility(dir) {
  var visible = 0;
  dir.lists.forEach(function (list) {
    if (list.hidden) return;
    if (visible >= MAX_LISTS) list.hidden = true;
    else visible++;
  });
  if (!visible) delete dir.lists[0].hidden;
  var active = find(dir, dir.active);
  if (!active || active.hidden) dir.active = visibleLists(dir)[0].id;
}

// Adds a list for every Home Assistant to-do list that doesn't have one yet
// (hidden once the watch's lists are full), and removes the lists of to-do
// lists that are gone. entities: [{id, name}] from homeassistant.js.
// Returns whether the directory changed (it isn't saved).
function addHomeAssistantLists(dir, entities) {
  var changed = false;
  var exists = {};
  // the ids of removed lists aren't reused right away: the watch may still
  // show one of them
  var removed = [];
  entities.forEach(function (entity) { exists[entity.id] = true; });
  dir.lists = dir.lists.filter(function (list) {
    // (a list without an entity is still being created in Home Assistant)
    if (list.type !== 'ha' || !list.entity || exists[list.entity]) return true;
    forget(list.id);
    removed.push(list);
    if (list.id === dir.active) dir.active = 0;
    changed = true;
    return false;
  });

  // a to-do list with the name of a list that's waiting to be created was
  // created by it (its answer may have been lost): it's left for that list
  var pendingNames = {};
  dir.lists.forEach(function (list) {
    if (list.type === 'ha' && !list.entity) pendingNames[list.name] = true;
  });

  entities.forEach(function (entity) {
    if (pendingNames[cleanName(entity.name)]) return;
    var known = dir.lists.some(function (list) { return list.type === 'ha' && list.entity === entity.id; });
    if (known || dir.lists.length >= MAX_ALL_LISTS) return;
    var id = newId({ lists: dir.lists.concat(removed) });
    if (!id) return;
    forget(id);
    var list = { id: id, name: cleanName(entity.name) || entity.id, type: 'ha', entity: entity.id };
    if (visibleLists(dir).length >= MAX_LISTS) list.hidden = true;
    dir.lists.push(list);
    changed = true;
  });

  if (!dir.lists.length) dir.lists.push({ id: newId(dir) || 1, name: t('Checklist', 'Checkliste'), type: 'local' });
  if (changed) fixVisibility(dir);
  return changed;
}

function save(dir) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dir));
}

function find(dir, id) {
  for (var i = 0; i < dir.lists.length; i++) {
    if (dir.lists[i].id === id) return dir.lists[i];
  }
  return null;
}

// An id no list has (ids of deleted lists are reused only after the others)
function newId(dir) {
  var used = {};
  var highest = 0;
  dir.lists.forEach(function (list) {
    used[list.id] = true;
    highest = Math.max(highest, list.id);
  });
  for (var offset = 1; offset <= MAX_ID; offset++) {
    var id = (highest + offset - 1) % MAX_ID + 1;
    if (!used[id]) return id;
  }
  return 0;
}

function isSynced(list) {
  return !!list && (list.type === 'cookidoo' || list.type === 'ha');
}

function loadLocalItems(id) {
  try {
    var items = JSON.parse(localStorage.getItem(LOCAL_ITEMS_PREFIX + id));
    return Array.isArray(items) ? items : [];
  } catch (e) {
    return [];
  }
}

// Stores a local list's items, without the ids and locks of a synced list
function saveLocalItems(id, items) {
  localStorage.setItem(LOCAL_ITEMS_PREFIX + id, JSON.stringify((items || []).map(function (item) {
    return { n: String(item.n), c: item.c ? 1 : 0 };
  })));
}

// Forgets everything stored for a deleted list
function forget(id) {
  localStorage.removeItem(LOCAL_ITEMS_PREFIX + id);
  localStorage.removeItem(syncKey(id));
}

// The directory as the watch reads it: one line per list it shows,
// "<id>\t<type>\t<name>"
function encodeForWatch(dir) {
  return visibleLists(dir).map(function (list) {
    return list.id + '\t' + (WATCH_TYPES[list.type] || 'l') + '\t' + cleanName(list.name);
  }).join('\n');
}

module.exports = {
  MAX_LISTS: MAX_LISTS,
  MAX_ALL_LISTS: MAX_ALL_LISTS,
  visibleLists: visibleLists,
  fixVisibility: fixVisibility,
  addHomeAssistantLists: addHomeAssistantLists,
  load: load,
  save: save,
  find: find,
  newId: newId,
  isSynced: isSynced,
  syncKey: syncKey,
  cleanName: cleanName,
  loadLocalItems: loadLocalItems,
  saveLocalItems: saveLocalItems,
  forget: forget,
  encodeForWatch: encodeForWatch
};
