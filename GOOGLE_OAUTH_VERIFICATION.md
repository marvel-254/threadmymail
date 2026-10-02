# Google OAuth App Verification — Justification
# ThreadMyMail (threadmymail.omixsystems.store)
#
# This file contains the justifications used for the Google Cloud OAuth
# verification review. Keep it in sync with the OAuth consent screen.

## Non-Sensitive Scopes (already approved)
- openid — Identity (id token)
- email — See your primary Google Account email address
- profile — See your personal info, including any personal info you've made publicly available
- https://www.googleapis.com/auth/gmail.readonly — Read email messages
- https://www.googleapis.com/auth/calendar.readonly — Read calendar data

## Sensitive Scopes (approval required)
- https://www.googleapis.com/auth/gmail.compose — Compose new draft emails
- https://www.googleapis.com/auth/gmail.drafts — Manage draft emails
- https://www.googleapis.com/auth/gmail.modify — Modify sent emails

## How will the scopes be used?

ThreadMyMail is a personal, single-user assistant that works your own inbox.
The OAuth flow is the application login itself: one sign-in, one consent
screen, and the app is installed and ready to use. There is no separate
signup flow, no magic link, and no password.

The sensitive Gmail scopes are used as follows:
- gmail.compose: create new draft emails for the user to review and send
- gmail.drafts: organize, label, and manage draft emails in the user's mailbox
- gmail.modify: update sent messages on the user's behalf

These scopes exist so the app can compose and manage draft emails, which
is a core feature of the assistant. All operations happen entirely within
the Gmail API on the user's own mailbox.

## Justification

The app is **single-user and personal**: it does not handle third-party data,
does not expose a public signup portal, and performs no commercial use. The
Google "not verified" warning screen is therefore expected and acceptable for
a personal install. The OAuth consent is presented to the account owner who
grants access to their own data.

No Drive, Docs, or other sensitive scopes are requested. The sensitive
scopes are strictly limited to the Gmail API's read-modify cycle for the
user's personal mailbox, and the app never writes to Google Drive or other
G Suite services.

## Why more limited scopes aren't sufficient

The app intentionally avoids the broad https://mail.google.com/ scope
and only requests the minimum permissions needed:
- gmail.compose, gmail.drafts, gmail.modify — for composing and managing
  drafts, which cannot be done with the read-only scopes
- gmail.readonly and calendar.readonly — the strict minimum read access

The read-only scopes alone cannot create or manage drafts, so they are not
sufficient for the app's core functionality. Broader scopes (Drive, Docs,
full mail access) are not needed.
