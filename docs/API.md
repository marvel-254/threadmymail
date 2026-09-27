# ThreadMyMail - API Specification

> Complete REST API reference for the email AI harness.

---

## 1. Base URL

```
https://api.threadmymail.com/v1
```

All endpoints return JSON:
```json
{
  "success": true,
  "data": {...},
  "error": null
}
```

Error format:
```json
{
  "success": false,
  "data": null,
  "error": "Descriptive error message"
}
```

---

## 2. Authentication

### `POST /auth/magic-link`

Request:
```json
{
  "email": "user@example.com"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "message": "Magic link sent to user@example.com"
  }
}
```

---

### `POST /auth/verify`

Request:
```json
{
  "token": "magic_link_token_jwt"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "access_token": "jwt_access_token",
    "refresh_token": "jwt_refresh_token",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "full_name": "John Doe"
    }
  }
}
```

Headers for subsequent requests:
```
Authorization: Bearer <access_token>
```

---

### `GET /auth/me`

Response:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "full_name": "John Doe",
    "created_at": "2024-01-15T10:30:00Z",
    "ai_config": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "temperature": 0.3
    },
    "notification_settings": {
      "digest_time": "20:00",
      "daily_digest": true,
      "important_push": true
    }
  }
}
```

---

## 3. Email Accounts

### `GET /accounts`

List all connected email accounts.

Response:
```json
{
  "success": true,
  "data": {
    "accounts": [
      {
        "id": "uuid",
        "provider": "gmail",
        "email_address": "john@gmail.com",
        "display_name": "Personal Gmail",
        "is_default": true,
        "sync_enabled": true,
        "last_synced_at": "2024-01-15T10:30:00Z",
        "folder_mapping": {
          "inbox": "INBOX",
          "sent": "Sent Mail",
          "archive": "All Mail"
        }
      }
    ],
    "total": 1
  }
}
```

---

### `POST /accounts`

Add a new email account.

**Gmail OAuth Flow:**
```
GET /accounts/gmail-url  →  Returns OAuth URL
User authenticates → Redirect to /accounts/callback
```

Standard IMAP:
```json
{
  "provider": "custom",
  "email_address": "john@work.com",
  "display_name": "Work Email",
  "imap_host": "imap.mail.com",
  "imap_port": 993,
  "imap_username": "john@work.com",
  "imap_password": "app_password_here",
  "smtp_host": "smtp.mail.com",
  "smtp_port": 587,
  "smtp_username": "john@work.com",
  "smtp_password": "app_password_here",
  "is_default": true
}
```

Response:
```json
{
  "success": true,
  "data": {
    "account": {
      "id": "uuid",
      "provider": "gmail",
      "email_address": "john@gmail.com",
      "display_name": "Gmail",
      "is_default": true,
      "sync_enabled": true,
      "last_synced_at": null,
      "folder_mapping": {
        "inbox": "INBOX",
        "sent": "Sent Mail",
        "archive": "All Mail"
      }
    }
  }
}
```

---

### `PUT /accounts/:id`

Update account settings.

Request:
```json
{
  "display_name": "Updated Name",
  "is_default": true,
  "folder_mapping": {
    "inbox": "INBOX",
    "work": "Work"
  },
  "sync_enabled": true
}
```

---

### `DELETE /accounts/:id`

Remove account (deletes all associated emails).

---

### `POST /accounts/:id/test`

Test account configuration.

Response:
```json
{
  "success": true,
  "data": {
    "test_result": "Connection successful",
    "imap": {
      "supported_capabilities": ["IMAP4rev1", "UIDPLUS", "CHILDREN"],
      "mailbox": "INBOX",
      "message_count": 1250
    },
    "smtp": {
      "test_result": "SMTP connection OK"
    }
  }
}
```

---

### `GET /accounts/:id/sync`

Trigger immediate sync.

Response:
```json
{
  "success": true,
  "data": {
    "status": "started",
    "estimated_completion": "2024-01-15T10:35:00Z"
  }
}
```

---

## 4. Email Endpoints

### `GET /emails`

List emails with filtering and pagination.

Query Parameters:
```
account_id (uuid, optional)
folder (string, default: inbox)
search (string, optional)
unread_only (boolean, default: false)
flagged_only (boolean, default: false)
page (integer, default: 1)
page_size (integer, default: 50)
sort_by (received_at|subject|sender, default: received_at)
sort_order (asc|desc, default: desc)
```

Response:
```json
{
  "success": true,
  "data": {
    "emails": [
      {
        "id": "uuid",
        "account_id": "uuid",
        "subject": "Meeting tomorrow at 10am",
        "from_address": "colleague@company.com",
        "from_name": "Colleague",
        "to_addresses": ["me@personal.com"],
        "to_names": ["Me"],
        "snippet": "Don't forget our meeting tomorrow at 10am about the Q4 budget...",
        "folder": "INBOX",
        "flags": 0,  // seen
        "received_at": "2024-01-15T09:00:00Z",
        "ai_summary": "Meeting scheduled for tomorrow 10am about Q4 budget",
        "ai_category": "work",
        "ai_priority": 7
      }
    ],
    "total": 125,
    "page": 1,
    "page_size": 50,
    "has_more": true
  }
}
```

---

### `GET /emails/:id`

Get full email details.

Response:
```json
{
  "success": true,
  "data": {
    "email": {
      "id": "uuid",
      "account_id": "uuid",
      "message_id": "<abc123@example.com>",
      "thread_id": "thread_123",
      "subject": "Re: Re: Meeting tomorrow at 10am",
      "from_address": "colleague@company.com",
      "from_name": "Colleague",
      "to_addresses": [
        {"email": "me@personal.com", "name": "Me"},
        {"email": "team@company.com", "name": "Team"}
      ],
      "cc_addresses": [
        {"email": "manager@company.com", "name": "Manager"}
      ],
      "date": "Mon, 15 Jan 2024 09:00:00 +0000",
      "date_parsed": "2024-01-15T09:00:00Z",
      "body_text": "Full email body text here...",
      "body_html": "<html><body>Full email body HTML here...</body></html>",
      "folder": "INBOX",
      "flags": 0,
      "received_at": "2024-01-15T09:00:00Z",
      "sent_at": null,
      "has_attachments": true,
      "attachments": [
        {
          "filename": "budget.xlsx",
          "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "size": 123456
        }
      ],
      "ai_summary": "Colleague is confirming tomorrow's 10am meeting about Q4 budget. Attached budget.xlsx for review.",
      "ai_category": "work",
      "ai_priority": 7,
      "action_items": [
        "Review budget.xlsx",
        "Prepare Q4 talking points"
      ]
    }
  }
}
```

---

### `GET /emails/:id/headers`

Get only headers (for search index).

Response:
```json
{
  "success": true,
  "data": {
    "headers": [
      {"name": "From", "value": "John Doe <john@example.com>"},
      {"name": "To", "value": "me@example.com"},
      {"name": "Subject", "value": "Test email"},
      {"name": "Date", "value": "Mon, 15 Jan 2024 09:00:00 +0000"}
    ]
  }
}
```

---

## 5. Email Actions

### `POST /emails/:id/read`

Mark email as read.

Response:
```json
{
  "success": true,
  "data": {
    "email_id": "uuid",
    "flag": "seen",
    "status": "set"
  }
}
```

---

### `POST /emails/:id/unread`

Mark email as unread.

Response:
```json
{
  "success": true,
  "data": {
    "email_id": "uuid",
    "flag": "seen",
    "status": "unset"
  }
}
```

---

### `POST /emails/:id/flag`

Toggle flagged status.

Response:
```json
{
  "success": true,
  "data": {
    "email_id": "uuid",
    "flag": "flagged",
    "status": "set"
  }
}
```

---

### `POST /emails/:id/archive`

Archive email (move to archive folder).

Response:
```json
{
  "success": true,
  "data": {
    "email_id": "uuid",
    "folder": "Archive"
  }
}
```

---

### `POST /emails/:id/move`

Move email to different folder.

Request:
```json
{
  "folder": "Work"
}
```

---

### `DELETE /emails/:id`

Delete email (move to trash).

---

## 6. Compose & Send

### `POST /emails/draft`

Save draft email.

Request:
```json
{
  "to": ["recipient@example.com"],
  "cc": ["cc@example.com"],
  "bcc": ["bcc@example.com"],
  "subject": "Draft subject",
  "body": "Draft body text",
  "account_id": "uuid"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "draft_id": "uuid"
  }
}
```

---

### `POST /emails/send`

Send email.

Request:
```json
{
  "to": ["recipient@example.com"],
  "subject": "Hello from ThreadMyMail",
  "body": "This is a test email sent via AI harness.",
  "account_id": "uuid"
}
```

Or send saved draft:
```json
{
  "draft_id": "uuid"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "message_id": "msg_12345",
    "sent_at": "2024-01-15T10:00:00Z",
    "account_id": "uuid"
  }
}
```

---

### `POST /emails/:id/delete-draft`

Delete draft.

---

## 7. AI Endpoints

### `POST /ai/summarize`

Summarize email thread.

Request:
```json
{
  "email_ids": ["uuid1", "uuid2", "uuid3"],
  "max_length": "medium"  // short | medium | long
}
```

Response:
```json
{
  "success": true,
  "data": {
    "summary": "Thread Summary:\n\n1. Main purpose: Q4 budget review meeting\n2. Action items: Review budget.xlsx, Prepare slides\n3. Participants: John (you), Colleague, Manager\n4. Priority: 7/10 - meeting tomorrow",
    "confidence": 0.92,
    "tokens_used": 250
  }
}
```

---

### `POST /ai/compose`

Generate smart reply or new email.

Request:
```json
{
  "action": "reply_to",  // reply_to | new_email | continue_draft
  "email_id": "uuid",  // required if reply_to
  "to": ["new@example.com"],  // required if new_email
  "subject": "New email subject",  // required if new_email
  "tone": "professional",  // professional | casual | formal | friendly
  "length": "concise",  // brief | concise | detailed
  "include_actions": true,  // include action items
  "context": "I'm traveling tomorrow and need to confirm..."  // optional extra context
}
```

Response:
```json
{
  "success": true,
  "data": {
    "draft": {
      "subject": "Re: Meeting tomorrow at 10am",
      "body": "Hi Colleague,\n\nThanks for the heads up about tomorrow's meeting.\n\nI've reviewed the budget.xlsx and have a few questions:\n1. What was the Q3 variance?\n2. Can we discuss the travel budget allocation?\n\nLooking forward to our discussion.\n\nBest,\nJohn",
      "suggested_edits": [
        "Add budget question",
        "Mention travel plans"
      ]
    }
  }
}
```

---

### `POST /ai/triage`

Run AI triage on inbox.

Request:
```json
{
  "account_id": "uuid",
  "limit": 50,  // emails to process
  "reclassify": false  // re-process even already classified emails
}
```

Response:
```json
{
  "success": true,
  "data": {
    "processed": 42,
    "categories": {
      "important": 15,
      "work": 18,
      "personal": 5,
      "newsletter": 4,
      "promo": 0
    },
    "high_priority": [
      {
        "email_id": "uuid",
        "priority": 9,
        "reason": "Flagged by sender, contains 'urgent' and 'deadline'"
      }
    ]
  }
}
```

---

### `POST /ai/chat`

Chat with inbox (RAG-style).

Request:
```json
{
  "message": "Any emails from John about the Q4 project?",
  "search_limit": 10,
  "include_snippets": true
}
```

Response:
```json
{
  "success": true,
  "data": {
    "response": "I found 3 relevant emails:\n\n1. Subject: 'Re: Q4 Project Timeline'\n   From: John Doe <john@company.com>\n   Snippet: 'Meeting scheduled for Thursday to finalize Q4 deliverables...'",
    "sources": [
      {
        "email_id": "uuid",
        "subject": "Re: Q4 Project Timeline",
        "from": "john@company.com",
        "date": "2024-01-10"
      }
    ],
    "confidence": 0.88
  }
}
```

---

### `POST /ai/extract-tasks`

Extract action items from email.

Request:
```json
{
  "email_id": "uuid",
  "include_deadlines": true
}
```

Response:
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "description": "Review budget.xlsx",
        "due_date": "2024-01-20",
        "assignee": "me",
        "priority": 3
      },
      {
        "description": "Prepare Q4 slides",
        "due_date": null,
        "assignee": "me",
        "priority": 5
      }
    ]
  }
}
```

---

## 8. Task Scheduling

### `GET /tasks`

List scheduled AI tasks.

Query:
```
status (pending|running|completed|failed, optional)
type (summarize|compose|triage|chat|reminder, optional)
limit (default: 50)
```

Response:
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "id": "uuid",
        "type": "reminder",
        "status": "pending",
        "scheduled_at": "2024-01-15T15:00:00Z",
        "input_data": {
          "message": "Follow up with John about Q4 budget"
        },
        "created_at": "2024-01-14T10:00:00Z"
      }
    ],
    "total": 5
  }
}
```

---

### `POST /tasks`

Create new scheduled task.

Request:
```json
{
  "type": "reminder",  // reminder | follow_up | digest | summarize_inbox
  "when": "2024-01-15T15:00:00Z",  // ISO timestamp
  "payload": {
    "message": "Follow up with John about Q4 budget",
    "email_id": "uuid",  // optional: link to email
    "recipients": ["john@example.com"]  // for follow-up emails
  },
  "channel": "both"  // push | email | both
}
```

Response:
```json
{
  "success": true,
  "data": {
    "task_id": "uuid",
    "status": "scheduled"
  }
}
```

---

### `DELETE /tasks/:id`

Cancel scheduled task.

---

### `POST /tasks/:id/reschedule`

Reschedule task execution.

Request:
```json
{
  "when": "2024-01-15T17:00:00Z"
}
```

---

## 9. Notifications

### `GET /notifications`

List notifications.

Query:
```
read (true|false, optional)
type (push|email|in_app, optional)
limit (default: 100)
```

Response:
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "uuid",
        "type": "push",
        "title": "Important: Budget Review Meeting",
        "body": "John flagged email about Q4 budget meeting tomorrow",
        "data": {
          "email_id": "uuid",
          "account_id": "uuid"
        },
        "read": false,
        "created_at": "2024-01-15T08:30:00Z"
      }
    ],
    "total": 5,
    "unread_count": 3
  }
}
```

---

### `POST /notifications/read`

Mark notifications as read.

Request:
```json
{
  "notification_ids": ["uuid1", "uuid2"],
  "all": false  // if true, marks all as read
}
```

---

### `POST /notifications/push-token`

Register Expo push token.

Request:
```json
{
  "token": "ExponentPushToken[xxxxxxxxxxxxx]",
  "device_info": {
    "model": "Pixel 8",
    "os": "android",
    "app_version": "1.0.0"
  }
}
```

---

### `POST /notifications/settings`

Update notification preferences.

Request:
```json
{
  "daily_digest_time": "19:00",
  "daily_digest": true,
  "important_push": true,
  "low_priority_push": false,
  "email_digest": true,
  "important_emails": true
}
```

---

## 10. Settings

### `GET /settings`

Get all user settings.

Response:
```json
{
  "success": true,
  "data": {
    "ai_config": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "api_key": "****",
      "base_url": null,
      "temperature": 0.3,
      "max_tokens": 2000
    },
    "sync_settings": {
      "auto_sync": true,
      "sync_interval": 300,  // seconds
      "fetch_days": 30
    },
    "notification_settings": {
      "daily_digest_time": "20:00",
      "daily_digest": true,
      "important_push": true,
      "low_priority_push": false,
      "email_digest": false
    },
    "theme": "dark",
    "timezone": "America/New_York"
  }
}
```

---

### `PUT /settings/ai`

Update AI configuration.

Request:
```json
{
  "provider": "openai",  // openai | anthropic | ollama | custom
  "model": "gpt-4o",
  "temperature": 0.3,
  "max_tokens": 2000,
  "base_url": "http://localhost:11434/v1"  // optional, for custom/Ollama
  "api_key": "sk-..."  // optional: if not set, uses existing
}
```

Response:
```json
{
  "success": true,
  "data": {
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.3,
    "max_tokens": 2000,
    "validated": true
  }
}
```

---

### `PUT /settings/notifications`

Update notification settings.

Request:
```json
{
  "daily_digest_time": "19:00",
  "daily_digest": true,
  "important_push": true,
  "low_priority_push": false,
  "email_digest": true
}
```

---

### `PUT /settings/appearance`

Update appearance settings.

Request:
```json
{
  "theme": "dark",  // light | dark | system
  "timezone": "America/New_York",
  "date_format": "MM/DD/YYYY"  // MM/DD/YYYY | DD/MM/YYYY | YYYY-MM-DD
}
```

---

## 11. Search

### `GET /search`

Global search across emails.

Query:
```
q (required): search query string
account_id (optional): limit to specific account
folders (optional): comma-separated list of folders
limit (default: 20)
```

Search respects these fields:
- Subject line
- From/To/Cc addresses
- Body text
- AI summaries
- Thread context

---

## 12. Error Codes

| Code | Message | Description |
|------|---------|-------------|
| 400 | Bad Request | Invalid JSON, missing fields |
| 401 | Unauthorized | Missing or invalid JWT |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource |
| 422 | Unprocessable | Validation error |
| 429 | Too Many Requests | Rate limited |
| 500 | Internal Error | Server error |

---

## 13. Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| General API | 100 requests | per minute |
| AI Endpoints | 10 requests | per minute |
| Email Sync | 1 request | per 5 minutes per account |

---

## 14. WebSocket Events (Future)

Real-time updates via WebSocket:

```
wss://api.threadmymail.com/v1/ws

Events:
- email.received
- email.read
- email.flagged
- sync.completed
- task.completed
- notification.pushed
```

---

*API version: v1 (2024-01-15)
*OpenAPI spec available at: `/openapi.json`