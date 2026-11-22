// Cookidoo (Thermomix) shopping list client for PebbleKit JS.
//
// Signing in happens on the config page (see config-page/cookidoo.js),
// which hands the resulting OAuth tokens to this module. This module keeps
// them fresh and talks to the shopping list API, the same one the Home
// Assistant Cookidoo integration (via the cookidoo-api library) uses.
//
// The shopping list has two kinds of items:
//   - ingredients of the recipes on the list: can only be checked/unchecked
//   - additional items: free text, can be added, renamed, checked and removed
// Checked means "owned" in Cookidoo.

var t = require('./i18n').t;

var CIAM_TOKEN_URL = 'https://ciam.prod.cookidoo.vorwerk-digital.com/token-srv/token';
var CLIENT_ID = 'mobile-android';

// refresh the access token this long before it actually expires
var TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;
var REQUEST_TIMEOUT_MS = 20000;

var STORAGE_KEY = 'cookidoo_account';

function loadAccount() {
  try {
    var account = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return account && account.refreshToken ? account : null;
  } catch (e) {
    return null;
  }
}

function saveAccount(account) {
  if (account) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// An error with an HTTP status, and whether it means the user has to sign in
// again
function CookidooError(message, status, authFailed) {
  this.message = message;
  this.status = status || 0;
  this.authFailed = !!authFailed;
}
CookidooError.prototype.toString = function () { return this.message; };

function request(method, url, headers, body, callback) {
  var xhr = new XMLHttpRequest();
  var done = false;
  function finish(err, status, text) {
    if (done) return;
    done = true;
    callback(err, status, text);
  }
  try {
    xhr.open(method, url, true);
    xhr.timeout = REQUEST_TIMEOUT_MS;
    Object.keys(headers || {}).forEach(function (name) {
      xhr.setRequestHeader(name, headers[name]);
    });
    xhr.onload = function () { finish(null, xhr.status, xhr.responseText); };
    xhr.onerror = function () { finish(new CookidooError(t('Could not reach Cookidoo', 'Cookidoo ist nicht erreichbar'))); };
    xhr.ontimeout = function () { finish(new CookidooError(t('Cookidoo did not respond', 'Cookidoo antwortet nicht'))); };
    xhr.send(body || null);
  } catch (e) {
    finish(new CookidooError(t('Request failed: ', 'Anfrage fehlgeschlagen: ') + e.message));
  }
}

function formEncode(params) {
  return Object.keys(params).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }).join('&');
}

// Stores the tokens from a token endpoint response in the account
function applyTokens(account, payload) {
  account.accessToken = payload.access_token;
  // the server may rotate the refresh token, or leave it out to keep the old one
  if (payload.refresh_token) account.refreshToken = payload.refresh_token;
  account.expiresAt = Date.now() + (parseInt(payload.expires_in, 10) || 43200) * 1000;
}

function refreshTokens(account, callback) {
  request('POST', CIAM_TOKEN_URL, {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  }, formEncode({
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
    client_id: CLIENT_ID
  }), function (err, status, text) {
    if (err) return callback(err);
    var payload = null;
    try { payload = JSON.parse(text); } catch (e) { /* handled below */ }
    if (status !== 200 || !payload || !payload.access_token) {
      // a rejected refresh token won't start working again
      var authFailed = status >= 400 && status < 500;
      return callback(new CookidooError(
        authFailed ? t('Your Cookidoo session has expired. Please sign in again.',
          'Deine Cookidoo-Sitzung ist abgelaufen. Bitte melde dich erneut an.')
          : t('Could not refresh the Cookidoo session', 'Die Cookidoo-Sitzung konnte nicht erneuert werden') +
            ' (' + status + ')',
        status, authFailed));
    }
    applyTokens(account, payload);
    saveAccount(account);
    callback(null);
  });
}

function ensureToken(account, callback) {
  if (account.accessToken && Date.now() < account.expiresAt - TOKEN_EXPIRY_MARGIN_MS) {
    return callback(null);
  }
  refreshTokens(account, callback);
}

// Calls the shopping list API. path is relative to /shopping/<language>.
function api(account, method, path, body, callback, isRetry) {
  ensureToken(account, function (err) {
    if (err) return callback(err);
    var url = 'https://' + account.host + '/shopping/' + account.language + path;
    var headers = {
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + account.accessToken
    };
    if (body) headers['Content-Type'] = 'application/json';
    request(method, url, headers, body ? JSON.stringify(body) : null, function (err, status, text) {
      if (err) return callback(err);
      if (status === 401 && !isRetry) {
        // the access token may have been revoked early; refresh once
        account.expiresAt = 0;
        return api(account, method, path, body, callback, true);
      }
      if (status === 401) {
        return callback(new CookidooError(t('Cookidoo rejected the sign-in. Please sign in again.',
          'Cookidoo hat die Anmeldung abgelehnt. Bitte melde dich erneut an.'), status, true));
      }
      if (status < 200 || status >= 300) {
        return callback(new CookidooError(t('Cookidoo request failed', 'Cookidoo-Anfrage fehlgeschlagen') + ' (' + status + ')', status));
      }
      var result = null;
      if (text) {
        try { result = JSON.parse(text); } catch (e) {
          return callback(new CookidooError(t('Unexpected response from Cookidoo', 'Unerwartete Antwort von Cookidoo')));
        }
      }
      callback(null, result);
    });
  });
}

function formatQuantity(quantity) {
  if (!quantity) return '';
  if (quantity.value) return String(quantity.value);
  if (quantity.from && quantity.to) return quantity.from + '-' + quantity.to;
  return '';
}

// Fetches the shopping list as [{id, type: 'i'|'a', name, owned}], ingredients
// first (in the order of their recipes), then the additional items
function getShoppingList(account, callback) {
  api(account, 'GET', '', null, function (err, result) {
    if (err) return callback(err);
    if (!result || typeof result !== 'object') {
      return callback(new CookidooError(t('Unexpected response from Cookidoo', 'Unerwartete Antwort von Cookidoo')));
    }
    var items = [];
    var recipes = (result.recipes || []).concat(result.customerRecipes || []);
    recipes.forEach(function (recipe) {
      (recipe.recipeIngredientGroups || []).forEach(function (ingredient) {
        var amount = formatQuantity(ingredient.quantity);
        if (amount && ingredient.unitNotation) amount += ' ' + ingredient.unitNotation;
        items.push({
          id: ingredient.id,
          type: 'i',
          name: ingredient.ingredientNotation + (amount ? ' (' + amount + ')' : ''),
          owned: !!ingredient.isOwned
        });
      });
    });
    (result.additionalItems || []).forEach(function (item) {
      items.push({ id: item.id, type: 'a', name: item.name, owned: !!item.isOwned });
    });
    callback(null, items);
  });
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function setIngredientsOwned(account, changes, callback) {
  if (!changes.length) return callback(null);
  api(account, 'POST', '/owned-ingredients/ownership/edit', {
    ingredients: changes.map(function (change) {
      return { id: change.id, isOwned: change.owned, ownedTimestamp: nowSeconds() };
    })
  }, callback);
}

function setAdditionalItemsOwned(account, changes, callback) {
  if (!changes.length) return callback(null);
  api(account, 'POST', '/additional-items/ownership/edit', {
    additionalItems: changes.map(function (change) {
      return { id: change.id, isOwned: change.owned, ownedTimestamp: nowSeconds() };
    })
  }, callback);
}

function renameAdditionalItems(account, changes, callback) {
  if (!changes.length) return callback(null);
  api(account, 'POST', '/additional-items/edit', {
    additionalItems: changes.map(function (change) {
      return { id: change.id, name: change.name };
    })
  }, callback);
}

// Adds additional items by name; calls back with the created items' ids, in
// the same order
function addAdditionalItems(account, names, callback) {
  if (!names.length) return callback(null, []);
  api(account, 'POST', '/additional-items/add', { itemsValue: names }, function (err, result) {
    if (err) return callback(err);
    var ids = ((result && result.data) || []).map(function (item) { return item.id; });
    callback(null, ids);
  });
}

function removeAdditionalItems(account, ids, callback) {
  if (!ids.length) return callback(null);
  api(account, 'POST', '/additional-items/remove', { additionalItemIDs: ids }, callback);
}

// Applies the changes planned by sync.planChanges, one request after another
function applyChanges(account, changes, callback) {
  var ingredients = changes.owned.filter(function (change) { return change.t === 'i'; });
  var additional = changes.owned.filter(function (change) { return change.t !== 'i'; });
  var steps = [
    function (next) { setIngredientsOwned(account, ingredients, next); },
    function (next) { setAdditionalItemsOwned(account, additional, next); },
    function (next) { renameAdditionalItems(account, changes.renames, next); },
    function (next) { removeAdditionalItems(account, changes.removed, next); },
    function (next) {
      var names = changes.added.map(function (item) { return item.name; });
      addAdditionalItems(account, names, function (err, ids) {
        if (err) return next(err);
        // new items always start unchecked in Cookidoo
        var owned = [];
        changes.added.forEach(function (item, index) {
          if (item.owned && ids[index]) owned.push({ id: ids[index], owned: true });
        });
        setAdditionalItemsOwned(account, owned, next);
      });
    }
  ];
  (function run(index) {
    if (index >= steps.length) return callback(null);
    steps[index](function (err) {
      if (err) return callback(err);
      run(index + 1);
    });
  })(0);
}

// The sync provider (see sync.js) for the signed-in account's shopping list,
// or null when not signed in
function provider() {
  var account = loadAccount();
  if (!account) return null;
  return {
    name: 'Cookidoo',
    getList: function (callback) { getShoppingList(account, callback); },
    applyChanges: function (changes, callback) { applyChanges(account, changes, callback); }
  };
}

module.exports = {
  CookidooError: CookidooError,
  provider: provider,
  loadAccount: loadAccount,
  saveAccount: saveAccount,
  getShoppingList: getShoppingList,
  setIngredientsOwned: setIngredientsOwned,
  setAdditionalItemsOwned: setAdditionalItemsOwned,
  renameAdditionalItems: renameAdditionalItems,
  addAdditionalItems: addAdditionalItems,
  removeAdditionalItems: removeAdditionalItems
};
