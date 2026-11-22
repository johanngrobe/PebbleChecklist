# Checklist — notes for contributors and coding agents

A Pebble watchapp (C, in `src/c/`) with a phone-side PebbleKit JS component (`src/pkjs/`) and a config page (`config-page/`) that is baked into `src/pkjs/configDataUri.js` at build time.

## Build

```bash
node buildConfigPage.js   # ALWAYS run first if config-page/* changed — bakes the config page into src/pkjs/configDataUri.js
pebble build              # builds all target platforms into build/PebbleChecklist.pbw
```

## Run & drive in the emulator

```bash
pebble install --emulator basalt          # boots QEMU + pypkjs and launches the app
                                          # (first call after cold boot may fail with "Connection refused" — just retry)
pebble screenshot --emulator basalt out.png
pebble emu-button --emulator basalt click down|up|select|back   # -n N -i MS to repeat
```

## Inject data through the real AppMessage path

App UUID: `b938082c-c230-4b8f-847d-15b27b1f907e` (needed for `send-app-message` when not run from repo root).

```bash
# add an item (key 0 = KEY_ITEMS_TO_ADD, one item per message)
pebble send-app-message --emulator basalt --app-uuid b938082c-c230-4b8f-847d-15b27b1f907e --string 0=Milk
# replace whole list (key 3 = KEY_ITEM_UPDATES, JSON; '3=[]' empties the list)
pebble send-app-message --emulator basalt --app-uuid ... --string '3=[{"n":"Milk","c":1}]'
# settings bitfield (key 4 = KEY_SETTINGS): 1=show voice btn, 2=move checked to bottom, 4=wrap-around scroll, 8=larger font, 16=voice input on quick launch
pebble send-app-message --emulator basalt --app-uuid ... --int 4=7
```

## List limits

The list goes both ways as the same compact JSON (`[{"n":"Milk","c":1}]`): the watch sends it as key 2 (`KEY_CURRENT_STATE`, along with key 5 `KEY_TOTAL_ITEMS`) and the phone sends it back as key 3.

- At most 52 items (`MAX_CHECKLIST_ITEMS`), each name at most 89 UTF-8 bytes (`MAX_NAME_LENGTH - 1`).
- The JSON can be at most 4000 bytes in either direction (`LIST_JSON_MAX_BYTES`, sized to fit the 4096-byte AppMessage buffers). The watch sends only whole items that fit, and key 5 lets the config page warn when items were left out.
- The config page mirrors these limits as constants at the top of `config-page/config.js`, so change both sides together.
  `src/pkjs/sync.js` has the same constants for the Cookidoo list.

## Multiple lists

The watch shows up to 8 lists (`MAX_LISTS`); the phone keeps up to 32 (`MAX_ALL_LISTS`), the rest hidden (`hidden: true`: listed only on the config page, where each list has a show/hide button; the watch's directory leaves them out). Each list has a type: `local` (a plain checklist), `cookidoo` (the Cookidoo shopping list, at most one) or `ha` (a Home Assistant to-do entity).

- The phone owns the directory (`src/pkjs/lists.js`, localStorage `lists`) and the items of every local list; synced lists keep their sync state under `list_sync_<id>`. The watch's persistent storage (4 KB) only fits one list, so the watch stores just the list it shows plus the directory (`src/c/lists.c`, sent as key 8 `KEY_LISTS`, lines of `<id>\t<type l|c|h>\t<name>`).
- Existing installs migrate to a single list with id 1 (Cookidoo if it was linked, otherwise local; `cookidoo_sync` moves to `list_sync_1`). The watch defaults its active list to 1.
- On the watch, the list picker (`windows/list_picker_window.c`) sits below the checklist window when there's more than one list, so Back leads to it. Picking another list sends the current list with reason 4 (`STATE_REASON_SWITCH`) and key 10 (`KEY_SWITCH_TO`); the phone saves/uploads it, then sends the new list's items with keys 9 (`KEY_LIST_ID`) and 10. Switching needs the phone.
- Key 9 `KEY_LIST_ID` goes with every list in both directions. The watch ignores items for a list it isn't showing unless key 10 is set, so a sync that finishes after a switch can't overwrite the new list. The phone can ask the watch to switch (config page "Show on watch") with `KEY_REQUEST_STATE = 4` + `KEY_SWITCH_TO`.
- Every to-do list in Home Assistant gets a list automatically (`lists.addHomeAssistantLists`, run on app start, when the config page opens and after saving): new ones are added (hidden once 8 are shown), ones deleted in Home Assistant are removed. The config page can't delete them, only hide them.
- New lists made on the config page are Home Assistant lists by default when it's connected (otherwise local; Cookidoo lists can't be made, signing in adds the shopping list). pkjs creates them as Local To-do lists through the config flow API (`POST /api/config/config_entries/flow` with handler `local_todo`, then `{todo_list_name}`; needs an administrator's token) and looks up the new entity. Until that worked, the list is *pending* (`type: 'ha'` without `entity`, `isPendingHa`): its items are stored like a local list's, and creation is retried on app start, every 2 minutes and after saving, since Home Assistant is often only reachable at home (`err.unreachable`). Only a refusal (not an admin, name taken) turns it into a local list.
- The config page gets every list (`__LISTS__`, `__ACTIVE_LIST__`) and sends back all lists, but only includes `items` for lists that changed.

```bash
# give the watch two lists (the phone sends its own directory again on the next launch)
pebble send-app-message --emulator basalt --app-uuid ... --string $'8=1\tc\tEinkaufsliste\n2\tl\tTodo'
```

## Home Assistant sync

`src/pkjs/homeassistant.js` syncs a list with a to-do entity through Home Assistant's REST API with a long-lived access token: `todo.get_items` (`?return_response`, Home Assistant 2024.8+), `add_item`, `update_item` (by uid; by name right after adding), `remove_item`. It plugs into the same three-way merge as Cookidoo (`sync.js` takes a provider with `getList` and `applyChanges`). The config page only collects URL and token (`config-page/homeassistant.js`): settings pages can only reach declared domains, so every request happens in pkjs, which also passes the list of to-do entities to the page when it opens.

Network permissions (`package.json` `usesPermissions`): `LocalNetwork` for a LAN instance (plain http works), `ui.nabu.casa` for Nabu Casa. Any other domain makes the phone app ask the user on first use.

## Cookidoo sync

The list can be synced with the user's Cookidoo shopping list. The parts:

- `config-page/cookidoo.js`: sign-in, run from the config page. It uses the JSON login API of Vorwerk's CIAM (a cidaas server, the API cidaas' native SDKs use): `authz-srv/authrequest/authz/generate` → `login-srv/login/sdk` → `token-srv/token` (code + PKCE, public client `mobile-android`). The hosted login page can't be used because it ends in a redirect to the Cookidoo app's URL scheme. CIAM allows CORS, so this works from the data: URI page. The tokens are passed to pkjs on save (`cookidoo: {action: 'link', ...}`).
- `src/pkjs/cookidoo.js`: token refresh and the shopping list API (`https://<host>/shopping/<language>/...`, same endpoints as the `cookidoo-api` Python library used by Home Assistant).
- `src/pkjs/sync.js`: three-way merge (shared with Home Assistant). Each list sent to the watch has a version (key 7) and each item a 1-based remote id (`"i"` in the list JSON, stored in `ChecklistItem.remote_id`). Recipe ingredients also carry `"l":1` (`ChecklistItem.is_locked`): Cookidoo can only check them, not rename or delete them, so the watch's "Clear completed" and the config page skip them. Only additional items ("zusätzliche Einkaufsliste") can be added, renamed and deleted; anything added on the watch or page becomes one. pkjs keeps a snapshot of each recent version; the watch echoes the ids and version, so check/uncheck, deletions and new items can be found and uploaded before the list is fetched again.

While Cookidoo is linked, the config page shows the Cookidoo list, not just the watch's: pkjs syncs the watch's list (if the watch answers within 4 s; otherwise without it, e.g. when the app isn't open on the watch), then opens the page with the result. Saving uploads the page's changes to Cookidoo even if the watch is unreachable.

Extra message keys: 6 = `KEY_SYNC_ENABLED` (phone → watch, persisted; the watch only pushes changes when it's set), 7 = `KEY_LIST_VERSION`. Key 1 (`KEY_REQUEST_STATE`) carries a reason in both directions: 1 = for the config page, 2 = sync request from the phone, 3 = list changed on the watch (sent 1.5 s after the last change).

```bash
# pretend Cookidoo is linked (watch then reports changes with reason 3)
pebble send-app-message --emulator basalt --app-uuid ... --int 6=1
# a synced list, version 5
pebble send-app-message --emulator basalt --app-uuid ... --string '3=[{"n":"Mehl (200 g)","c":0,"i":1}]' --int 7=5
# (with several lists, add --int 9=<active list id>, or the watch may ignore it)
```

## Translations (English, German)

Texts are written in English in the code; German is picked by language, nothing else is supported.

- Watch: `TR("English", "Deutsch")` from `src/c/i18n.h`, German when the watch's locale (`i18n_get_system_locale()`) starts with `de`. Keep German texts short enough for the round screens (the empty-list hint has hand-placed line breaks there).
- pkjs: `t('English', 'Deutsch')` from `src/pkjs/i18n.js`, in the watch's language (`Pebble.getActiveWatchInfo().language`, else the phone's). Used for sync errors shown on the config page and default list names. pkjs passes the language to the page as `__LANGUAGE__` (`de`/`en`).
- Config page: `config-page/i18n.js` has a `GERMAN` dictionary keyed by the English text. Scripts call `t("Room for {count} more items.", {count: n})`; static text, `placeholder`, `aria-label` and `title` in `config.html` are translated by `translatePage()` on load, as long as the English text is in `GERMAN`. Adding or changing an English text means adding/updating its entry.

## Config page

Full pipeline test (watch state → pkjs → final data URI) without opening a browser:

```bash
BROWSER="/path/to/capture.sh %s" pebble emu-app-config --emulator basalt   # capture.sh writes "$1" to a file
# the captured file:// wrapper redirects to http://localhost:<port>/config/<uuid>/?return_to=...;
# GET that URL for the page (already decoded HTML), and GET <return_to><encoded JSON> to "save" it
```

To eyeball the page standalone: decode `src/pkjs/configDataUri.js`, replace `__LISTS__` (JSON, `[{"id":1,"name":"Checklist","type":"local","items":[]}]`) / `__ACTIVE_LIST__` / `__CURRENT_SETTINGS__` / `__COOKIDOO__` / `__HOME_ASSISTANT__` (JSON, e.g. `{"linked":false}`) / `__LANGUAGE__` (`de` or `en`) *before* decoding (values are percent-decoded along with the page), write to an .html file, and screenshot with headless Chrome. Use a wide window (e.g. 900px) — headless doesn't apply the meta viewport, so narrow windows crop the right edge (not a real bug; phone webviews render fine).

## Cleanup

```bash
pebble kill               # shuts down emulator QEMU/pypkjs
rm -f ~/pebble-tool-emu-app-config-*.html   # temp wrapper left by emu-app-config
```
