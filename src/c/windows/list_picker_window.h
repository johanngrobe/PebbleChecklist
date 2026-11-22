#pragma once

#include <pebble.h>

// The list of the user's checklists. It sits below the checklist window, so
// Back from a list leads here; picking a list asks the phone for it.

void list_picker_window_push(bool animated);
void list_picker_window_refresh();

// Whether the picker is in the window stack
bool list_picker_window_is_open();
