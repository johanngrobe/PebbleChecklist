#pragma once
#include <pebble.h>

// The watch's texts come in English and German; German is used when the
// watch's language (set in the Pebble app) is German.
bool i18n_is_german(void);

// picks the text for the watch's language: TR("Clear completed", "Erledigte löschen")
#define TR(en, de) (i18n_is_german() ? (de) : (en))
