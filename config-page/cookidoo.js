// Cookidoo sign-in for the config page.
//
// Cookidoo accounts live on Vorwerk's CIAM (a cidaas server). Its JSON login
// API, which cidaas' own native SDKs use, signs in without the browser
// redirects to the Cookidoo app's URL scheme that the hosted login page ends
// in. CIAM allows cross-origin requests, so this page signs in by itself:
//   1. create a login request (OAuth authorization code flow with PKCE)
//   2. submit email and password, which returns the authorization code
//   3. exchange the code for an access and refresh token
// The password only goes to CIAM. The tokens are handed to the phone app's JS
// on save, which keeps them fresh and syncs the shopping list.

const COOKIDOO_CIAM_URL = "https://ciam.prod.cookidoo.vorwerk-digital.com";
const COOKIDOO_CLIENT_ID = "mobile-android";
const COOKIDOO_REDIRECT_URI = "com.vorwerk.cookidoo://code-grant";
const COOKIDOO_SCOPE = "openid profile email offline offline_access";

// Cookidoo sites per country: "<domain after cookidoo.>/<language> ...".
// From the cookidoo-api library's localization.json.
const COOKIDOO_MARKETS = {
  at: "at/de-AT", au: "com.au/en-AU", be: "be/nl-BE be/en be/fr-BE be/de-BE",
  ca: "ca/en-CA ca/fr-CA", ch: "ch/de-CH ch/fr-CH ch/it-CH ch/en", cz: "cz/cs",
  de: "de/de-DE", es: "es/es-ES", fr: "fr/fr-FR", gb: "co.uk/en-GB", ie: "co.uk/en-GB",
  it: "it/it-IT", lu: "be/nl-BE be/en be/fr-BE be/de-BE", mx: "mx/es-MX",
  nl: "be/nl-BE be/en be/fr-BE be/de-BE", nz: "com.au/en-AU", pl: "pl/pl",
  pt: "pt/pt-PT", tr: "com.tr/tr-TR", us: "thermomix.com/en-US"
};
// the other countries all use cookidoo.international with these languages
const COOKIDOO_INTERNATIONAL_COUNTRIES = ("ae ar bn br cl co cy dk ee gr gt hu id il is kw lt " +
  "ma mt my no pa pe ph py ro sa se sg th ua uy vn za").split(" ");
const COOKIDOO_INTERNATIONAL_LANGUAGES = "en fr el hu id pt-BR ro zh-Hans es vi".split(" ");

// Returns [{host, language}] for a country
function cookidooSitesFor(country) {
  if (COOKIDOO_MARKETS[country]) {
    return COOKIDOO_MARKETS[country].split(" ").map(function (site) {
      const parts = site.split("/");
      return { host: "cookidoo." + parts[0], language: parts[1] };
    });
  }
  return COOKIDOO_INTERNATIONAL_LANGUAGES.map(function (language) {
    return { host: "cookidoo.international", language: language };
  });
}

function displayName(type, code) {
  try {
    const names = new Intl.DisplayNames([pageLanguage(), navigator.language || "en"], { type: type });
    return names.of(type === "region" ? code.toUpperCase() : code) || code;
  } catch (e) {
    return code.toUpperCase();
  }
}

// ---------------------------------------------------------------------------
// PKCE. SHA-256 is done here rather than with crypto.subtle, which a data: URL
// page may not get.

function sha256(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  // pad: 0x80, zeros, then the bit length as a 64-bit big-endian number
  const length = bytes.length;
  const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);

  const w = new Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  H.forEach(function (value, i) { outView.setUint32(i * 4, value >>> 0); });
  return out;
}

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach(function (b) { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBytes(count) {
  const bytes = new Uint8Array(count);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < count; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function createPkcePair() {
  const verifier = base64Url(randomBytes(48));
  const verifierBytes = new Uint8Array(verifier.length);
  for (let i = 0; i < verifier.length; i++) verifierBytes[i] = verifier.charCodeAt(i);
  return { verifier: verifier, challenge: base64Url(sha256(verifierBytes)) };
}

// ---------------------------------------------------------------------------
// Sign-in

function cookidooRequest(method, url, contentType, body) {
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = 20000;
    xhr.setRequestHeader("Accept", "application/json");
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.onload = function () {
      let json = null;
      try { json = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
      resolve({ status: xhr.status, json: json, text: xhr.responseText });
    };
    xhr.onerror = function () { reject(new Error(t("Could not reach Cookidoo. Check your connection and try again."))); };
    xhr.ontimeout = function () { reject(new Error(t("Cookidoo did not respond. Please try again."))); };
    xhr.send(body || null);
  });
}

// The authorization code, from {data: {code}} or from a redirect URL anywhere
// in the response (which is how cidaas hands it over in some setups)
function findAuthorizationCode(response) {
  const data = response.json && response.json.data;
  if (data && typeof data.code === "string" && data.code) return data.code;
  const match = /[?&]code=([^&#"\\\s]+)/.exec(response.text || "");
  return match ? decodeURIComponent(match[1]) : null;
}

// Signs in, resolving with {accessToken, refreshToken, expiresAt}
function cookidooSignIn(email, password, site, country) {
  const pkce = createPkcePair();
  const state = base64Url(randomBytes(16));

  return cookidooRequest("POST", COOKIDOO_CIAM_URL + "/authz-srv/authrequest/authz/generate",
    "application/json", JSON.stringify({
      client_id: COOKIDOO_CLIENT_ID,
      redirect_uri: COOKIDOO_REDIRECT_URI,
      response_type: "code",
      scope: COOKIDOO_SCOPE,
      state: state,
      nonce: base64Url(randomBytes(16)),
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      ui_locales: site.language,
      market: country
    })
  ).then(function (response) {
    const requestId = response.json && response.json.data && response.json.data.requestId;
    if (!requestId) throw new Error(t("Cookidoo sign-in is unavailable right now ({status}).", { status: response.status }));

    return cookidooRequest("POST", COOKIDOO_CIAM_URL + "/login-srv/login/sdk",
      "application/json", JSON.stringify({
        username: email,
        password: password,
        username_type: "email",
        requestId: requestId
      }));
  }).then(function (response) {
    const code = findAuthorizationCode(response);
    if (!code) {
      const error = (response.json && response.json.error) || {};
      if (error.error === "invalid_username_password") {
        throw new Error(t("Wrong email or password."));
      }
      throw new Error(t("Sign-in was not completed{detail}. If your account needs an extra step (like accepting new terms), finish it in the Cookidoo app or website, then try again.",
        { detail: error.error_description ? ": " + error.error_description : " (" + response.status + ")" }));
    }

    const form = {
      grant_type: "authorization_code",
      code: code,
      redirect_uri: COOKIDOO_REDIRECT_URI,
      code_verifier: pkce.verifier,
      client_id: COOKIDOO_CLIENT_ID
    };
    return cookidooRequest("POST", COOKIDOO_CIAM_URL + "/token-srv/token",
      "application/x-www-form-urlencoded",
      Object.keys(form).map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(form[key]);
      }).join("&"));
  }).then(function (response) {
    const tokens = response.json;
    if (response.status !== 200 || !tokens || !tokens.access_token || !tokens.refresh_token) {
      throw new Error(t("Cookidoo did not accept the sign-in ({status}).", { status: response.status }));
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (parseInt(tokens.expires_in, 10) || 43200) * 1000
    };
  });
}

// ---------------------------------------------------------------------------
// UI

// the change to the Cookidoo connection to send on save, if any
let cookidooAction = null;

function getCookidooInfo() {
  const info = window.COOKIDOO;
  return info && typeof info === "object" ? info : { linked: false };
}

function isCookidooLinked() {
  return getCookidooInfo().linked && !(cookidooAction && cookidooAction.action === "unlink");
}

function fillCountrySelect() {
  const select = document.getElementById("cookidoo_country");
  const countries = Object.keys(COOKIDOO_MARKETS).concat(COOKIDOO_INTERNATIONAL_COUNTRIES)
    .map(function (code) { return { code: code, name: displayName("region", code) }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
  select.innerHTML = countries.map(function (country) {
    return '<option value="' + country.code + '">' + escapeHtml(country.name) + "</option>";
  }).join("");

  // guess the country from the browser's language, e.g. de-DE -> de
  const region = ((navigator.language || "").split("-")[1] || "").toLowerCase();
  select.value = COOKIDOO_MARKETS[region] || COOKIDOO_INTERNATIONAL_COUNTRIES.indexOf(region) >= 0 ? region : "de";
  fillLanguageSelect();
}

function fillLanguageSelect() {
  const country = document.getElementById("cookidoo_country").value;
  const select = document.getElementById("cookidoo_language");
  const sites = cookidooSitesFor(country);
  select.innerHTML = sites.map(function (site, index) {
    return '<option value="' + index + '">' + escapeHtml(displayName("language", site.language)) +
      " (" + site.host + ")</option>";
  }).join("");
  // prefer the browser's language
  const browserLanguage = (navigator.language || "").split("-")[0];
  const preferred = sites.findIndex(function (site) { return site.language.split("-")[0] === browserLanguage; });
  select.value = String(Math.max(0, preferred));
  document.getElementById("cookidoo_language_row").style.display = sites.length > 1 ? "" : "none";
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleString(pageLanguage(), { dateStyle: "short", timeStyle: "short" });
  } catch (e) {
    return new Date(timestamp).toLocaleString();
  }
}

// Shows the connection in the Cookidoo dialog (and the list's banner)
function renderCookidoo() {
  const info = getCookidooInfo();
  const linked = isCookidooLinked();
  const status = document.getElementById("cookidoo_linked_status");

  document.getElementById("cookidoo_signed_out").style.display = linked ? "none" : "block";
  document.getElementById("cookidoo_signed_in").style.display = linked ? "block" : "none";
  renderSyncBanner();
  if (!linked) return;

  // the sync status is kept with the Cookidoo list
  const list = pageLists.find(function (l) { return l.type === "cookidoo"; });
  const sync = (list && list.status) || {};
  status.textContent = t("Signed in as {email} on {host}.", { email: info.email, host: info.host }) +
    (sync.lastSync ? " " + t("Last synced {time}.", { time: formatTime(sync.lastSync) }) : "");
  document.getElementById("cookidoo_reauth_hint").style.display = sync.authFailed ? "block" : "none";
}

function openCookidoo() {
  document.getElementById("cookidoo_error").textContent = "";
  document.getElementById("cookidoo_modal").style.display = "flex";
}

function closeCookidoo(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("cookidoo_modal").style.display = "none";
}

function signInToCookidoo(event) {
  if (event) event.preventDefault();
  const email = document.getElementById("cookidoo_email").value.trim();
  const password = document.getElementById("cookidoo_password").value;
  const errorEl = document.getElementById("cookidoo_error");
  const button = document.getElementById("cookidoo_sign_in_btn");
  if (!email || !password) {
    errorEl.textContent = t("Enter your Cookidoo email and password.");
    return;
  }

  const country = document.getElementById("cookidoo_country").value;
  const site = cookidooSitesFor(country)[parseInt(document.getElementById("cookidoo_language").value, 10) || 0];

  errorEl.textContent = "";
  button.disabled = true;
  button.textContent = t("Signing in…");

  cookidooSignIn(email, password, site, country).then(function (tokens) {
    cookidooAction = {
      action: "link",
      email: email,
      host: site.host,
      language: site.language,
      country: country,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt
    };
    document.getElementById("cookidoo_password").value = "";
    button.textContent = t("Signed in!");
    // nothing else to do here: save right away so the list starts syncing
    submitData();
  }).catch(function (err) {
    errorEl.textContent = err.message;
    button.disabled = false;
    button.textContent = t("Sign in");
  });
}

function signOutOfCookidoo() {
  cookidooAction = { action: "unlink" };
  closeCookidoo();
  renderCookidoo();
}

// Re-signs in after the session expired: the old connection is dropped once
// the new sign-in is saved
function showCookidooSignIn() {
  document.getElementById("cookidoo_signed_in").style.display = "none";
  document.getElementById("cookidoo_signed_out").style.display = "block";
  document.getElementById("cookidoo_email").value = getCookidooInfo().email || "";
}

function initCookidoo() {
  fillCountrySelect();
  const info = getCookidooInfo();
  if (info.linked && info.host) {
    // preselect the site the account was set up with
    const country = Object.keys(COOKIDOO_MARKETS).find(function (code) {
      return cookidooSitesFor(code).some(function (site) { return site.host === info.host; });
    });
    if (country) {
      document.getElementById("cookidoo_country").value = country;
      fillLanguageSelect();
    }
  }
  document.getElementById("cookidoo_country").addEventListener("change", fillLanguageSelect);
  document.getElementById("cookidoo_signed_out").addEventListener("submit", signInToCookidoo);
  renderCookidoo();
}
