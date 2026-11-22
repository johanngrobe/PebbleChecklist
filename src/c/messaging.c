#include "messaging.h"
#include "checklist.h"
#include "lists.h"
#include "settings.h"
#include "util.h"
#include <pebble.h>

// persistent storage keys
#define PERSIST_KEY_SYNC_ENABLED 52
#define PERSIST_KEY_LIST_VERSION 53

// how long after a change on the watch its list is sent to the phone
#define CHANGE_NOTIFY_DELAY_MS 1500
// how long to wait before trying again when the outbox is busy
#define SEND_RETRY_DELAY_MS 1000
// how long to wait for the phone to send the list being switched to (it may
// have to fetch it from Cookidoo or Home Assistant first)
#define SWITCH_TIMEOUT_MS 20000

static char s_items_to_add_buffer[512];
static char s_current_state_buffer[LIST_JSON_MAX_BYTES + 1];

// see KEY_SYNC_ENABLED and KEY_LIST_VERSION
static bool s_sync_enabled;
static int32_t s_list_version;

// pending report of a change made on the watch
static AppTimer *s_change_timer;

// the list being switched to (0 if none), and who to tell when it's done
static uint8_t s_pending_switch;
static SwitchHandler s_switch_handler;
static AppTimer *s_switch_timer;

void (*message_processed_callback)(void);

void messaging_init(void (*processed_callback)(void)) {
  // register my custom callback
  message_processed_callback = processed_callback;

  s_sync_enabled = persist_read_bool(PERSIST_KEY_SYNC_ENABLED);
  s_list_version = persist_read_int(PERSIST_KEY_LIST_VERSION);

  // Register callbacks
  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_register_outbox_sent(outbox_sent_callback);

  // Open AppMessage
  // app_message_open(app_message_inbox_size_maximum(),
  // app_message_outbox_size_maximum());
  app_message_open(INBOX_SIZE, OUTBOX_SIZE);

  APP_LOG(APP_LOG_LEVEL_DEBUG, "Watch messaging is started!");
  app_message_register_inbox_received(inbox_received_callback);
}

static void finish_switch(bool success) {
  if (s_switch_timer != NULL) {
    app_timer_cancel(s_switch_timer);
    s_switch_timer = NULL;
  }
  SwitchHandler handler = s_switch_handler;
  s_pending_switch = 0;
  s_switch_handler = NULL;
  if (handler != NULL) {
    handler(success);
  }
}

static void switch_timeout_callback(void *context) {
  s_switch_timer = NULL;
  APP_LOG(APP_LOG_LEVEL_WARNING, "The phone did not send the list in time");
  finish_switch(false);
}

void inbox_received_callback(DictionaryIterator *iterator, void *context) {
  // Check for items to add (existing functionality)
  Tuple *items_to_add_tuple = dict_find(iterator, KEY_ITEMS_TO_ADD);

  if (items_to_add_tuple != NULL) {
    strncpy(s_items_to_add_buffer, items_to_add_tuple->value->cstring,
            sizeof(s_items_to_add_buffer) - 1);

    checklist_add_items(s_items_to_add_buffer);
  }

  Tuple *lists_tuple = dict_find(iterator, KEY_LISTS);

  if (lists_tuple != NULL) {
    lists_apply_directory(lists_tuple->value->cstring);
  }

  Tuple *switch_tuple = dict_find(iterator, KEY_SWITCH_TO);
  Tuple *item_updates_tuple = dict_find(iterator, KEY_ITEM_UPDATES);

  // Check for state request (new two-way sync functionality)
  Tuple *request_state_tuple = dict_find(iterator, KEY_REQUEST_STATE);

  if (request_state_tuple != NULL) {
    int reason = (int)request_state_tuple->value->int32;
    if (reason == STATE_REASON_SWITCH) {
      // the phone wants the watch to show another list (e.g. picked on the
      // config page)
      if (switch_tuple != NULL && s_pending_switch == 0) {
        messaging_request_switch(switch_tuple->value->uint8, NULL);
      }
    } else {
      APP_LOG(APP_LOG_LEVEL_DEBUG,
              "State request received, sending current state");
      send_current_state_to_phone(reason == STATE_REASON_SYNC ? STATE_REASON_SYNC
                                                              : STATE_REASON_CONFIG);
    }
  }

  // Check for item updates (new two-way sync functionality). Updates for a
  // list the watch doesn't show (e.g. a sync that finished after switching
  // lists) are ignored, unless they're the list being switched to.
  Tuple *list_id_tuple = dict_find(iterator, KEY_LIST_ID);
  bool is_switch = item_updates_tuple != NULL && switch_tuple != NULL;
  bool for_active_list = is_switch || list_id_tuple == NULL ||
                         list_id_tuple->value->uint8 == lists_get_active_id();

  if (item_updates_tuple != NULL && for_active_list) {
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Item updates received: %s",
            item_updates_tuple->value->cstring);

    if (s_change_timer != NULL) {
      app_timer_cancel(s_change_timer);
      s_change_timer = NULL;
      // a change made on the watch that hasn't been reported yet would be
      // overwritten, so report it now (against the list version it was made
      // to). When switching, the list was already sent with the request.
      if (!is_switch) {
        send_current_state_to_phone(STATE_REASON_CHANGED);
      }
    }

    process_item_updates(item_updates_tuple->value->cstring);

    Tuple *version_tuple = dict_find(iterator, KEY_LIST_VERSION);
    s_list_version = version_tuple ? version_tuple->value->int32 : 0;
    persist_write_int(PERSIST_KEY_LIST_VERSION, s_list_version);

    Tuple *sync_enabled_tuple = dict_find(iterator, KEY_SYNC_ENABLED);
    if (sync_enabled_tuple != NULL) {
      s_sync_enabled = sync_enabled_tuple->value->int32 != 0;
      persist_write_bool(PERSIST_KEY_SYNC_ENABLED, s_sync_enabled);
    }

    if (is_switch) {
      lists_set_active_id(switch_tuple->value->uint8);
    }
    checklist_save();
  }

  // Check for settings changes
  Tuple *settings_tuple = dict_find(iterator, KEY_SETTINGS);

  if (settings_tuple != NULL) {
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Settings received: %d",
            (int)settings_tuple->value->int32);
    settings_apply_bitfield(settings_tuple->value->int32);
    settings_save();
  }

  // notify the main screen, in case something changed
  message_processed_callback();

  // (after the screens were refreshed, so the new list is ready to show)
  if (is_switch && s_pending_switch != 0) {
    finish_switch(true);
  }
}

void inbox_dropped_callback(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Message dropped!");
}

void outbox_failed_callback(DictionaryIterator *iterator,
                            AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox send failed! %d %d %d", reason,
          APP_MSG_SEND_TIMEOUT, APP_MSG_SEND_REJECTED);

  // the phone never got the switch request
  if (s_pending_switch != 0 && dict_find(iterator, KEY_SWITCH_TO) != NULL) {
    finish_switch(false);
  }
}

void outbox_sent_callback(DictionaryIterator *iterator, void *context) {
  APP_LOG(APP_LOG_LEVEL_INFO, "Outbox send success!");
}

static void change_timer_callback(void *context) {
  s_change_timer = NULL;
  send_current_state_to_phone(STATE_REASON_CHANGED);
}

void messaging_notify_list_changed() {
  if (!s_sync_enabled) {
    return;
  }

  if (s_change_timer != NULL) {
    app_timer_reschedule(s_change_timer, CHANGE_NOTIFY_DELAY_MS);
  } else {
    s_change_timer =
        app_timer_register(CHANGE_NOTIFY_DELAY_MS, change_timer_callback, NULL);
  }
}

// JSON serialization functions for two-way sync
//
// The list is exchanged as a compact JSON array in both directions:
//   [{"n":"Milk","c":0},{"n":"Eggs","c":1}]
// Items of a synced list also carry their remote id: {"n":"Milk","c":0,"i":3},
// and items that can't be deleted (Cookidoo recipe ingredients) "l":1
// Only '"' and '\\' are escaped by the watch; the parser below also accepts the
// escapes JSON.stringify may produce on the phone side.

// Returns the number of bytes needed to write the name as a JSON string body
static int escaped_length(const char *name) {
  int len = 0;
  for (int i = 0; name[i] != '\0'; i++) {
    len += (name[i] == '"' || name[i] == '\\') ? 2 : 1;
  }
  return len;
}

void serialize_current_state() {
  int num_items = checklist_get_num_items();
  int pos = 0;
  int max_pos = sizeof(s_current_state_buffer) - 2; // room for ']' and '\0'

  s_current_state_buffer[pos++] = '[';

  for (int i = 0; i < num_items; i++) {
    ChecklistItem *item = checklist_get_item_by_id(i);

    // {"n":"<name>","c":0} plus a separating comma and ,"i":<id>(,"l":1); only whole
    // items are written, so a list that doesn't fit is cut short rather than
    // mangled
    char id_buf[20] = "";
    if (item->remote_id > 0) {
      snprintf(id_buf, sizeof(id_buf), item->is_locked ? ",\"i\":%d,\"l\":1" : ",\"i\":%d",
               item->remote_id);
    }
    int id_len = strlen(id_buf);
    int needed = (i > 0 ? 1 : 0) + 14 + escaped_length(item->name) + id_len;
    if (pos + needed > max_pos) {
      APP_LOG(APP_LOG_LEVEL_WARNING, "State too large; sent %d of %d items",
              i, num_items);
      break;
    }

    if (i > 0) {
      s_current_state_buffer[pos++] = ',';
    }

    memcpy(&s_current_state_buffer[pos], "{\"n\":\"", 6);
    pos += 6;

    for (int j = 0; item->name[j] != '\0'; j++) {
      if (item->name[j] == '"' || item->name[j] == '\\') {
        s_current_state_buffer[pos++] = '\\';
      }
      s_current_state_buffer[pos++] = item->name[j];
    }

    memcpy(&s_current_state_buffer[pos], "\",\"c\":", 6);
    pos += 6;
    s_current_state_buffer[pos++] = item->is_checked ? '1' : '0';
    memcpy(&s_current_state_buffer[pos], id_buf, id_len);
    pos += id_len;
    s_current_state_buffer[pos++] = '}';
  }

  s_current_state_buffer[pos++] = ']';
  s_current_state_buffer[pos] = '\0';
}

bool send_current_state_to_phone(int reason) {
  serialize_current_state();

  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);

  if (result == APP_MSG_OK && iter) {
    dict_write_cstring(iter, KEY_CURRENT_STATE, s_current_state_buffer);
    dict_write_int32(iter, KEY_SETTINGS, settings_to_bitfield());

    // lets the config page tell if the list had to be cut short
    dict_write_int32(iter, KEY_TOTAL_ITEMS, checklist_get_num_items());

    dict_write_int32(iter, KEY_REQUEST_STATE, reason);
    dict_write_int32(iter, KEY_LIST_VERSION, s_list_version);
    dict_write_uint8(iter, KEY_LIST_ID, lists_get_active_id());
    if (reason == STATE_REASON_SWITCH) {
      dict_write_uint8(iter, KEY_SWITCH_TO, s_pending_switch);
    }
    return app_message_outbox_send() == APP_MSG_OK;
  }

  if (reason == STATE_REASON_CHANGED && s_change_timer == NULL) {
    // the outbox is busy (e.g. still sending the previous message); a change
    // must not be dropped, so try again shortly
    s_change_timer =
        app_timer_register(SEND_RETRY_DELAY_MS, change_timer_callback, NULL);
  }
  return false;
}

bool messaging_request_switch(uint8_t list_id, SwitchHandler handler) {
  if (s_pending_switch != 0 || !connection_service_peek_pebble_app_connection()) {
    return false;
  }

  // the list goes along with the request, so a pending change report isn't
  // needed any more
  if (s_change_timer != NULL) {
    app_timer_cancel(s_change_timer);
    s_change_timer = NULL;
  }

  s_pending_switch = list_id;
  if (!send_current_state_to_phone(STATE_REASON_SWITCH)) {
    // the outbox is busy; the user can try again
    s_pending_switch = 0;
    return false;
  }
  s_switch_handler = handler;
  s_switch_timer =
      app_timer_register(SWITCH_TIMEOUT_MS, switch_timeout_callback, NULL);
  return true;
}

uint8_t messaging_get_pending_switch() {
  return s_pending_switch;
}

// Reads a JSON string body starting just after its opening quote into buf
// (truncating if needed), and returns a pointer just past the closing quote
static const char *read_json_string(const char *ptr, char *buf, int buf_size) {
  int len = 0;

  while (*ptr && *ptr != '"') {
    char c = *ptr++;

    if (c == '\\' && *ptr) {
      char escaped = *ptr++;
      switch (escaped) {
        case 'n': case 'r': case 't': c = ' '; break;
        case 'u': c = '?'; ptr += (strlen(ptr) >= 4) ? 4 : strlen(ptr); break;
        default: c = escaped; break; // '"', '\\', '/'
      }
    }

    if (len < buf_size - 1) {
      buf[len++] = c;
    }
  }

  buf[len] = '\0';
  utf8_trim_partial(buf);

  return (*ptr == '"') ? ptr + 1 : ptr;
}

void process_item_updates(const char *json_string) {
  checklist_clear();

  const char *ptr = json_string;

  while ((ptr = strstr(ptr, "\"n\":\"")) != NULL) {
    char name[MAX_NAME_LENGTH];
    ptr = read_json_string(ptr + 5, name, sizeof(name));

    const char *checked = strstr(ptr, "\"c\":");
    if (!checked) {
      break;
    }
    ptr = checked + 4;
    bool is_checked = (*ptr == '1' || *ptr == 't');

    // the optional remote id belongs to this item only if it comes before
    // the next item's name
    int remote_id = 0;
    const char *id = strstr(ptr, "\"i\":");
    const char *next = strstr(ptr, "\"n\":\"");
    if (id && (!next || id < next)) {
      remote_id = atoi(id + 4);
      if (remote_id < 0 || remote_id > MAX_REMOTE_ID) {
        remote_id = 0;
      }
    }

    // "l":1 = can be checked but not deleted (a Cookidoo recipe ingredient);
    // only meaningful for synced items
    const char *locked = strstr(ptr, "\"l\":");
    bool is_locked = remote_id > 0 && locked && (!next || locked < next) &&
                     locked[4] == '1';

    // only mark the item checked if it was actually added (the list may be
    // full, or the name may have been blank)
    int num_items_before = checklist_get_num_items();
    checklist_add_items(name);

    if (checklist_get_num_items() > num_items_before) {
      checklist_get_item_by_id(num_items_before)->remote_id = remote_id;
      checklist_get_item_by_id(num_items_before)->is_locked = is_locked;
      if (is_checked) {
        checklist_item_toggle_checked(num_items_before);
      }
    }
  }

  APP_LOG(APP_LOG_LEVEL_DEBUG, "Processed item updates");
}
