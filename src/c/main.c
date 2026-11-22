#include "checklist.h"
#include "lists.h"
#include "messaging.h"
#include "settings.h"
#include "windows/checklist_window.h"
#include "windows/list_picker_window.h"
#include <pebble.h>

// something arrived from the phone: refresh whatever is shown
static void message_processed() {
  checklist_window_refresh();
  list_picker_window_refresh();
}

static void init() {
  settings_init();
  lists_init();
  checklist_init();
#ifdef PBL_TOUCH
  app_touch_navigation_enable(true);
#endif
  // the app opens on the list it showed last; with several lists, the list
  // picker is below it (Back leads there)
  if (lists_get_count() > 1) {
    list_picker_window_push(false);
  }
  checklist_window_push();
  messaging_init(message_processed);
}

static void deinit() { checklist_deinit(); }

int main(void) {
  init();
  app_event_loop();
  deinit();
}
