#include "i18n.h"
#include "lists.h"
#include "util.h"
#include <stdlib.h>
#include <string.h>

// persistent storage keys
#define PERSIST_KEY_LISTS_COUNT 54
#define PERSIST_KEY_LISTS_DATA 55
#define PERSIST_KEY_ACTIVE_LIST 56

// the directory has to fit in a single persist value
_Static_assert(sizeof(ListInfo) * MAX_LISTS <= PERSIST_DATA_MAX_LENGTH,
               "list directory too large to persist");

static ListInfo s_lists[MAX_LISTS];
static int s_count;
// lists set up before there were several of them are list 1 (see the phone's
// lists.js), so that's the default
static uint8_t s_active_id = 1;

void lists_init() {
  s_count = persist_read_int(PERSIST_KEY_LISTS_COUNT);
  if (s_count < 0 || s_count > MAX_LISTS) {
    s_count = 0;
  }
  if (s_count > 0) {
    persist_read_data(PERSIST_KEY_LISTS_DATA, s_lists, sizeof(ListInfo) * s_count);
    for (int i = 0; i < s_count; i++) {
      s_lists[i].name[LIST_NAME_LENGTH - 1] = '\0';
    }
  }
  if (persist_exists(PERSIST_KEY_ACTIVE_LIST)) {
    s_active_id = persist_read_int(PERSIST_KEY_ACTIVE_LIST);
  }
}

int lists_get_count() {
  return s_count;
}

ListInfo *lists_get(int index) {
  return &s_lists[index];
}

int lists_index_of(uint8_t id) {
  for (int i = 0; i < s_count; i++) {
    if (s_lists[i].id == id) {
      return i;
    }
  }
  return -1;
}

uint8_t lists_get_active_id() {
  return s_active_id;
}

void lists_set_active_id(uint8_t id) {
  s_active_id = id;
  persist_write_int(PERSIST_KEY_ACTIVE_LIST, id);
}

const char *lists_get_active_name() {
  int index = lists_index_of(s_active_id);
  return index >= 0 ? s_lists[index].name : NULL;
}

void lists_apply_directory(const char *encoded) {
  int count = 0;
  const char *line = encoded;

  while (*line && count < MAX_LISTS) {
    const char *end = strchr(line, '\n');
    if (end == NULL) {
      end = line + strlen(line);
    }

    // <id>\t<type>\t<name>
    const char *type = strchr(line, '\t');
    if (type != NULL && type < end && type + 2 < end && type[2] == '\t') {
      int id = atoi(line);
      if (id > 0 && id <= 255) {
        ListInfo *list = &s_lists[count++];
        list->id = id;
        list->type = type[1];
        const char *name = type + 3;
        int len = end - name;
        if (len > LIST_NAME_LENGTH - 1) {
          len = LIST_NAME_LENGTH - 1;
        }
        memcpy(list->name, name, len);
        list->name[len] = '\0';
        utf8_trim_partial(list->name);
      }
    }

    line = *end ? end + 1 : end;
  }

  s_count = count;
  persist_write_int(PERSIST_KEY_LISTS_COUNT, s_count);
  if (s_count > 0) {
    persist_write_data(PERSIST_KEY_LISTS_DATA, s_lists, sizeof(ListInfo) * s_count);
  }
}

const char *lists_type_label(char type) {
  switch (type) {
    case LIST_TYPE_COOKIDOO: return "Cookidoo";
    case LIST_TYPE_HOME_ASSISTANT: return "Home Assistant";
    default: return TR("Local list", "Lokale Liste");
  }
}
