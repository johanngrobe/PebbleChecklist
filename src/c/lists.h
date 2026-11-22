#pragma once

#include <pebble.h>

// The directory of the user's lists. The phone keeps every list's items; the
// watch stores only the list it shows (see checklist.c) plus this directory,
// so the list picker works without the phone.

#define MAX_LISTS 8
// bytes including the terminating NUL; the phone limits names to fit
#define LIST_NAME_LENGTH 30

// list types, as the phone sends them
#define LIST_TYPE_LOCAL 'l'
#define LIST_TYPE_COOKIDOO 'c'
#define LIST_TYPE_HOME_ASSISTANT 'h'

typedef struct {
  uint8_t id;
  char type;
  char name[LIST_NAME_LENGTH];
} ListInfo;

void lists_init();

int lists_get_count();
ListInfo *lists_get(int index);

// Returns the index of the list with the given id, or -1
int lists_index_of(uint8_t id);

// The list the watch shows (its items are the ones in checklist.c)
uint8_t lists_get_active_id();
void lists_set_active_id(uint8_t id);

// Returns the active list's name, or NULL if the directory doesn't have it
const char *lists_get_active_name();

// Replaces the directory with one from the phone: one line per list,
// "<id>\t<type>\t<name>"
void lists_apply_directory(const char *encoded);

// What to call a list type
const char *lists_type_label(char type);
