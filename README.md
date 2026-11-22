# PebbleChecklist

<img src="demo_animation.gif" width="144" height="168">

A checklist—on your watch!

Keep track of anything on your wrist! Designed to stay out of your way, use Checklist to keep track of anything you need without needing to hold your phone.

Using either the Pebble microphone or the fully-offline app settings page, add and manage your very own tiny checklist!

Grocery shopping will never be the same.

> **This is a fork** of [freakified/PebbleChecklist](https://github.com/freakified/PebbleChecklist). It adds several lists, Cookidoo and Home Assistant sync, and a German translation. This version is **not in the Pebble or Rebble app store**: the store has the original app, without these features. See [Installing this version](#installing-this-version).

## Several lists

You can have up to 8 lists. In the app's settings on your phone, tap the list name at the top to switch lists or create, rename and delete them. Each list is one of:

- a **checklist**, stored on your watch and phone, like before
- your **Cookidoo shopping list** (see below)
- a **Home Assistant to-do list** (see below)

On the watch, press Back in a list to see all your lists, and pick one to open it. Switching lists needs your phone, since the watch only stores the list it shows. "Show on watch" in the settings switches the watch to the list you're looking at.

## Home Assistant to-do lists

A list can be synced with any to-do list in Home Assistant (Shopping List, Local To-do, …), both ways. In the settings, open the ⋯ menu, choose **Home Assistant**, and enter your Home Assistant URL (e.g. `http://homeassistant.local:8123`, or your Nabu Casa URL) and a long-lived access token (your Home Assistant profile → Security). Then create a new list of type "Home Assistant to-do list" and pick the to-do list. Home Assistant 2024.8 or later is needed. For a URL that isn't on your home network or Nabu Casa, the Pebble app asks for permission the first time.

## Cookidoo shopping list

The app can show your Cookidoo (Thermomix) shopping list ("Einkaufsliste") on your watch. Open the app's settings in the Pebble app on your phone, open the ⋯ menu, choose **Cookidoo** and sign in with your Cookidoo account. A "Shopping list" list ("Einkaufsliste" in German) is added to your lists and shown on your watch:

- recipe ingredients (with amounts) and your extra items are shown
- checking items off on the watch checks them off in Cookidoo, and the reverse
- items added by voice on the watch, or on the settings page, are added to Cookidoo as extra items
- "Clear completed" removes checked extra items from Cookidoo; checked ingredients stay checked in Cookidoo but are hidden on the watch until they're unchecked there

Synced lists (Cookidoo and Home Assistant) are synced when they're opened on the watch, every 2 minutes while the app is open, and shortly after every change on the watch. Your password only goes to Cookidoo's sign-in server. This uses the same unofficial API as the Home Assistant Cookidoo integration.

## Special build instructions

To build the local config page, run `node buildConfigPage.js` from the project root. This should be done before `pebble build`.

## Installing this version

Download `PebbleChecklist.pbw` from the [latest release](https://github.com/johanngrobe/PebbleChecklist/releases/latest) on your phone and open it with the Pebble app, or build it yourself (see above) and run `pebble install --phone <your phone's IP>`.

It has the same app ID as the store version, so it replaces the store version on your watch, and the next store update would replace it again.

## Original app

The original Checklist, without the features of this fork, is in the app stores:

- Pebble Store: <https://apps.repebble.com/5620e876768e7ada4e00007a>
- Rebble Store: <https://apps.rebble.io/en_US/application/5620e876768e7ada4e00007a>
