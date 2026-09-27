# Google OAuth Handler — ThreadMyMail

## Who Handles It?
**The FastAPI backend (`backend/auth.py`) handles Google OAuth.**
Not the frontend. Not Render directly. Not GitHub.

## Implementation Plan
- Use `authlib` + `google-auth-oauthlib`
- Flow: User clicks "Login with Google" → Redirect to Google OAuth endpoint → Google returns `code` → Backend exchanges `code` for `id_token` / `access_token` → Backend creates/verifies user in PostgreSQL (`users` table) → Issues JWT to client

## Env Variables Required (in Render + GitHub Secrets)
```env
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://threadmymail.onrender.com/auth/google/callback
```

## Status: Not yet implemented.
Needs user to create Google Cloud Console OAuth 2.0 credentials and provide `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.
