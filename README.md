# PebbleChecklist

<img src="demo_animation.gif" width="144" height="168">

A checklist—on your watch!

Keep track of anything on your wrist! Designed to stay out of your way, use Checklist to keep track of anything you need without needing to hold your phone.

Using either the Pebble microphone or the fully-offline app settings page, add and manage your very own tiny checklist!

Grocery shopping will never be the same.

## Several lists

Your watch shows up to 8 lists, and your phone keeps up to 32. In the app's settings on your phone, tap the list name at the top (or choose **Lists** in the ⋯ menu) to switch lists, create new ones, or rename and delete them with the ✎ button. The eye button next to each list hides it on your watch or shows it again; hidden lists stay on your phone and in the settings. Each list is one of:

- a **checklist**, stored on your watch and phone, like before
- your **Cookidoo shopping list** (see below)
- a **Home Assistant to-do list** (see below)

On the watch, press Back in a list to see all your lists, and pick one to open it. Switching lists needs your phone, since the watch only stores the list it shows. "Show on watch" in the settings switches the watch to the list you're looking at.

## Home Assistant to-do lists

Lists can be synced with the to-do lists in Home Assistant (Shopping List, Local To-do, …), both ways. In the settings, open the ⋯ menu, choose **Home Assistant**, and enter your Home Assistant URL (e.g. `http://homeassistant.local:8123`, or your Nabu Casa URL) and a long-lived access token (your Home Assistant profile → Security). Home Assistant 2024.8 or later is needed. For a URL that isn't on your home network or Nabu Casa, the Pebble app asks for permission the first time.

- Every to-do list in Home Assistant is added to your lists automatically (hidden once your watch shows 8 lists), and removed when it's deleted in Home Assistant. They can't be deleted in the settings, only hidden.
- New lists you create while Home Assistant is connected become Home Assistant lists: a Local To-do list with that name is created in Home Assistant when you save. This needs an administrator's access token. If Home Assistant can't be reached right now (e.g. you're away from home), the list works like a normal checklist on your watch and phone and is created in Home Assistant as soon as it can be reached.

## Cookidoo shopping list

The app can show your Cookidoo (Thermomix) shopping list ("Einkaufsliste") on your watch. Open the app's settings in the Pebble app on your phone, open the ⋯ menu, choose **Cookidoo** and sign in with your Cookidoo account. A "Shopping list" list ("Einkaufsliste" in German) is added to your lists and shown on your watch:

- recipe ingredients (with amounts) and your extra items are shown
- checking items off on the watch checks them off in Cookidoo, and the reverse
- items added by voice on the watch, or on the settings page, are added to Cookidoo as extra items
- "Clear completed" removes checked extra items from Cookidoo; checked ingredients stay checked in Cookidoo but are hidden on the watch until they're unchecked there

Synced lists (Cookidoo and Home Assistant) are synced when they're opened on the watch, every 2 minutes while the app is open, and shortly after every change on the watch. Your password only goes to Cookidoo's sign-in server. This uses the same unofficial API as the Home Assistant Cookidoo integration.

## Languages

The app is in English and German. The watch app follows your watch's language; the settings page, sync messages and default list names follow it too (or your phone's language if the watch's isn't known).

## Special build instructions

To build the local config page, run `node buildConfigPage.js` from the project root. This should be done before `pebble build`.

## Want to try it?

Grab it from the Pebble app store:

### Pebble Store
<https://apps.repebble.com/5620e876768e7ada4e00007a>

### Rebble Store
<https://apps.rebble.io/en_US/application/5620e876768e7ada4e00007a>
