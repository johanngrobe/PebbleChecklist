#pragma once

#include <pebble.h>
#include <string.h>

#define MAX_NAME_LENGTH 90
#define MAX_CHECKLIST_ITEMS 52

typedef struct ChecklistItem {
  // the name displayed for the item
  char name[MAX_NAME_LENGTH];

  // is the item checked?
  bool is_checked;

  // which item of the phone's last synced list (e.g. the Cookidoo shopping
  // list) this is, 1-based; 0 for items that were added on the watch and
  // haven't been synced yet. Persisted with the item (this byte used to be the
  // never-used "sublist_id", so older saved lists load as all zeros).
  uint8_t remote_id : 7;

  // the item can be checked but not deleted (a Cookidoo recipe ingredient);
  // shares remote_id's byte, so the stored layout is unchanged
  uint8_t is_locked : 1;
} ChecklistItem;

// the largest remote_id that fits
#define MAX_REMOTE_ID 127

// Loads the stored list (call once at startup) and saves it (at exit)
extern void checklist_init();
extern void checklist_deinit();

/*
 * Writes the list to persistent storage now (e.g. after it was replaced)
 */
extern void checklist_save();

/*
 * Returns the total number of checklist items
 */
extern int checklist_get_num_items();

/*
 * Returns the total number of checked items
 */
extern int checklist_get_num_items_checked();

/*
 * Adds one or more items to the list.
 * Each item is identified by splitting the "name" string by a specific
 * character
 */
extern void checklist_add_items(char *name);

/*
 * Toggles whether or not the specified item is checked
 */
extern void checklist_item_toggle_checked(int id);

/*
 * Returns the number of checked items that "clear completed" would delete
 * (checked items that aren't locked)
 */
extern int checklist_get_num_items_deletable();

/*
 * Deletes all completed items from the checklist, except locked ones
 * Returns the number of items deleted
 */
extern int checklist_delete_completed_items();

/*
 * Clears all items from the checklist
 */
extern void checklist_clear();

/*
 * Returns the checklist item referred to by the given id
 */
extern ChecklistItem *checklist_get_item_by_id(int id);
