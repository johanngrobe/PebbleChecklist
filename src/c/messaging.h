#pragma once
#include <pebble.h>

#define KEY_ITEMS_TO_ADD 0
#define KEY_REQUEST_STATE 1
#define KEY_CURRENT_STATE 2
#define KEY_ITEM_UPDATES 3
#define KEY_SETTINGS 4
#define KEY_TOTAL_ITEMS 5
// phone -> watch: 1 if the list is synced with an online list (Cookidoo), so
// the watch should report its changes; 0 otherwise. Persisted.
#define KEY_SYNC_ENABLED 6
// the version of the synced list, sent along with KEY_ITEM_UPDATES by the
// phone and echoed back with KEY_CURRENT_STATE, so the phone knows which
// synced list the item ids ("i") refer to. Persisted.
#define KEY_LIST_VERSION 7
// phone -> watch: the directory of lists (see lists.h). Persisted.
#define KEY_LISTS 8
// which list the items belong to: sent with KEY_CURRENT_STATE by the watch
// and with KEY_ITEM_UPDATES by the phone (the watch ignores updates for a
// list it doesn't show, unless KEY_SWITCH_TO is set as well)
#define KEY_LIST_ID 9
// watch -> phone (with STATE_REASON_SWITCH): the list to switch to;
// phone -> watch with KEY_ITEM_UPDATES: show this list (these are its items);
// phone -> watch with KEY_REQUEST_STATE = STATE_REASON_SWITCH: please switch
#define KEY_SWITCH_TO 10

// why the watch is sending its list (sent as KEY_REQUEST_STATE along with
// KEY_CURRENT_STATE). The phone asks with the same values.
#define STATE_REASON_CONFIG 1   // for the config page
#define STATE_REASON_SYNC 2     // the phone is about to sync
#define STATE_REASON_CHANGED 3  // the list was changed on the watch
#define STATE_REASON_SWITCH 4   // switching lists (see KEY_SWITCH_TO)

#define INBOX_SIZE 4096
#define OUTBOX_SIZE 4096

// The largest list JSON that fits in a message (either direction), leaving
// room for the dictionary overhead and the other tuples. The config page uses
// the same limit (LIST_JSON_MAX_BYTES), so keep the two in sync.
#define LIST_JSON_MAX_BYTES 4000

void messaging_init(void (*message_processed_callback)(void));
void inbox_received_callback(DictionaryIterator *iterator, void *context);
void inbox_dropped_callback(AppMessageResult reason, void *context);
void outbox_failed_callback(DictionaryIterator *iterator,
                            AppMessageResult reason, void *context);
void outbox_sent_callback(DictionaryIterator *iterator, void *context);

// Two-way sync functions
void serialize_current_state();
// Returns false if the message couldn't be sent (e.g. the outbox is busy)
bool send_current_state_to_phone(int reason);

// Lets the phone know the list was changed on the watch (if it's synced), after
// a short delay so a burst of changes is sent as one message
void messaging_notify_list_changed();
void process_item_updates(const char *json_string);

// Called when a switch finishes: success is false if the phone couldn't be
// reached or didn't answer in time
typedef void (*SwitchHandler)(bool success);

// Asks the phone for another list (sending the current one along, so its
// changes are kept). The handler (may be NULL) is called when the new list
// has arrived or the switch failed. Returns false if the request couldn't be
// sent at all.
bool messaging_request_switch(uint8_t list_id, SwitchHandler handler);

// The list being switched to, or 0
uint8_t messaging_get_pending_switch();
