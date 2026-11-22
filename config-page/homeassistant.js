// The Home Assistant connection on the config page. The page only collects the
// URL and access token: settings pages can't reach the home network (or any
// undeclared domain), so the phone app's JS connects on save and lists the
// to-do lists to pick from the next time the page opens.
//
// window.HOME_ASSISTANT (from the phone): {linked, url, entities: [{id, name}],
// error, authFailed}

// the change to the connection to send on save, if any
let homeAssistantAction = null;

function getHomeAssistantInfo() {
  const info = window.HOME_ASSISTANT;
  return info && typeof info === "object" ? info : { linked: false };
}

// Connected, or about to be when the page is saved
function isHomeAssistantLinked() {
  if (homeAssistantAction) return homeAssistantAction.action === "link";
  return !!getHomeAssistantInfo().linked;
}

function renderHomeAssistant() {
  const info = getHomeAssistantInfo();
  const status = document.getElementById("ha_status");
  let text = "";
  status.classList.remove("error-text");

  if (homeAssistantAction && homeAssistantAction.action === "unlink") {
    text = t("Home Assistant will be disconnected when you save.");
  } else if (homeAssistantAction) {
    text = t("Will connect to {url} when you save.", { url: homeAssistantAction.url });
  } else if (info.linked && info.error) {
    text = t("Connected to {url}, but: {error}", { url: info.url, error: info.error });
    status.classList.add("error-text");
  } else if (info.linked) {
    const count = (info.entities || []).length;
    text = t(count === 1 ? "Connected to {url} ({count} to-do list)." : "Connected to {url} ({count} to-do lists).",
      { url: info.url, count: count });
  }
  status.textContent = text;
  status.style.display = text ? "" : "none";
  document.getElementById("ha_disconnect_btn").style.display = isHomeAssistantLinked() ? "" : "none";
}

function openHomeAssistant() {
  const info = getHomeAssistantInfo();
  document.getElementById("ha_url").value =
    (homeAssistantAction && homeAssistantAction.url) || info.url || "";
  document.getElementById("ha_token").value = "";
  document.getElementById("ha_token").placeholder = info.linked ? t("Leave empty to keep the current token") : "";
  document.getElementById("ha_error").textContent = "";
  renderHomeAssistant();
  document.getElementById("ha_modal").style.display = "flex";
}

function closeHomeAssistant(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("ha_modal").style.display = "none";
}

function connectHomeAssistant(event) {
  event.preventDefault();
  const info = getHomeAssistantInfo();
  const error = document.getElementById("ha_error");
  let url = document.getElementById("ha_url").value.trim().replace(/\/+$/, "");
  const token = document.getElementById("ha_token").value.trim();

  if (url && !/^https?:\/\//i.test(url)) url = "http://" + url;
  if (!/^https?:\/\/[^\s/]+/i.test(url)) {
    error.textContent = t("Enter the address of your Home Assistant, like http://homeassistant.local:8123.");
    return;
  }
  if (!token && !info.linked) {
    error.textContent = t("Enter a long-lived access token.");
    return;
  }
  if (!token && url === info.url) {
    // nothing changed
    homeAssistantAction = null;
  } else if (!token) {
    error.textContent = t("Enter the access token for this Home Assistant.");
    return;
  } else if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    // long-lived access tokens are JWTs: three parts separated by dots
    error.textContent = t("This doesn't look like a Home Assistant access token. Copy the long-lived access token Home Assistant showed when you created it.");
    return;
  } else {
    homeAssistantAction = { action: "link", url: url, token: token };
  }
  closeHomeAssistant();
  renderHomeAssistant();
  renderSyncBanner();
}

function disconnectHomeAssistant() {
  homeAssistantAction = getHomeAssistantInfo().linked ? { action: "unlink" } : null;
  closeHomeAssistant();
  renderHomeAssistant();
  renderSyncBanner();
}

function initHomeAssistant() {
  document.getElementById("ha_form").addEventListener("submit", connectHomeAssistant);
  renderHomeAssistant();
}
