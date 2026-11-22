/**
 * The list picker: shows the user's lists (from the directory the phone
 * sends) and opens the one that's picked.
 */

#include "../i18n.h"
#include "list_picker_window.h"
#include "../lists.h"
#include "../messaging.h"
#include "checklist_window.h"
#include "dialog_message_window.h"

static Window *s_window;
static MenuLayer *s_menu_layer;
static StatusBarLayer *s_status_bar;
static TextLayer *s_empty_layer;

static void update_empty_layer() {
  if (s_empty_layer != NULL) {
    layer_set_hidden(text_layer_get_layer(s_empty_layer), lists_get_count() > 0);
  }
}

static uint16_t get_num_rows_callback(MenuLayer *menu_layer,
                                      uint16_t section_index, void *context) {
  return lists_get_count();
}

static int16_t get_cell_height_callback(MenuLayer *menu_layer,
                                        MenuIndex *cell_index, void *context) {
  return PBL_IF_ROUND_ELSE(60, 52);
}

static void draw_row_callback(GContext *ctx, const Layer *cell_layer,
                              MenuIndex *cell_index, void *context) {
  ListInfo *list = lists_get(cell_index->row);

  const char *subtitle = lists_type_label(list->type);
  if (messaging_get_pending_switch() == list->id) {
    subtitle = TR("Loading...", "Wird geladen …");
  } else if (list->id == lists_get_active_id()) {
    // the list the watch has; it opens without the phone
    switch (list->type) {
      case LIST_TYPE_COOKIDOO: subtitle = TR("Cookidoo · open", "Cookidoo · aktiv"); break;
      case LIST_TYPE_HOME_ASSISTANT: subtitle = TR("Home Assistant · open", "Home Assistant · aktiv"); break;
      default: subtitle = TR("Local list · open", "Lokale Liste · aktiv"); break;
    }
  }

  menu_cell_basic_draw(ctx, cell_layer, list->name, subtitle, NULL);
}

static void switch_done(bool success) {
  if (s_menu_layer != NULL) {
    menu_layer_reload_data(s_menu_layer);
  }
  if (!success) {
    dialog_settings_window_push(TR("Could not load the list. Is your phone connected?",
                                   "Die Liste konnte nicht geladen werden. Ist dein Handy verbunden?"));
    return;
  }
  // only open the list if the picker is still what the user is looking at
  if (s_window != NULL && window_stack_get_top_window() == s_window) {
    checklist_window_push();
  }
}

static void select_callback(MenuLayer *menu_layer, MenuIndex *cell_index,
                            void *context) {
  if (cell_index->row >= lists_get_count() || messaging_get_pending_switch()) {
    return;
  }

  uint8_t id = lists_get(cell_index->row)->id;
  if (id == lists_get_active_id()) {
    checklist_window_push();
    return;
  }

  if (!messaging_request_switch(id, switch_done)) {
    dialog_settings_window_push(TR("Connect your phone to switch lists.",
                                   "Verbinde dein Handy, um die Liste zu wechseln."));
    return;
  }
  menu_layer_reload_data(menu_layer);
}

static void window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect window_bounds = layer_get_bounds(window_layer);

#ifdef PBL_ROUND
  GRect bounds = window_bounds;
#else
  GRect bounds = GRect(0, STATUS_BAR_LAYER_HEIGHT, window_bounds.size.w,
                       window_bounds.size.h - STATUS_BAR_LAYER_HEIGHT);
#endif

  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_center_focused(s_menu_layer, PBL_IF_ROUND_ELSE(true, false));
  menu_layer_set_callbacks(s_menu_layer, NULL,
                           (MenuLayerCallbacks){
                               .get_num_rows = get_num_rows_callback,
                               .get_cell_height = get_cell_height_callback,
                               .draw_row = draw_row_callback,
                               .select_click = select_callback,
                           });
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  window_set_background_color(window, BG_COLOR);
  menu_layer_set_normal_colors(s_menu_layer, BG_COLOR, GColorBlack);
  menu_layer_set_highlight_colors(s_menu_layer, GColorArmyGreen, GColorWhite);
  layer_add_child(window_layer, menu_layer_get_layer(s_menu_layer));

  int index = lists_index_of(lists_get_active_id());
  if (index > 0) {
    menu_layer_set_selected_index(s_menu_layer, MenuIndex(0, index),
                                  MenuRowAlignCenter, false);
  }

  s_status_bar = status_bar_layer_create();
  status_bar_layer_set_colors(s_status_bar, BG_COLOR, GColorBlack);
  layer_add_child(window_layer, status_bar_layer_get_layer(s_status_bar));

  s_empty_layer = text_layer_create(
      GRect(10, window_bounds.size.h / 2 - 30, window_bounds.size.w - 20, 60));
  text_layer_set_text(s_empty_layer, TR("No lists", "Keine Listen"));
  text_layer_set_background_color(s_empty_layer, GColorClear);
  text_layer_set_text_alignment(s_empty_layer, GTextAlignmentCenter);
  text_layer_set_font(s_empty_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  layer_add_child(window_layer, text_layer_get_layer(s_empty_layer));
  update_empty_layer();
}

static void window_unload(Window *window) {
  menu_layer_destroy(s_menu_layer);
  s_menu_layer = NULL;
  status_bar_layer_destroy(s_status_bar);
  text_layer_destroy(s_empty_layer);
  s_empty_layer = NULL;
  window_destroy(window);
  s_window = NULL;
}

void list_picker_window_push(bool animated) {
  if (s_window == NULL) {
    s_window = window_create();
    window_set_window_handlers(s_window, (WindowHandlers){
                                             .load = window_load,
                                             .unload = window_unload,
                                         });
  }
  window_stack_push(s_window, animated);
}

void list_picker_window_refresh() {
  if (s_menu_layer == NULL) {
    return;
  }
  menu_layer_reload_data(s_menu_layer);
  uint16_t count = lists_get_count();
  MenuIndex index = menu_layer_get_selected_index(s_menu_layer);
  if (count > 0 && index.row >= count) {
    menu_layer_set_selected_index(s_menu_layer, MenuIndex(0, count - 1),
                                  MenuRowAlignCenter, false);
  }
  update_empty_layer();
}

bool list_picker_window_is_open() {
  return s_window != NULL && window_stack_contains_window(s_window);
}
