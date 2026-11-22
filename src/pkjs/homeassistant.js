// Home Assistant to-do list client for PebbleKit JS.
//
// Talks to Home Assistant's REST API with a long-lived access token (created
// on the user's profile page in Home Assistant). Any to-do entity works
// (Shopping List, Local To-do, Todoist, ...), through the todo.* services:
//   todo.get_items (with ?return_response, Home Assistant 2024.8 or later),
//   todo.add_item, todo.update_item, todo.remove_item
//
// New lists are created as Local To-do lists, through the config flow API
// (/api/config/config_entries/flow, which needs an administrator's token).
//
// The config page only collects the URL and token: settings pages can't reach
// the local network or undeclared domains, so every request is made here.

var REQUEST_TIMEOUT_MS = 20000;
var t = require('./i18n').t;

var STORAGE_KEY = 'homeassistant';

function loadConnection() {
  try {
    var connection = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return connection && connection.url && connection.token ? connection : null;
  } catch (e) {
    return null;
  }
}

function saveConnection(connection) {
  if (connection) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// "homeassistant.local:8123/" -> "http://homeassistant.local:8123"
function normalizeUrl(url) {
  url = String(url || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
  return url;
}

// An error with an HTTP status, and whether it means the token is no good.
// unreachable: Home Assistant couldn't be reached at all (e.g. it's only on
// the home network), so trying again later may work
function HomeAssistantError(message, status, authFailed, unreachable) {
  this.message = message;
  this.status = status || 0;
  this.authFailed = !!authFailed;
  this.unreachable = !!unreachable;
}
HomeAssistantError.prototype.toString = function () { return this.message; };

function api(connection, method, path, body, callback) {
  var xhr = new XMLHttpRequest();
  var done = false;
  function finish(err, result) {
    if (done) return;
    done = true;
    callback(err, result);
  }
  try {
    xhr.open(method, connection.url + path, true);
    xhr.timeout = REQUEST_TIMEOUT_MS;
    xhr.setRequestHeader('Authorization', 'Bearer ' + connection.token);
    xhr.setRequestHeader('Accept', 'application/json');
    if (body) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      var status = xhr.status;
      if (status === 401 || status === 403) {
        return finish(new HomeAssistantError(
          t('Home Assistant rejected the access token. Please enter a new one.',
            'Home Assistant hat den Zugangstoken abgelehnt. Bitte gib einen neuen ein.'), status, true));
      }
      if (status < 200 || status >= 300) {
        var detail = '';
        try { detail = JSON.parse(xhr.responseText).message || ''; } catch (e) { /* not JSON */ }
        if (!detail && status === 400 && /return_response/.test(path)) {
          detail = t('Home Assistant 2024.8 or later is needed', 'Home Assistant 2024.8 oder neuer wird benötigt');
        }
        return finish(new HomeAssistantError(
          t('Home Assistant request failed', 'Home-Assistant-Anfrage fehlgeschlagen') + ' (' + status + (detail ? ': ' + detail : '') + ')', status));
      }
      var result = null;
      if (xhr.responseText) {
        try { result = JSON.parse(xhr.responseText); } catch (e) {
          return finish(new HomeAssistantError(t('Unexpected response from Home Assistant', 'Unerwartete Antwort von Home Assistant')));
        }
      }
      finish(null, result);
    };
    xhr.onerror = function () {
      finish(new HomeAssistantError(t('Could not reach Home Assistant at ', 'Home Assistant ist nicht erreichbar unter ') + connection.url,
        0, false, true));
    };
    xhr.ontimeout = function () {
      finish(new HomeAssistantError(t('Home Assistant did not respond', 'Home Assistant antwortet nicht'), 0, false, true));
    };
    xhr.send(body ? JSON.stringify(body) : null);
  } catch (e) {
    finish(new HomeAssistantError(t('Request failed: ', 'Anfrage fehlgeschlagen: ') + e.message));
  }
}

function callService(connection, service, data, callback) {
  api(connection, 'POST', '/api/services/todo/' + service, data, callback);
}

// Lists the to-do entities as [{id, name}]
function getTodoEntities(connection, callback) {
  api(connection, 'GET', '/api/states', null, function (err, states) {
    if (err) return callback(err);
    if (!Array.isArray(states)) {
      return callback(new HomeAssistantError(t('Unexpected response from Home Assistant', 'Unerwartete Antwort von Home Assistant')));
    }
    var entities = states.filter(function (state) {
      return state && typeof state.entity_id === 'string' && state.entity_id.indexOf('todo.') === 0;
    }).map(function (state) {
      var name = (state.attributes && state.attributes.friendly_name) || state.entity_id;
      return { id: state.entity_id, name: name };
    });
    entities.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    callback(null, entities);
  });
}

// Fetches a to-do list as [{id, type: 'a', name, owned}] (the sync.js format)
function getItems(connection, entity, callback) {
  callService(connection, 'get_items?return_response', { entity_id: entity }, function (err, result) {
    if (err) return callback(err);
    var response = result && result.service_response && result.service_response[entity];
    if (!response || !Array.isArray(response.items)) {
      return callback(new HomeAssistantError(t('Home Assistant has no to-do list ', 'Home Assistant hat keine To-do-Liste ') + entity));
    }
    callback(null, response.items.map(function (item) {
      return { id: item.uid, type: 'a', name: item.summary || '', owned: item.status === 'completed' };
    }));
  });
}

function status(owned) {
  return owned ? 'completed' : 'needs_action';
}

// Applies the changes planned by sync.planChanges, one request after another
function applyChanges(connection, entity, changes, callback) {
  var steps = [];

  changes.owned.forEach(function (change) {
    steps.push(function (next) {
      callService(connection, 'update_item',
        { entity_id: entity, item: change.id, status: status(change.owned) }, next);
    });
  });
  changes.renames.forEach(function (change) {
    steps.push(function (next) {
      callService(connection, 'update_item',
        { entity_id: entity, item: change.id, rename: change.name }, next);
    });
  });
  if (changes.removed.length) {
    steps.push(function (next) {
      callService(connection, 'remove_item', { entity_id: entity, item: changes.removed }, next);
    });
  }
  changes.added.forEach(function (item) {
    steps.push(function (next) {
      callService(connection, 'add_item', { entity_id: entity, item: item.name }, function (err) {
        if (err || !item.owned) return next(err);
        // add_item doesn't return the new item's uid, but update_item also
        // finds items by name
        callService(connection, 'update_item',
          { entity_id: entity, item: item.name, status: 'completed' }, next);
      });
    });
  });

  (function run(index) {
    if (index >= steps.length) return callback(null);
    steps[index](function (err) {
      if (err) return callback(err);
      run(index + 1);
    });
  })(0);
}

// Creates a to-do list in Home Assistant (with the Local To-do integration)
// and calls back with (err, entity id) once its entity shows up. err.unreachable
// is set if Home Assistant couldn't be reached.
// existing: the to-do entity ids from before, to tell which one is new
function createTodoList(connection, name, existing, callback) {
  function failed(err) {
    if (err && (err.status === 401 || err.status === 403)) {
      err = new HomeAssistantError(t('Home Assistant did not allow creating a to-do list. The access token has to be from an administrator.',
        'Home Assistant hat das Erstellen einer To-do-Liste nicht erlaubt. Der Zugangstoken muss von einem Administrator sein.'), err.status);
    }
    callback(err);
  }

  api(connection, 'POST', '/api/config/config_entries/flow',
    { handler: 'local_todo', show_advanced_options: false }, function (err, flow) {
      if (err) return failed(err);
      if (!flow || !flow.flow_id) {
        return callback(new HomeAssistantError(t('Unexpected response from Home Assistant', 'Unerwartete Antwort von Home Assistant')));
      }
      api(connection, 'POST', '/api/config/config_entries/flow/' + encodeURIComponent(flow.flow_id),
        { todo_list_name: name }, function (err, result) {
          if (err) return failed(err);
          if (!result || result.type !== 'create_entry') {
            return callback(new HomeAssistantError(result && result.reason === 'already_configured'
              ? t('Home Assistant already has a to-do list called ', 'Home Assistant hat schon eine To-do-Liste namens ') + name
              : t('Home Assistant could not create the to-do list', 'Home Assistant konnte die To-do-Liste nicht erstellen') +
                (result && result.reason ? ' (' + result.reason + ')' : '')));
          }
          findNewEntity(connection, name, existing, 0, callback);
        });
    });
}

// The entity of a just created to-do list takes a moment to show up
function findNewEntity(connection, name, existing, attempt, callback) {
  getTodoEntities(connection, function (err, entities) {
    if (err) return callback(err);
    var known = {};
    existing.forEach(function (id) { known[id] = true; });
    var added = entities.filter(function (entity) { return !known[entity.id]; });
    var match = added.filter(function (entity) { return entity.name === name; })[0] || added[0];
    if (match) return callback(null, match.id);
    if (attempt >= 5) {
      return callback(new HomeAssistantError(t('The new to-do list did not show up in Home Assistant',
        'Die neue To-do-Liste ist in Home Assistant nicht aufgetaucht')));
    }
    setTimeout(function () { findNewEntity(connection, name, existing, attempt + 1, callback); }, 1000);
  });
}

// The sync provider (see sync.js) for a to-do entity, or null when Home
// Assistant isn't set up
function provider(entity) {
  var connection = loadConnection();
  if (!connection || !entity) return null;
  return {
    name: 'Home Assistant',
    getList: function (callback) { getItems(connection, entity, callback); },
    applyChanges: function (changes, callback) {
      applyChanges(connection, entity, changes, callback);
    }
  };
}

module.exports = {
  HomeAssistantError: HomeAssistantError,
  loadConnection: loadConnection,
  saveConnection: saveConnection,
  normalizeUrl: normalizeUrl,
  getTodoEntities: getTodoEntities,
  createTodoList: createTodoList,
  provider: provider
};
