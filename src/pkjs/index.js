var configUri = require('./configDataUri');
var cookidoo = require('./cookidoo');
var homeassistant = require('./homeassistant');
var i18n = require('./i18n');
var lists = require('./lists');
var sync = require('./sync');

// AppMessage keys (see src/c/messaging.h)
var KEY_REQUEST_STATE = 1;
var KEY_CURRENT_STATE = 2;
var KEY_ITEM_UPDATES = 3;
var KEY_SETTINGS = 4;
var KEY_TOTAL_ITEMS = 5;
var KEY_SYNC_ENABLED = 6;
var KEY_LIST_VERSION = 7;
var KEY_LISTS = 8;
var KEY_LIST_ID = 9;
var KEY_SWITCH_TO = 10;

// why the watch sends its list (KEY_REQUEST_STATE)
var STATE_REASON_CONFIG = 1;
var STATE_REASON_SYNC = 2;
var STATE_REASON_CHANGED = 3;
var STATE_REASON_SWITCH = 4;

// how often to fetch the open list while the app is open on the watch
var SYNC_INTERVAL_MS = 2 * 60 * 1000;
// how long to wait for the watch to send its list for a sync
var STATE_TIMEOUT_MS = 10000;
// how long the config page waits for the watch's list before opening without
// it (e.g. when the app isn't open on the watch)
var CONFIG_STATE_TIMEOUT_MS = 4000;

var LAST_SETTINGS_KEY = 'last_settings';

// what the config page was opened with ({lists: {id: {version, names}}}), to
// tell what was changed on it
var configOpenedWith = null;

function directory() {
  return lists.load(!!cookidoo.loadAccount());
}

// The sync provider for a list (see sync.js), or null for local lists and
// synced lists whose account isn't connected
function providerFor(list) {
  if (!list) return null;
  if (list.type === 'cookidoo') return cookidoo.provider();
  if (list.type === 'ha') return homeassistant.provider(list.entity);
  return null;
}

// A Home Assistant list made on the config page that isn't created in Home
// Assistant yet (no entity): its items are kept like a local list's until then
function isPendingHa(list) {
  return !!list && list.type === 'ha' && !list.entity;
}

// Lists whose items are kept here (and on the watch) rather than online
function storedLocally(list) {
  return list.type === 'local' || isPendingHa(list);
}

function parseList(json) {
  try {
    var list = JSON.parse(json);
    return Array.isArray(list) ? list : null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sending to the watch, one message at a time

var outbox = [];
var sending = false;

function send(dict, callback) {
  outbox.push({ dict: dict, callback: callback });
  if (!sending) sendNext();
}

function sendNext() {
  var entry = outbox.shift();
  if (!entry) {
    sending = false;
    return;
  }
  sending = true;
  Pebble.sendAppMessage(entry.dict, function () {
    if (entry.callback) entry.callback(null);
    sendNext();
  }, function () {
    console.log('Failed to send message to the watch');
    if (entry.callback) entry.callback(new Error('send failed'));
    sendNext();
  });
}

// Sends a list's items to the watch. The watch ignores items for a list it
// doesn't show, unless switchTo is set, which makes it show this list.
function sendList(list, items, version, switchTo, callback) {
  var dict = {};
  dict[KEY_ITEM_UPDATES] = JSON.stringify(items);
  dict[KEY_LIST_VERSION] = version || 0;
  dict[KEY_LIST_ID] = list.id;
  // the watch only reports its changes for synced lists
  dict[KEY_SYNC_ENABLED] = providerFor(list) ? 1 : 0;
  if (switchTo) dict[KEY_SWITCH_TO] = list.id;
  send(dict, callback);
}

function sendDirectory(extra) {
  var dict = extra || {};
  dict[KEY_LISTS] = lists.encodeForWatch(directory());
  send(dict);
}

// ---------------------------------------------------------------------------
// Jobs that touch the lists run one at a time, so changes are uploaded in
// order and a switch never overtakes an upload.

var jobs = [];
var jobRunning = false;
// a sync waiting for the watch to send its list
var pendingStateRequest = null;

function queueJob(job) {
  jobs.push(job);
  if (!jobRunning) runNextJob();
}

function runNextJob() {
  var job = jobs.shift();
  if (!job) {
    jobRunning = false;
    return;
  }
  jobRunning = true;
  job(runNextJob);
}

function runSync(list, items, version, originalNames, callback) {
  var provider = providerFor(list);
  if (!provider) return callback(new Error(i18n.t('Not connected', 'Nicht verbunden')));
  sync.sync(provider, lists.syncKey(list.id), items, version, originalNames, callback);
}

// Syncs a list with its online list and, if the watch shows it, sends the
// result to the watch.
//   items: the local items to upload changes from, or null to only fetch
//   options.originalNames: see sync.planChanges
//   options.fromConfigPage: on failure, put the items on the watch as they
//     are (with their ids), so the next sync uploads them
//   options.onDone(err, result)
function queueSync(listId, items, version, options) {
  options = options || {};
  queueJob(function (done) {
    var list = lists.find(directory(), listId);
    if (!list || !providerFor(list)) {
      if (options.onDone) options.onDone(new Error(i18n.t('Not connected', 'Nicht verbunden')));
      return done();
    }
    runSync(list, items, version, options.originalNames, function (err, result) {
      if (options.onDone) options.onDone(err, result);
      if (directory().active !== listId) return done();
      if (err && options.fromConfigPage && items) return sendList(list, items, version, false, done);
      if (err || !result || result.unchanged) return done();
      sendList(list, result.list, result.version, false, done);
    });
  });
}

// Fetches the watch's list and syncs it
function requestSync() {
  if (pendingStateRequest || jobs.length) return;
  if (!providerFor(lists.find(directory(), directory().active))) return;

  pendingStateRequest = setTimeout(function () {
    pendingStateRequest = null;
    console.log('The watch did not send its list; skipping sync');
  }, STATE_TIMEOUT_MS);

  var dict = {};
  dict[KEY_REQUEST_STATE] = STATE_REASON_SYNC;
  send(dict, function (err) {
    if (err && pendingStateRequest) {
      clearTimeout(pendingStateRequest);
      pendingStateRequest = null;
    }
  });
}

// Stores (local lists) or uploads (synced lists) the list the watch showed
// before switching away from it. current: {listId, items, version, complete}
function saveWatchList(current, callback) {
  var list = current && lists.find(directory(), current.listId);
  if (!list || !current.items) return callback();
  if (storedLocally(list)) {
    // a list the watch had to cut short is still better than the old copy
    lists.saveLocalItems(list.id, current.items);
    return callback();
  }
  // a list that was cut short can't tell deletions from items that didn't
  // fit, so only new items are uploaded then (see sync.sync)
  runSync(list, current.complete ? current.items : null, current.version, null, function () {
    callback();
  });
}

// Calls back with ({list, version}) to send to the watch for a list: its
// stored items, or the online list (the last one fetched if it can't be
// reached)
function loadListForWatch(list, callback) {
  if (storedLocally(list)) {
    return callback({ list: lists.loadLocalItems(list.id), version: 0 });
  }
  runSync(list, null, 0, null, function (err, result) {
    callback(err || !result ? sync.cachedList(lists.syncKey(list.id)) : result);
  });
}

// Makes the watch show another list, after saving the one it showed
function switchWatchTo(targetId, current) {
  queueJob(function (done) {
    saveWatchList(current, function () {
      var dir = directory();
      var target = lists.find(dir, targetId) || dir.lists[0];
      loadListForWatch(target, function (loaded) {
        dir = directory();
        dir.active = target.id;
        lists.save(dir);
        sendList(target, loaded.list, loaded.version, true, done);
      });
    });
  });
}

// Asks the watch to switch lists. It replies with its current list
// (STATE_REASON_SWITCH), like when the list is picked on the watch, so its
// changes are saved first.
function requestSwitch(targetId) {
  var dict = {};
  dict[KEY_REQUEST_STATE] = STATE_REASON_SWITCH;
  dict[KEY_SWITCH_TO] = targetId;
  send(dict);
}

// ---------------------------------------------------------------------------

// Gives every Home Assistant to-do list a list (see lists.addHomeAssistantLists)
// and tells the watch if that changed its lists. Runs inside a job.
function applyHomeAssistantEntities(entities) {
  var dir = directory();
  var watchList = dir.active;
  if (!lists.addHomeAssistantLists(dir, entities)) return;
  lists.save(dir);
  sendDirectory();
  // the watch's list is gone from Home Assistant
  if (dir.active !== watchList) requestSwitch(dir.active);
}

// Creates the pending Home Assistant lists (see isPendingHa) there. Lists
// wait while Home Assistant can't be reached (e.g. away from the home
// network) and are tried again later; if Home Assistant refuses (e.g. the
// token isn't an administrator's), the list becomes a local list.
var creatingHa = {};

function createPendingHaLists() {
  if (!homeassistant.loadConnection()) return;
  directory().lists.forEach(function (list) {
    if (!isPendingHa(list) || creatingHa[list.id]) return;
    creatingHa[list.id] = true;
    queueHomeAssistantCreate(list.id);
  });
}

function queueHomeAssistantCreate(listId) {
  queueJob(function (done) {
    var connection = homeassistant.loadConnection();
    var list = lists.find(directory(), listId);

    function end() {
      delete creatingHa[listId];
      done();
    }

    function keepLocal(err) {
      console.log('Could not create "' + list.name + '" in Home Assistant: ' + err);
      var dir = directory();
      var current = lists.find(dir, listId);
      if (current && isPendingHa(current)) {
        current.type = 'local';
        lists.save(dir);
        sendDirectory();
      }
      end();
    }

    function created(entity) {
      var dir = directory();
      var current = lists.find(dir, listId);
      if (!isPendingHa(current)) return end();
      var items = lists.loadLocalItems(listId);
      current.entity = entity;
      lists.save(dir);
      lists.forget(listId);
      var onWatch = dir.active === listId;
      end();
      if (onWatch) {
        // the watch may have changed the list since it was stored here, so
        // its own items are uploaded (now, or the next time it's connected)
        requestSync();
      } else {
        queueSync(listId, items.length ? items : null, 0);
      }
    }

    if (!connection || !isPendingHa(list)) return end();
    homeassistant.getTodoEntities(connection, function (err, entities) {
      if (err) {
        console.log('Home Assistant not reachable; "' + list.name + '" is created later: ' + err);
        return end();
      }
      // created before, but the answer didn't come back: use that one
      var used = {};
      directory().lists.forEach(function (l) { if (l.entity) used[l.entity] = true; });
      var same = entities.filter(function (entity) {
        return !used[entity.id] && lists.cleanName(entity.name) === list.name;
      })[0];
      if (same) return created(same.id);

      var existing = entities.map(function (entity) { return entity.id; });
      homeassistant.createTodoList(connection, list.name, existing, function (err, entity) {
        if (err && err.unreachable) {
          console.log('Home Assistant not reachable; "' + list.name + '" is created later: ' + err);
          return end();
        }
        if (err) return keepLocal(err);
        created(entity);
      });
    });
  });
}

function queueHomeAssistantRefresh() {
  var connection = homeassistant.loadConnection();
  if (!connection) return;
  queueJob(function (done) {
    homeassistant.getTodoEntities(connection, function (err, entities) {
      if (!err) applyHomeAssistantEntities(entities);
      done();
    });
  });
}

Pebble.addEventListener('ready', function () {
  console.log('JS component loaded!');
  sendDirectory();
  queueHomeAssistantRefresh();
  createPendingHaLists();
  requestSync();
  setInterval(function () {
    requestSync();
    createPendingHaLists();
  }, SYNC_INTERVAL_MS);
});

Pebble.addEventListener('appmessage', function (e) {
  var payload = e.payload;

  if (payload[KEY_CURRENT_STATE] === undefined) return;

  var reason = payload[KEY_REQUEST_STATE];
  var version = payload[KEY_LIST_VERSION] || 0;
  var items = parseList(payload[KEY_CURRENT_STATE]);
  // a list the watch had to cut short can't tell deletions from items that
  // didn't fit, so it isn't merged
  var complete = !!items && payload[KEY_TOTAL_ITEMS] === items.length;

  if (typeof payload[KEY_SETTINGS] === 'number') {
    localStorage.setItem(LAST_SETTINGS_KEY, String(payload[KEY_SETTINGS]));
  }

  // the watch knows best which list it shows
  var dir = directory();
  var listId = typeof payload[KEY_LIST_ID] === 'number' ? payload[KEY_LIST_ID] : dir.active;
  var list = lists.find(dir, listId);
  if (list && dir.active !== listId) {
    dir.active = listId;
    lists.save(dir);
  }

  if (reason === STATE_REASON_SWITCH) {
    switchWatchTo(payload[KEY_SWITCH_TO], {
      listId: listId, items: items, version: version, complete: complete
    });
    return;
  }

  if (!list && reason !== STATE_REASON_CONFIG) {
    // the list was deleted on the phone: show the first one instead
    switchWatchTo(dir.lists[0].id, null);
    return;
  }

  if (reason === STATE_REASON_SYNC || reason === STATE_REASON_CHANGED) {
    if (reason === STATE_REASON_SYNC && pendingStateRequest) {
      clearTimeout(pendingStateRequest);
      pendingStateRequest = null;
    }
    if (storedLocally(list)) {
      if (items) lists.saveLocalItems(list.id, items);
      return;
    }
    queueSync(listId, complete ? items : null, version);
    return;
  }

  // a reply that comes after the page was opened without it is ignored
  openConfig(payload);
});

// ---------------------------------------------------------------------------
// Config page

// the config page waiting for the watch's list
var pendingConfig = null;

Pebble.addEventListener('showConfiguration', function () {
  console.log('Requesting current state from watch');
  if (pendingConfig) clearTimeout(pendingConfig.timer);
  pendingConfig = {
    timer: setTimeout(function () { openConfig(null); }, CONFIG_STATE_TIMEOUT_MS)
  };
  var dict = {};
  dict[KEY_REQUEST_STATE] = STATE_REASON_CONFIG;
  send(dict, function (err) {
    if (err) openConfig(null);
  });
});

function getLastSettings() {
  var settings = parseInt(localStorage.getItem(LAST_SETTINGS_KEY), 10);
  return isNaN(settings) ? undefined : settings;
}

// What the config page shows about the Cookidoo account
function getCookidooInfo() {
  var account = cookidoo.loadAccount();
  if (!account) return { linked: false };
  return { linked: true, email: account.email, host: account.host, language: account.language };
}

// Calls back with what the config page shows about Home Assistant, including
// its to-do lists to pick from
function getHomeAssistantInfo(callback) {
  var connection = homeassistant.loadConnection();
  if (!connection) return callback({ linked: false });
  homeassistant.getTodoEntities(connection, function (err, entities) {
    callback({
      linked: true,
      url: connection.url,
      entities: entities || [],
      error: err ? String(err) : null,
      authFailed: !!(err && err.authFailed)
    });
  });
}

// Opens the config page with every list: the watch's list as the watch sent
// it (payload, if it answered), local lists as stored, and synced lists as
// they're online. The watch's list is synced first, so its changes aren't lost.
function openConfig(payload) {
  if (!pendingConfig) return;
  clearTimeout(pendingConfig.timer);
  pendingConfig = null;

  var watchItems = payload ? parseList(payload[KEY_CURRENT_STATE]) : null;
  var watchVersion = payload ? payload[KEY_LIST_VERSION] || 0 : 0;
  var watchTotal = payload ? payload[KEY_TOTAL_ITEMS] : undefined;
  var watchComplete = !!watchItems && watchTotal === watchItems.length;
  var settings = payload ? payload[KEY_SETTINGS] : getLastSettings();

  queueJob(function (done) {
    getHomeAssistantInfo(function (haInfo) {
      // lists for to-do lists added in Home Assistant show up right away
      if (haInfo.linked && !haInfo.error) applyHomeAssistantEntities(haInfo.entities);
      openConfigWithLists(payload, haInfo, watchItems, watchVersion, watchTotal, watchComplete, settings, done);
    });
  });
}

function openConfigWithLists(payload, haInfo, watchItems, watchVersion, watchTotal, watchComplete, settings, done) {
  var dir = directory();
  var watchListId = payload && typeof payload[KEY_LIST_ID] === 'number'
    ? payload[KEY_LIST_ID] : dir.active;
  var pages = [];
  var opened = {};
  var index = 0;

  function next() {
    if (index >= dir.lists.length) return finish();
    var list = dir.lists[index++];
    var isWatchList = list.id === watchListId && !!watchItems;
    var entry = { id: list.id, name: list.name, type: list.type, entity: list.entity, hidden: !!list.hidden };
    pages.push(entry);

    if (!providerFor(list)) {
      if (isWatchList) {
        entry.items = watchItems;
        entry.total = watchTotal;
        if (storedLocally(list)) lists.saveLocalItems(list.id, watchItems);
      } else if (storedLocally(list)) {
        entry.items = lists.loadLocalItems(list.id);
      } else {
        entry.items = sync.cachedList(lists.syncKey(list.id)).list;
      }
      return next();
    }

    var key = lists.syncKey(list.id);
    var items = isWatchList && watchComplete ? watchItems : null;
    var version = isWatchList ? watchVersion : sync.currentVersion(key);
    runSync(list, items, version, null, function (err, result) {
      if (!err && result) {
        entry.items = result.list;
        entry.total = result.total;
        version = result.version;
        // the watch gets the merged list too
        if (isWatchList && !result.unchanged) sendList(list, result.list, result.version, false);
      } else if (isWatchList) {
        // show what the watch has, and the error
        entry.items = watchItems;
        entry.total = watchTotal;
      } else {
        var cached = sync.cachedList(key);
        entry.items = cached.list;
        version = cached.version;
      }
      entry.status = sync.getStatus(key);

      // remember the names shown, so renames can be told apart from the
      // watch's own changes to names (like capitalization)
      var names = {};
      entry.items.forEach(function (item) {
        if (item.i) names[item.i] = item.n;
      });
      opened[list.id] = { version: version, names: names };
      next();
    });
  }

  function finish() {
    configOpenedWith = { lists: opened };
    openConfigPage(pages, watchListId, settings, haInfo);
    done();
  }

  next();
}

function encodeForPage(value) {
  return encodeURIComponent(JSON.stringify(value)).replace(/'/g, '%27');
}

function openConfigPage(pages, activeId, settings, haInfo) {
  var url = configUri;
  url = url.replace('__LISTS__', encodeForPage(pages));
  url = url.replace('__ACTIVE_LIST__', String(activeId));
  // 7 = show voice button + move checked to bottom + wrap-around scrolling (the watchapp defaults)
  url = url.replace('__CURRENT_SETTINGS__', String(typeof settings === 'number' ? settings : 7));
  url = url.replace('__COOKIDOO__', encodeForPage(getCookidooInfo()));
  url = url.replace('__HOME_ASSISTANT__', encodeForPage(haInfo));
  url = url.replace('__LANGUAGE__', i18n.language());
  Pebble.openURL(url);
}

function parseResponse(response) {
  if (!response) return null;
  // Unreasonable amount of checks to handle the myriad ways that URL encoded
  // strings can get mangled
  var attempts = [
    function () { return JSON.parse(response); },
    function () { return JSON.parse(decodeURIComponent(response)); },
    function () { return JSON.parse(decodeURIComponent(decodeURIComponent(response))); }
  ];
  for (var i = 0; i < attempts.length; i++) {
    try { return attempts[i](); } catch (e) { /* try the next one */ }
  }
  console.log('Failed to parse response data');
  return null;
}

// Strips the ids and locks a synced list's items carry
function plainItems(items) {
  return (items || []).map(function (item) { return { n: item.n, c: item.c ? 1 : 0 }; });
}

Pebble.addEventListener('webviewclosed', function (e) {
  var data = parseResponse(e.response);
  if (!data) return console.log('No settings changed');

  var opened = (configOpenedWith && configOpenedWith.lists) || {};
  configOpenedWith = null;

  // accounts
  var cookidooLinkedNow = false;
  var link = data.cookidoo;
  if (link && link.action === 'link' && link.refreshToken) {
    cookidoo.saveAccount({
      email: link.email,
      host: link.host,
      language: link.language,
      country: link.country,
      accessToken: link.accessToken,
      refreshToken: link.refreshToken,
      expiresAt: link.expiresAt
    });
    cookidooLinkedNow = true;
  } else if (link && link.action === 'unlink') {
    cookidoo.saveAccount(null);
  }

  var haLinkedNow = false;
  var ha = data.homeAssistant;
  if (ha && ha.action === 'link' && ha.url && ha.token) {
    homeassistant.saveConnection({ url: homeassistant.normalizeUrl(ha.url), token: ha.token });
    haLinkedNow = true;
  } else if (ha && ha.action === 'unlink') {
    homeassistant.saveConnection(null);
  }

  var cookidooLinked = !!cookidoo.loadAccount();
  var haLinked = !!homeassistant.loadConnection();

  // the new directory, from the page's lists
  var oldDir = directory();
  var dir = { lists: [], active: oldDir.active };
  // lists that need a first fetch, and page entries by list id
  var fresh = {};
  var entries = {};
  var tempIds = {};

  (Array.isArray(data.lists) ? data.lists : oldDir.lists).forEach(function (entry) {
    if (dir.lists.length >= lists.MAX_ALL_LISTS) return;
    var existing = typeof entry.id === 'number' ? lists.find(oldDir, entry.id) : null;
    var list = existing
      ? { id: existing.id, type: existing.type, entity: existing.entity }
      : { id: lists.newId({ lists: oldDir.lists.concat(dir.lists) }), type: entry.type, entity: entry.entity };
    if (!list.id) return;
    list.name = lists.cleanName(entry.name) || i18n.t('List', 'Liste');
    if (entry.hidden) list.hidden = true;

    // a list whose account was disconnected keeps its items as a local list
    if (list.type === 'cookidoo' && !cookidooLinked) list.type = 'local';
    // a Home Assistant list without an entity (new on the page) is created
    // there after saving; until then it's pending (see isPendingHa)
    if (list.type === 'ha' && !haLinked) list.type = 'local';
    if (list.type !== 'cookidoo' && list.type !== 'ha') list.type = 'local';
    if (list.type !== 'ha') delete list.entity;
    // there's only one Cookidoo shopping list
    if (list.type === 'cookidoo' && dir.lists.some(function (l) { return l.type === 'cookidoo'; })) {
      list.type = 'local';
    }

    if (existing && existing.type !== list.type) {
      // converted to a local list: start from what it showed
      lists.forget(list.id);
      if (!entry.items) entry.items = sync.cachedList(lists.syncKey(existing.id)).list;
    }
    if (!existing || (list.type === 'cookidoo' && cookidooLinkedNow) ||
      (list.type === 'ha' && haLinkedNow)) {
      fresh[list.id] = true;
    }
    if (!existing) tempIds[entry.id] = list.id;

    dir.lists.push(list);
    entries[list.id] = entry;
  });

  // signing in to Cookidoo adds the shopping list, and shows it on the watch
  var activate = typeof data.activate === 'number' ? data.activate : tempIds[data.activate];
  if (cookidooLinkedNow && !dir.lists.some(function (l) { return l.type === 'cookidoo'; }) &&
    dir.lists.length < lists.MAX_ALL_LISTS && lists.visibleLists(dir).length < lists.MAX_LISTS) {
    var shopping = { id: lists.newId({ lists: oldDir.lists.concat(dir.lists) }), name: i18n.t('Shopping list', 'Einkaufsliste'), type: 'cookidoo' };
    dir.lists.push(shopping);
    fresh[shopping.id] = true;
    entries[shopping.id] = {};
    activate = shopping.id;
  }

  if (!dir.lists.length) dir.lists.push({ id: oldDir.lists[0].id, name: i18n.t('Checklist', 'Checkliste'), type: 'local' });

  oldDir.lists.forEach(function (list) {
    if (!lists.find(dir, list.id)) lists.forget(list.id);
  });

  // the watch's list was deleted or hidden: show the first one it can show
  // (dir.active stays the watch's list until the watch switches)
  var watchActive = dir.active;
  lists.fixVisibility(dir);
  if (dir.active !== watchActive) activate = activate || dir.active;
  dir.active = watchActive;
  var target = activate && lists.find(dir, activate);
  if (target && target.hidden) activate = null;
  lists.save(dir);

  var dict = {};
  if (typeof data.settings === 'number') dict[KEY_SETTINGS] = data.settings;
  sendDirectory(dict);

  // the lists' items
  dir.lists.forEach(function (list) {
    var entry = entries[list.id] || {};
    var isWatchList = list.id === dir.active;

    if (storedLocally(list)) {
      if (!entry.items) return;
      var items = plainItems(entry.items);
      lists.saveLocalItems(list.id, items);
      if (isWatchList) sendList(list, items, 0, false);
      return;
    }

    if (fresh[list.id]) {
      // a new list or account: start over with what's online (ids from an
      // earlier account mean nothing now), plus the items added on the page
      sync.clear(lists.syncKey(list.id));
      var added = (entry.items || []).filter(function (item) { return !item.i; });
      queueSync(list.id, added.length ? plainItems(added) : null, 0);
      return;
    }

    if (!entry.items) return;
    var before = opened[list.id] || { version: 0, names: {} };
    queueSync(list.id, entry.items, before.version, {
      originalNames: before.names,
      fromConfigPage: true
    });
  });

  // (dir.active is still the watch's list here, even if it was deleted)
  if (activate && activate !== dir.active && lists.find(dir, activate)) {
    requestSwitch(activate);
  }

  // lists for the to-do lists of a Home Assistant that was just connected,
  // and new lists to create there
  if (haLinked) {
    queueHomeAssistantRefresh();
    createPendingHaLists();
  }
});
