#include "i18n.h"

bool i18n_is_german(void) {
  // the locale can't change while the app runs, so it's only looked up once
  static int8_t s_german = -1;
  if (s_german < 0) {
    const char *locale = i18n_get_system_locale();
    s_german = locale != NULL && strncmp(locale, "de", 2) == 0;
  }
  return s_german;
}
