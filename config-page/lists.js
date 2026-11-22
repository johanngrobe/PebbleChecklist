// The user's lists on the config page: switching between them, creating,
// renaming and deleting them, and which one the watch shows.
//
// window.LISTS (from the phone) is [{id, name, type, entity, hidden, items,
// total, status}], where type is 'local', 'cookidoo' or 'ha' (a Home Assistant
// to-do list, entity being its entity id; the phone adds one for every to-do
// list), hidden means not shown on the watch, and window.ACTIVE_LIST is the id
// of the list the watch shows. The list being edited is in the global `items`
// (config.js).

// limits shared with the phone (lists.js) and the watch (lists.h): the watch
// shows up to MAX_LISTS lists, the phone keeps up to MAX_ALL_LISTS
const MAX_LISTS = 8;
const MAX_ALL_LISTS = 32;
const MAX_LIST_NAME_BYTES = 29;

let pageLists = [];
let currentListIndex = 0;
// the list the watch shows, and the one to show after saving (if changed)
let watchListId = null;
let activateListId = null;
// each list's items as loaded, to only send the lists that were changed
const originalListJson = {};
let newListCounter = 0;
// the list open in the list editor (null for a new one)
let editingListIndex = null;
let deleteArmed = false;

const LIST_TYPE_LABELS = {
  local: "Checklist",
  cookidoo: "Cookidoo shopping list",
  ha: "Home Assistant to-do list"
};

function listTypeLabel(type) {
  return t(LIST_TYPE_LABELS[type] || LIST_TYPE_LABELS.local);
}

function currentList() {
  return pageLists[currentListIndex];
}

function visibleListCount() {
  return pageLists.filter(function (list) { return !list.hidden; }).length;
}

function initLists() {
  const data = Array.isArray(window.LISTS) ? window.LISTS : [];
  pageLists = data.map(function (list) {
    return Object.assign({}, list, { items: Array.isArray(list.items) ? list.items : [] });
  });
  if (!pageLists.length) {
    pageLists.push({ id: 1, name: t("Checklist"), type: "local", items: [] });
  }
  watchListId = window.ACTIVE_LIST;
  pageLists.forEach(function (list) {
    originalListJson[list.id] = listJson(list.items);
  });
  currentListIndex = Math.max(0, pageLists.findIndex(function (list) { return list.id === watchListId; }));
  items = currentList().items;
  renderListHeader();
}

// the list's items are edited through the global `items`, which some edits
// replace, so it's put back before switching lists or saving
function storeCurrentItems() {
  currentList().items = items;
}

function selectList(index) {
  storeCurrentItems();
  currentListIndex = index;
  items = currentList().items;
  document.getElementById("io_section").style.display = "none";
  document.getElementById("new_item_input").value = "";
  renderListHeader();
  renderItems();
  showTruncatedWarning();
  renderSyncBanner();
  window.scrollTo(0, 0);
}

function shownOnWatchId() {
  return activateListId !== null ? activateListId : watchListId;
}

function renderListHeader() {
  const list = currentList();
  document.getElementById("list_title").textContent = list.name;
  document.title = list.name;
  const onWatch = list.id === shownOnWatchId();
  let meta = listTypeLabel(list.type);
  if (list.type === "ha" && list.entity) meta += " (" + list.entity + ")";
  if (list.hidden) {
    meta = t("{type} · hidden on your watch", { type: meta });
  } else if (onWatch) {
    meta = t(activateListId !== null ? "{type} · shown on your watch after saving" : "{type} · shown on your watch",
      { type: meta });
  }
  document.getElementById("list_meta_text").textContent = meta;
  document.getElementById("show_on_watch_btn").style.display = onWatch || list.hidden ? "none" : "";
}

function showOnWatch() {
  activateListId = currentList().id === watchListId ? null : currentList().id;
  renderListHeader();
  renderListRows();
}

// The sync status of the current list, above its items
function renderSyncBanner() {
  const list = currentList();
  const banner = document.getElementById("cookidoo_banner");
  const status = list.status || {};
  let text = "";
  let error = false;
  let onClick = null;

  if (list.type === "cookidoo") {
    onClick = openCookidoo;
    if (!isCookidooLinked()) {
      text = t("Cookidoo will be disconnected when you save. This list will be kept as a checklist.");
    } else if (status.authFailed) {
      text = t("Your Cookidoo session has expired. Tap here to sign in again.");
      error = true;
    } else if (status.lastError) {
      text = t("Last Cookidoo sync failed: {error}", { error: status.lastError });
      error = true;
    } else {
      text = t("Synced with your Cookidoo shopping list ({email}).", { email: getCookidooInfo().email || "" });
    }
  } else if (list.type === "ha") {
    onClick = openHomeAssistant;
    if (!isHomeAssistantLinked()) {
      text = t("Home Assistant will be disconnected when you save. This list will be kept as a checklist.");
    } else if (list.isNew) {
      text = t("This list will be created in Home Assistant when you save.");
    } else if (!list.entity) {
      text = t("Waiting for Home Assistant: this list is created there as soon as Home Assistant can be reached. Until then it's kept on your watch and phone.");
    } else if (status.authFailed) {
      text = t("Home Assistant rejected the access token. Tap here to enter a new one.");
      error = true;
    } else if (status.lastError) {
      text = t("Last Home Assistant sync failed: {error}", { error: status.lastError });
      error = true;
    } else {
      text = t("Synced with {entity} in Home Assistant.", { entity: list.entity }) +
        (status.lastSync ? " " + t("Last synced {time}.", { time: formatTime(status.lastSync) }) : "");
    }
  }

  banner.textContent = text;
  banner.className = "cookidoo-banner" + (error ? " error" : "");
  banner.style.display = text ? "block" : "none";
  banner.onclick = onClick;
}

// ---------------------------------------------------------------------------
// Lists dialog

// notice: shown below the lists instead of the usual hint
function renderListRows(notice) {
  const container = document.getElementById("lists_rows");
  container.innerHTML = "";
  pageLists.forEach(function (list, index) {
    let sub = listTypeLabel(list.type);
    if (list.hidden) sub = t("{type} · hidden", { type: sub });
    else if (list.id === shownOnWatchId()) sub = t("{type} · on watch", { type: sub });
    const row = document.createElement("div");
    row.className = "list-row" + (index === currentListIndex ? " current" : "") + (list.hidden ? " hidden-list" : "");
    row.innerHTML =
      '<button type="button" class="list-row-main">' +
      '<span class="list-row-name">' + escapeHtml(list.name) + '</span>' +
      '<span class="list-row-sub">' + escapeHtml(sub) + '</span></button>' +
      '<button type="button" class="icon-btn list-row-visibility" aria-pressed="' + !list.hidden + '" aria-label="' +
      escapeHtml(t(list.hidden ? "Show {name} on the watch" : "Hide {name} on the watch", { name: list.name })) + '">' +
      (list.hidden ? EYE_OFF_ICON : EYE_ICON) + '</button>' +
      '<button type="button" class="icon-btn list-row-edit" aria-label="' + escapeHtml(t("Edit {name}", { name: list.name })) + '">&#9998;</button>';
    row.querySelector(".list-row-main").addEventListener("click", function () {
      closeLists();
      if (index !== currentListIndex) selectList(index);
    });
    row.querySelector(".list-row-edit").addEventListener("click", function () {
      openListEditor(index);
    });
    row.querySelector(".list-row-visibility").addEventListener("click", function () {
      toggleListHidden(index);
    });
    container.appendChild(row);
  });

  // new lists are shown on the watch
  const full = visibleListCount() >= MAX_LISTS || pageLists.length >= MAX_ALL_LISTS;
  document.getElementById("new_list_btn").disabled = full;
  document.getElementById("lists_limit_hint").textContent = notice || (full
    ? (pageLists.length >= MAX_ALL_LISTS
      ? t("You can have up to {max} lists.", { max: MAX_ALL_LISTS })
      : t("Your watch can show up to {max} lists. Hide one to add another.", { max: MAX_LISTS }))
    : "");
}

const EYE_ICON = '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M8 3C4.4 3 1.6 5.3.5 8c1.1 2.7 3.9 5 7.5 5s6.4-2.3 7.5-5C14.4 5.3 11.6 3 8 3zm0 8.3A3.3 3.3 0 1 1 8 4.7a3.3 3.3 0 0 1 0 6.6zM8 6.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z"/></svg>';
const EYE_OFF_ICON = '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M2.3 1.3 1.3 2.3l2 2C2 5.3 1.1 6.6.5 8c1.1 2.7 3.9 5 7.5 5 1.3 0 2.5-.3 3.6-.8l2.1 2.1 1-1L2.3 1.3zM8 11.3A3.3 3.3 0 0 1 4.9 6.9l1.3 1.3A1.7 1.7 0 0 0 7.8 9.8l1.3 1.3c-.4.1-.7.2-1.1.2zM8 3c-.9 0-1.8.2-2.6.5l1.4 1.4c.4-.1.8-.2 1.2-.2a3.3 3.3 0 0 1 3.3 3.3c0 .4-.1.8-.2 1.2l2.2 2.2c1-.9 1.8-2 2.2-3.4C14.4 5.3 11.6 3 8 3z"/></svg>';

// Hides a list on the watch, or shows it again
function toggleListHidden(index) {
  const list = pageLists[index];
  if (list.hidden) {
    if (visibleListCount() >= MAX_LISTS) {
      renderListRows(t("Your watch can show up to {max} lists. Hide another one first.", { max: MAX_LISTS }));
      return;
    }
    delete list.hidden;
  } else {
    if (visibleListCount() <= 1) {
      renderListRows(t("At least one list has to be shown on your watch."));
      return;
    }
    list.hidden = true;
    // the watch can't show a hidden list: it shows the first one it can
    if (list.id === shownOnWatchId()) {
      const first = pageLists.find(function (l) { return !l.hidden; });
      activateListId = first.id === watchListId ? null : first.id;
    }
  }
  renderListRows();
  renderListHeader();
}

function openLists() {
  renderListRows();
  document.getElementById("lists_modal").style.display = "flex";
}

function closeLists(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("lists_modal").style.display = "none";
}

// ---------------------------------------------------------------------------
// List editor (new list, rename, delete)

function cleanListName(name) {
  const chars = Array.from(String(name).replace(/\s+/g, " ").trim());
  while (utf8Length(chars.join("")) > MAX_LIST_NAME_BYTES) chars.pop();
  return chars.join("").trim();
}

function updateListTypeFields() {
  const isNew = editingListIndex === null;
  const type = document.getElementById("list_type").value;
  const hint = document.getElementById("list_type_hint");

  // without Home Assistant, new lists can only be checklists
  document.getElementById("list_type_row").style.display = isNew && isHomeAssistantLinked() ? "" : "none";

  let text = "";
  if (!isNew) {
    const list = pageLists[editingListIndex];
    text = listTypeLabel(list.type) + (list.entity ? " (" + list.entity + ")" : "") + ".";
    if (list.type === "ha" && list.entity && isHomeAssistantLinked()) {
      text += " " + t("Home Assistant's to-do lists are added automatically. Hide the ones you don't need instead of deleting them.");
    }
  } else if (type === "ha" && isHomeAssistantLinked()) {
    text = t("A new to-do list is created in Home Assistant when you save, and synced both ways. If Home Assistant can't be reached right now (e.g. away from home), it's created as soon as it can be.");
  } else {
    text = t("A plain checklist, stored on your watch and phone.");
  }
  hint.textContent = text;
}

function openListEditor(index) {
  editingListIndex = index;
  deleteArmed = false;
  const isNew = index === null;
  const list = isNew ? null : pageLists[index];

  document.getElementById("list_edit_title").textContent = isNew ? t("New list") : t("Edit list");
  document.getElementById("list_name").value = isNew ? "" : list.name;
  document.getElementById("list_type").value = isHomeAssistantLinked() ? "ha" : "local";
  document.getElementById("list_edit_error").textContent = "";

  const deleteBtn = document.getElementById("list_delete_btn");
  deleteBtn.textContent = t("Delete list");
  // a Home Assistant list would come back: it can only be hidden (unless
  // it's still waiting to be created there)
  deleteBtn.style.display = isNew || pageLists.length <= 1 ||
    (list.type === "ha" && list.entity && isHomeAssistantLinked()) ? "none" : "";

  updateListTypeFields();
  document.getElementById("list_edit_modal").style.display = "flex";
  document.getElementById("list_name").focus();
}

function closeListEditor(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("list_edit_modal").style.display = "none";
}

function submitListEditor(event) {
  event.preventDefault();
  const error = document.getElementById("list_edit_error");
  const name = cleanListName(document.getElementById("list_name").value);
  if (!name) {
    error.textContent = t("Enter a name for the list.");
    return;
  }

  if (editingListIndex !== null) {
    pageLists[editingListIndex].name = name;
    closeListEditor();
    renderListRows();
    renderListHeader();
    return;
  }

  const type = document.getElementById("list_type").value === "ha" && isHomeAssistantLinked() ? "ha" : "local";
  const list = { id: "new" + (++newListCounter), name: name, type: type, items: [], isNew: true };

  if (type === "ha") {
    // Home Assistant won't create a second to-do list with the same name
    const taken = (getHomeAssistantInfo().entities || []).some(function (entity) {
      return cleanListName(entity.name).toLowerCase() === name.toLowerCase();
    }) || pageLists.some(function (l) {
      return l.type === "ha" && l.name.toLowerCase() === name.toLowerCase();
    });
    if (taken) {
      error.textContent = t("Home Assistant already has a to-do list with this name.");
      return;
    }
  }

  pageLists.push(list);
  originalListJson[list.id] = "[]";
  closeListEditor();
  closeLists();
  selectList(pageLists.length - 1);
}

function deleteEditedList() {
  if (editingListIndex === null || pageLists.length <= 1) return;
  const button = document.getElementById("list_delete_btn");
  if (!deleteArmed) {
    // confirm with a second tap (the page can't show dialogs)
    deleteArmed = true;
    button.textContent = t("Tap again to delete");
    return;
  }

  storeCurrentItems();
  const removed = pageLists.splice(editingListIndex, 1)[0];
  if (activateListId === removed.id) activateListId = null;
  if (!visibleListCount()) delete pageLists[0].hidden;
  closeListEditor();

  if (editingListIndex === currentListIndex) {
    currentListIndex = 0;
  } else if (editingListIndex < currentListIndex) {
    currentListIndex--;
  }
  items = currentList().items;
  renderListHeader();
  renderItems();
  showTruncatedWarning();
  renderSyncBanner();
  renderListRows();
}

// What's sent to the phone on save: every list, with the items of those that
// were changed (or are new)
function getListsForSave() {
  storeCurrentItems();
  return pageLists.map(function (list) {
    const entry = { id: list.id, name: list.name, type: list.type };
    if (list.entity) entry.entity = list.entity;
    if (list.hidden) entry.hidden = true;
    const json = listJson(list.items);
    if (list.isNew || json !== originalListJson[list.id] ||
      (list.type === "cookidoo" && !isCookidooLinked()) ||
      (list.type === "ha" && !isHomeAssistantLinked())) {
      entry.items = JSON.parse(json);
    }
    return entry;
  });
}

// Returns the index of a list too large to send to the watch, or -1
function findTooLargeList() {
  storeCurrentItems();
  return pageLists.findIndex(function (list) {
    return list.items.length > MAX_ITEMS || utf8Length(listJson(list.items)) > LIST_JSON_MAX_BYTES;
  });
}

function initListEditor() {
  document.getElementById("list_edit_form").addEventListener("submit", submitListEditor);
  document.getElementById("list_type").addEventListener("change", updateListTypeFields);
}
