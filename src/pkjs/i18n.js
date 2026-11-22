// The phone side's texts (shown on the config page) come in English and
// German, in the watch's language like the watch's own texts, or the phone's
// if the watch isn't known yet.

function language() {
  var lang = '';
  try {
    var info = Pebble.getActiveWatchInfo && Pebble.getActiveWatchInfo();
    lang = (info && info.language) || '';
  } catch (e) { /* no watch info yet */ }
  if (!lang && typeof navigator !== 'undefined') lang = navigator.language || '';
  return /^de/i.test(lang) ? 'de' : 'en';
}

// picks the text for the language: t('Not connected', 'Nicht verbunden')
function t(en, de) {
  return language() === 'de' ? de : en;
}

module.exports = { language: language, t: t };
