// Translations for the config page. Texts are written in English throughout
// (in config.html and the scripts); GERMAN maps them to German. The language is
// the watch's (window.LANGUAGE, from the phone), or the phone's if unknown.
//
//   t("Room for {count} more items.", { count: 3 })
//
// Static texts in config.html (text, placeholder, aria-label, title) are
// translated by translatePage() when the page opens.

const GERMAN = {
  // config.html
  "Checklist": "Checkliste",
  "Settings": "Einstellungen",
  "More options": "Weitere Optionen",
  "Clear completed": "Erledigte löschen",
  "Lists": "Listen",
  "Export": "Exportieren",
  "Import": "Importieren",
  "Save": "Speichern",
  "Show on watch": "Auf der Uhr zeigen",
  "Add new item...": "Neuer Eintrag …",
  "Add item": "Eintrag hinzufügen",
  "Apply import": "Import übernehmen",
  "Show voice input button": "Taste für Spracheingabe anzeigen",
  "Start voice input when opened via quick launch": "Spracheingabe starten, wenn die App per Schnellstart geöffnet wird",
  "Wrap-around scrolling": "Endlos scrollen",
  "Use larger fonts": "Größere Schrift verwenden",
  "Move checked items to the bottom of the list": "Abgehakte Einträge ans Ende der Liste verschieben",
  "Done": "Fertig",
  "Sign in to add your Cookidoo shopping list to your lists. Checking items off on your watch also checks them off in Cookidoo.":
    "Melde dich an, um deine Cookidoo-Einkaufsliste zu deinen Listen hinzuzufügen. Was du auf der Uhr abhakst, wird auch in Cookidoo abgehakt.",
  "Country": "Land",
  "Language": "Sprache",
  "Email": "E-Mail",
  "Password": "Passwort",
  "Your password is only sent to Cookidoo. Your other lists stay as they are.":
    "Dein Passwort wird nur an Cookidoo gesendet. Deine anderen Listen bleiben unverändert.",
  "Cancel": "Abbrechen",
  "Sign in": "Anmelden",
  "Recipe ingredients can only be checked off. Items you add on your watch or here are added to Cookidoo as extra items.":
    "Rezeptzutaten können nur abgehakt werden. Was du auf der Uhr oder hier hinzufügst, wird in Cookidoo als zusätzlicher Artikel angelegt.",
  "Your Cookidoo session has expired.": "Deine Cookidoo-Sitzung ist abgelaufen.",
  "Sign out": "Abmelden",
  "Sign in again": "Erneut anmelden",
  "New list": "Neue Liste",
  "Name": "Name",
  "Type": "Typ",
  "Checklist (only on your watch and phone)": "Checkliste (nur auf Uhr und Handy)",
  "Home Assistant to-do list": "Home-Assistant-To-do-Liste",
  "Cookidoo shopping list": "Cookidoo-Einkaufsliste",
  "Delete list": "Liste löschen",
  "Every to-do list in Home Assistant, like the Shopping List, is added to your lists and synced. Hide the ones you don't need on your watch in Lists.":
    "Jede To-do-Liste in Home Assistant, z. B. die Einkaufsliste, wird zu deinen Listen hinzugefügt und synchronisiert. Was du auf der Uhr nicht brauchst, kannst du unter Listen ausblenden.",
  "Home Assistant URL": "Home-Assistant-URL",
  "Long-lived access token": "Langlebiger Zugangstoken",
  "Create a token in Home Assistant: your profile → Security → Long-lived access tokens. Your phone connects when you save. Home Assistant 2024.8 or later is needed.":
    "Erstelle einen Token in Home Assistant: dein Profil → Sicherheit → Langlebige Zugangstoken. Dein Handy verbindet sich beim Speichern. Home Assistant 2024.8 oder neuer wird benötigt.",
  "Disconnect": "Trennen",
  "Connect": "Verbinden",

  // config.js
  "List is full": "Die Liste ist voll",
  "This list is too long to send to your watch. Remove some items or shorten their names to save.":
    "Diese Liste ist zu lang für deine Uhr. Entferne Einträge oder kürze ihre Namen, um zu speichern.",
  "List is full ({max} items).": "Die Liste ist voll ({max} Einträge).",
  "Room for {count} more item.": "Platz für noch {count} Eintrag.",
  "Room for {count} more items.": "Platz für noch {count} Einträge.",
  "Only {count} of the {total} items could be loaded.": "Nur {count} von {total} Einträgen konnten geladen werden.",
  "Saving will remove the rest.": "Beim Speichern werden die übrigen entfernt.",
  "The others stay online.": "Die übrigen bleiben online erhalten.",
  "Recipe ingredient: can be checked, but not renamed or deleted":
    "Rezeptzutat: kann abgehakt, aber nicht umbenannt oder gelöscht werden",
  "Delete": "Löschen",
  "Paste plaintext list or an exported CSV": "Liste als Text oder exportierte CSV einfügen",
  "Only {count} of {total} items were imported. Lists are limited to {max} items.":
    "Nur {count} von {total} Einträgen wurden importiert. Listen können höchstens {max} Einträge haben.",

  // lists.js
  "{type} · shown on your watch": "{type} · auf deiner Uhr",
  "{type} · shown on your watch after saving": "{type} · nach dem Speichern auf deiner Uhr",
  "{type} · on watch": "{type} · auf der Uhr",
  "Cookidoo will be disconnected when you save. This list will be kept as a checklist.":
    "Cookidoo wird beim Speichern getrennt. Diese Liste bleibt als Checkliste erhalten.",
  "Your Cookidoo session has expired. Tap here to sign in again.":
    "Deine Cookidoo-Sitzung ist abgelaufen. Tippe hier, um dich erneut anzumelden.",
  "Last Cookidoo sync failed: {error}": "Letzte Cookidoo-Synchronisierung fehlgeschlagen: {error}",
  "Synced with your Cookidoo shopping list ({email}).": "Synchronisiert mit deiner Cookidoo-Einkaufsliste ({email}).",
  "Home Assistant will be disconnected when you save. This list will be kept as a checklist.":
    "Home Assistant wird beim Speichern getrennt. Diese Liste bleibt als Checkliste erhalten.",
  "Home Assistant rejected the access token. Tap here to enter a new one.":
    "Home Assistant hat den Zugangstoken abgelehnt. Tippe hier, um einen neuen einzugeben.",
  "Last Home Assistant sync failed: {error}": "Letzte Home-Assistant-Synchronisierung fehlgeschlagen: {error}",
  "Synced with {entity} in Home Assistant.": "Synchronisiert mit {entity} in Home Assistant.",
  "Last synced {time}.": "Zuletzt synchronisiert: {time}.",
  "Edit {name}": "{name} bearbeiten",
  "A new to-do list is created in Home Assistant when you save, and synced both ways. If Home Assistant can't be reached right now (e.g. away from home), it's created as soon as it can be.":
    "Beim Speichern wird eine neue To-do-Liste in Home Assistant erstellt und in beide Richtungen synchronisiert. Ist Home Assistant gerade nicht erreichbar (z. B. unterwegs), wird sie erstellt, sobald es wieder geht.",
  "Home Assistant already has a to-do list with this name.": "Home Assistant hat schon eine To-do-Liste mit diesem Namen.",
  "This list will be created in Home Assistant when you save.": "Diese Liste wird beim Speichern in Home Assistant erstellt.",
  "Waiting for Home Assistant: this list is created there as soon as Home Assistant can be reached. Until then it's kept on your watch and phone.":
    "Warten auf Home Assistant: Die Liste wird dort erstellt, sobald Home Assistant erreichbar ist. Bis dahin bleibt sie auf Uhr und Handy gespeichert.",
  "{type} · hidden on your watch": "{type} · auf der Uhr ausgeblendet",
  "{type} · hidden": "{type} · ausgeblendet",
  "Show {name} on the watch": "{name} auf der Uhr einblenden",
  "Hide {name} on the watch": "{name} auf der Uhr ausblenden",
  "Your watch can show up to {max} lists. Hide one to add another.":
    "Deine Uhr kann bis zu {max} Listen zeigen. Blende eine aus, um eine weitere hinzuzufügen.",
  "Your watch can show up to {max} lists. Hide another one first.":
    "Deine Uhr kann bis zu {max} Listen zeigen. Blende zuerst eine andere aus.",
  "At least one list has to be shown on your watch.": "Mindestens eine Liste muss auf deiner Uhr angezeigt werden.",
  "Home Assistant's to-do lists are added automatically. Hide the ones you don't need instead of deleting them.":
    "Die To-do-Listen aus Home Assistant werden automatisch hinzugefügt. Blende nicht benötigte aus, statt sie zu löschen.",
  "You can have up to {max} lists.": "Du kannst bis zu {max} Listen haben.",
  "A plain checklist, stored on your watch and phone.": "Eine einfache Checkliste, gespeichert auf Uhr und Handy.",
  "Edit list": "Liste bearbeiten",
  "Tap again to delete": "Zum Löschen erneut tippen",
  "Enter a name for the list.": "Gib einen Namen für die Liste ein.",

  // homeassistant.js
  "Home Assistant will be disconnected when you save.": "Home Assistant wird beim Speichern getrennt.",
  "Will connect to {url} when you save.": "Verbindet sich beim Speichern mit {url}.",
  "Connected to {url}, but: {error}": "Verbunden mit {url}, aber: {error}",
  "Connected to {url} ({count} to-do list).": "Verbunden mit {url} ({count} To-do-Liste).",
  "Connected to {url} ({count} to-do lists).": "Verbunden mit {url} ({count} To-do-Listen).",
  "Leave empty to keep the current token": "Leer lassen, um den aktuellen Token zu behalten",
  "Enter the address of your Home Assistant, like http://homeassistant.local:8123.":
    "Gib die Adresse deines Home Assistant ein, z. B. http://homeassistant.local:8123.",
  "Enter a long-lived access token.": "Gib einen langlebigen Zugangstoken ein.",
  "Enter the access token for this Home Assistant.": "Gib den Zugangstoken für diesen Home Assistant ein.",
  "This doesn't look like a Home Assistant access token. Copy the long-lived access token Home Assistant showed when you created it.":
    "Das sieht nicht wie ein Home-Assistant-Zugangstoken aus. Kopiere den langlebigen Zugangstoken, den Home Assistant beim Erstellen angezeigt hat.",

  // cookidoo.js
  "Could not reach Cookidoo. Check your connection and try again.":
    "Cookidoo ist nicht erreichbar. Prüfe deine Verbindung und versuche es erneut.",
  "Cookidoo did not respond. Please try again.": "Cookidoo antwortet nicht. Bitte versuche es erneut.",
  "Cookidoo sign-in is unavailable right now ({status}).": "Die Cookidoo-Anmeldung ist gerade nicht verfügbar ({status}).",
  "Wrong email or password.": "E-Mail-Adresse oder Passwort ist falsch.",
  "Sign-in was not completed{detail}. If your account needs an extra step (like accepting new terms), finish it in the Cookidoo app or website, then try again.":
    "Die Anmeldung wurde nicht abgeschlossen{detail}. Falls dein Konto einen weiteren Schritt braucht (z. B. neue Bedingungen akzeptieren), schließe ihn in der Cookidoo-App oder auf der Website ab und versuche es dann erneut.",
  "Cookidoo did not accept the sign-in ({status}).": "Cookidoo hat die Anmeldung nicht akzeptiert ({status}).",
  "Signed in as {email} on {host}.": "Angemeldet als {email} auf {host}.",
  "Enter your Cookidoo email and password.": "Gib deine Cookidoo-E-Mail-Adresse und dein Passwort ein.",
  "Signing in…": "Anmeldung …",
  "Signed in!": "Angemeldet!"
};

// "de" or "en"
function pageLanguage() {
  const lang = /^(de|en)$/.test(window.LANGUAGE) ? window.LANGUAGE : (navigator.language || "");
  return /^de/i.test(lang) ? "de" : "en";
}

function t(text, params) {
  let out = (pageLanguage() === "de" && GERMAN[text]) || text;
  if (params) {
    out = out.replace(/\{(\w+)\}/g, function (match, key) {
      return key in params ? String(params[key]) : match;
    });
  }
  return out;
}

const TRANSLATED_ATTRIBUTES = ["placeholder", "aria-label", "title"];

function translatePage() {
  document.documentElement.lang = pageLanguage();
  if (pageLanguage() === "en") return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      const tag = node.parentNode.nodeName;
      return tag === "SCRIPT" || tag === "STYLE" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  let node;
  while ((node = walker.nextNode())) {
    const key = node.nodeValue.trim();
    if (key && GERMAN[key]) node.nodeValue = node.nodeValue.replace(key, GERMAN[key]);
  }

  document.querySelectorAll("[placeholder], [aria-label], [title]").forEach(function (el) {
    TRANSLATED_ATTRIBUTES.forEach(function (attr) {
      const value = el.getAttribute(attr);
      if (value && GERMAN[value]) el.setAttribute(attr, GERMAN[value]);
    });
  });
}
