# F05 — Mobile-native experience

Push notifications and native mobile builds for a first-class phone experience.

---

## What this delivers

The app works as a real mobile app — not just a web view. Users get timely push notifications and can install it from an app store or as a direct APK/IPA.

## Key capabilities

- **Push notifications** — notify for upcoming events (configurable lead time), overdue tasks, processed inbox items, and proactive nudges. Respects quiet hours.
- **Native build** — Expo prebuild to generate APK (Android) and IPA (iOS). Proper app icon, splash screen, and home screen presence.
- **Background sync** — periodic background fetch to keep data fresh even when the app isn't in the foreground.

## User stories

- As a user, I want a notification 15 minutes before my next meeting.
- As a user, I want to install the app from my phone's home screen like any other app.
- As a user, I want my data to be fresh when I open the app, not stale from hours ago.

## Out of scope

- Widgets (home screen widgets)
- Wear OS / watchOS companion
- App store publishing (just the build pipeline)
