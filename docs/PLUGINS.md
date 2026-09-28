# ThreadMyMail - Plugins

> Extensibility: manifest, installation, permissions, and built-ins.
> **Status:** Authoritative. **Last updated:** 2026-09-27

---

## 1. What a Plugin Is

A plugin is a **capability pack** the agent can use: tools, optional skills, and
the credentials those tools need.

Plugins exist so that adding Notion, a web-fetch provider, or a home-automation
integration does not require a code change or a deploy.

> **⚠️ Security reality:** a plugin is arbitrary code executing in-process in the
> Worker. There is no sandbox. The manifest/permission review in §4 is the *only*
> gate. This is a deliberate trade — a personal-assistant architecture needs
> extensibility more than it needs a plugin marketplace's threat model — but it
> should be an informed choice, not an accident.

---

## 2. Manifest

`plugin.json` at the plugin root.

```jsonc
{
  "id": "notion",                       // unique, matches plugin_credentials.plugin_id
  "name": "Notion",
  "version": "1.0.0",
  "description": "Read and write Notion pages and databases.",
  "author": "threadmymail",
  "kind": "connector",                  // "connector" | "capability" | "ui"

  "entry": "plugin.ts",                 // default plugin.ts
  "min_runtime": "1.0.0",               // worker version constraint

  "setup": {
    "fields": [
      {
        "key": "token",
        "label": "Internal Integration Token",
        "type": "secret",               // "secret" | "text" | "url"
        "required": true,
        "help": "Notion → Settings → Integrations → New internal integration"
      }
    ]
  },

  "tools": [
    {
      "name": "notes_search",
      "description": "Search the user's Notion workspace for pages matching a query.",
      "permissions": ["data:notes:read"],
      "network": ["https://api.notion.com"],
      "reversible": false,
      "parameters": {
        "query":   { "type": "string", "description": "Search terms." },
        "limit":   { "type": "integer", "description": "Max results.", "default": 10 }
      }
    },
    {
      "name": "notes_append",
      "description": "Append content to an existing Notion page.",
      "permissions": ["data:notes:write"],
      "network": ["https://api.notion.com"],
      "reversible": false,
      "parameters": {
        "page_id": { "type": "string", "description": "Target page id." },
        "content": { "type": "string", "description": "Markdown to append." }
      }
    }
  ],

  "skills": [                            // optional, plain-language
    {
      "name": "notion_capture",
      "description": "Capture an email thread into Notion.",
      "instructions": "Summarize the thread, then append it to the user's 'Captured' page.",
      "allowed_tools": ["notes_search", "notes_append", "email.get_thread"],
      "trigger": { "type": "on_demand", "config": {} }
    }
  ],

  "permissions": ["network:api.notion.com", "data:notes:read", "data:notes:write"]
}
```

### 2.1 Permission namespaces

| Namespace | Grants |
|---|---|
| `network:<host>` | Outbound HTTPS to that host only |
| `data:notes:read` / `:write` | Notes (e.g. Notion) |
| `data:calendar:read` / `:write` | Calendar |
| `data:email:read` / `:write` | Mail |
| `data:memory:read` / `:write` | Memory store |
| `data:web:read` | Web search/fetch |

**A plugin's effective permissions = its grants ∩ what the user approved ∩ what
the invoking skill is allowed to use.**

### 2.2 Plugin code

```typescript
import { definePlugin, tool, z } from "@threadmymail/plugin-sdk";

export default definePlugin({
  manifest: notionalManifest,

  async register(ctx) {
    // ctx.credentials  — decrypted, only fields declared in setup
    // ctx.tools        — register runtime tools
    // ctx.skills       — register skills
    // ctx.log          — structured logging into the activity feed
  },
});
```

Credentials are **only** available to tools that declared `setup` fields. A
plugin cannot read another plugin's credentials or the user's BYOK API keys.

---

## 3. Installation Sources

| Source | Behaviour |
|---|---|
| **Built-in** | Ships in the repo under `apps/worker/src/plugins/builtin/`. No review required; versioned with the app. |
| **Git URL** | Cloned into `plugins/<id>/`, pinned by commit SHA, reviewed before registration. |
| **Local path** | For development. Same review as git, skip the clone. |

A git-URL plugin is **never auto-updated**. Upgrading is an explicit action that
re-runs the review, because a moved `main` branch is a supply-chain vector.

---

## 4. Install Flow

```
1. USER pastes a git URL (or picks a built-in)
     │
2. CLONE   → git clone to plugins/<id>/
     │
3. PARSE   → read + validate plugin.json
     │        • id / name / version present
     │        • tool names globally unique
     │        • parameters are valid schema
     │        • permissions well-formed
     │        • no reserved tool-name prefix
     │
4. REVIEW  → show the user, in plain language:
             "Notion 1.0.0 wants to:"
               • read and write your Notion notes
               • make HTTPS requests to api.notion.com
               • register 2 tools and 1 skill
             [Approve all] [Choose permissions] [Reject]
     │
5. PIN     → record source + commit SHA in plugins
     │
6. ACTIVATE→ register tools + skills; record grants in tool_grants
     │
7. CREDENTIALS → user enters secret fields; encrypted at rest
```

**Step 4 is not a formality.** The UI must show the *effective* permission set,
not the plugin's own claims.

### 4.1 On update

1. Fetch the new commit
2. Diff the manifest
3. **If permissions grew, re-prompt with a diff view**
4. Only then swap the code

---

## 5. Built-in Plugins

| ID | Purpose | Credential | Tools |
|---|---|---|---|
| `gmail` | Mail read/send/thread | (Google OAuth — shared) | `email.*` |
| `google_calendar` | Events, freebusy, booking | (Google OAuth — shared) | `calendar.*` |
| `todo` | Built-in task store | none | `todo.*` |
| `memory` | Facts, preferences, commitments | none | `memory.*` |
| `notion` | Notes | Notion internal integration token | `notes.*` |
| `exa` | Web search | Exa API key | `web.search` |
| `firecrawl` | Page fetch/extract | Firecrawl API key | `web.fetch` |
| `webhooks` | Inbound events → skills | Per-webhook secret | *(none — triggers skills)* |

`gmail` and `google_calendar` share **one** Google OAuth connection — one consent,
one token, two capability sets. See [GOOGLE_OAUTH.md](./GOOGLE_OAUTH.md).

### 5.1 Notion

- Credential: Notion integration token (BYOK)
- `notes_search`, `notes_create`, `notes_append`, `notes_get`, `notes_query`
- The agent can *cite* a Notion page inline in the stream
- Ship `notion_capture` skill (thread → page) and `notion_daily` (collect loose
  threads into a daily note)

### 5.2 Exa (search)

- Credential: `EXA_API_KEY`
- `web.search(query, num_results, include_domains)` → titles, URLs, snippets
- **Every result is untrusted content** — injected as data, never instructions

### 5.3 Firecrawl (fetch)

- Credential: `FIRECRAWL_API_KEY`
- `web.fetch(url)` → cleaned markdown
- **Guardrails:** SSRF block (loopback, private, link-local, metadata IPs),
  scheme allowlist (https only), response size cap, timeout, and **D1 TTL cache**
  so re-reading a page never re-bills

### 5.4 Webhooks

Inbound HTTP → skill trigger. Lets external systems (GitHub, a Stripe webhook, a
cron ping) start a skill. Each webhook gets a random secret, verified by HMAC or
bearer token, rate-limited, and can only trigger skills whose
`trigger.config.webhook` matches its id.

---

## 6. Security Rules

1. **Review before registration.** No tool is reachable without an explicit grant.
2. **Least privilege by default.** `data:*:read` does not imply `:write`.
3. **Pin by commit SHA.** No silent auto-update.
4. **Re-review on permission growth.** Especially on update.
5. **Network allowlist per tool**, not per plugin. A search tool does not inherit
   the write tool's host access.
6. **Credentials are isolated.** `ctx.credentials` exposes only this plugin's
   declared fields, decrypted per-call, never logged.
7. **Skills are sandboxed by tool scope.** A plugin's skill gets only its declared
   `allowed_tools`; it cannot reach built-in tools it did not request.
8. **Full audit.** Every plugin tool call lands in `tool_calls` attributed to the
   plugin id.
9. **Disable, don't uninstall.** Disabling removes all grants immediately without
   deleting configuration.
10. **Untrusted content is data.** No plugin may treat fetched or emailed content
    as instructions, regardless of what that content says.

---

## 7. Writing a Plugin

```
my-notion-plugin/
├── plugin.json        # manifest (§2)
├── plugin.ts          # register() implementation
└── README.md
```

Local development:

```bash
cd apps/worker
pnpm dev                      # wrangler dev
# install from local path via the Plugins UI, or:
# add to wrangler.jsonc dev config for hot reload
```

Checklist:
- [ ] `id` is unique and stable
- [ ] `description` on every tool is written **for the model**, not for humans —
      it decides whether and how the model calls it
- [ ] `parameters` fully describe the arguments
- [ ] Narrowest possible `permissions`
- [ ] Tool names namespaced (`notes_*`, not `search`) to avoid collisions
- [ ] Errors return a structured `{ error: { code, message } }`, not a thrown stack
- [ ] No credential ever appears in a tool result

**The tool `description` is the single highest-leverage string in a plugin.** It
is the model's only basis for deciding whether and how to call the tool. Vague
descriptions produce wrong calls; precise ones produce correct ones.

---

## 8. Open Questions

1. Should plugins be able to register **UI** (`kind: "ui"` — custom artifact
   renderers), or is the binding protocol sufficient?
2. Signed plugin manifests / a curated registry — worth it for a single-user
   install, or unnecessary ceremony?
3. Should a plugin be able to spawn **scheduled** skills (a cron-triggered
   skill) without a per-skill grant?

---

*Related: [AI-SKILLS.md](./AI-SKILLS.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) ·
[API.md](./API.md)*
