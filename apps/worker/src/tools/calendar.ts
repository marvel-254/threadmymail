/**
 * Calendar tools.
 *
 * Unlike email, there is no local-first half here: nothing syncs the calendar
 * into Postgres (no `calendar_events` table exists, on purpose — see
 * docs/ARCHITECTURE.md §7). Every calendar capability is a live Google call, so
 * every tool is registered through `gatedTool` and fails with NEEDS_CONNECTION
 * until OAuth lands. See tools/gated.ts for why registering them beats omitting
 * them.
 *
 * `calendar.create_event` and its siblings are the most dangerous tools in the
 * registry: they touch other people's calendars. They are `sideEffecting`,
 * subject to `new_contact_policy` for external attendees, and — once
 * implemented — every event they create is tagged `threadmymail:created` so the
 * activity feed can list and reverse them (docs/AI-SKILLS.md §6).
 */

import type { ToolDefinition } from './registry';
import { gatedTool } from './gated';

const RANGE_PARAMS = {
  type: 'object',
  properties: {
    from: { type: 'string', description: 'Range start, ISO 8601.' },
    to: { type: 'string', description: 'Range end, ISO 8601.' },
  },
  required: ['from', 'to'],
  additionalProperties: false,
} as const;

export const calendarTools: ToolDefinition<never, unknown>[] = [
  gatedTool({
    name: 'calendar.list_events',
    description:
      'List the user\'s calendar events in a time range. Returns start, end, title, ' +
      'attendees and whether the agent created the event. Use this before proposing any ' +
      'time — never guess at what is already booked.',
    onceConnected: 'list events in a date range',
    parameters: RANGE_PARAMS,
    permissions: ['data:calendar:read'],
  }),

  gatedTool({
    name: 'calendar.get_freebusy',
    description:
      'Get REAL availability across the user and any attendees: the busy blocks only, no ' +
      'event details. This is the primitive that makes scheduling honest — it reflects how ' +
      'peers have actually answered, which calendar listings alone do not. Always call it ' +
      'before offering or booking a slot.',
    onceConnected: 'query real availability across attendees',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Range start, ISO 8601.' },
        to: { type: 'string', description: 'Range end, ISO 8601.' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Email addresses to include besides the user.',
        },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    permissions: ['data:calendar:read', 'network:google_calendar'],
  }),

  gatedTool({
    name: 'calendar.find_meeting_time',
    description:
      'Find bookable slots for a set of attendees, composed from get_freebusy and ranked ' +
      'against the user\'s preferences (working hours, preferred meeting length, buffer). ' +
      'Returns ranked candidate slots with the reason each fits. Offer the slots — do not ' +
      'book until the choice is settled.',
    onceConnected: 'find and rank bookable slots',
    parameters: {
      type: 'object',
      properties: {
        attendees: { type: 'array', items: { type: 'string' } },
        duration_minutes: { type: 'integer', description: 'Desired length. Default 30.' },
        from: { type: 'string', description: 'Earliest acceptable start, ISO 8601.' },
        to: { type: 'string', description: 'Latest acceptable end, ISO 8601.' },
        preferences: {
          type: 'string',
          description: 'Free-text constraints, e.g. "mornings only, no back-to-back".',
        },
      },
      required: ['attendees'],
      additionalProperties: false,
    },
    permissions: ['data:calendar:read', 'network:google_calendar'],
  }),

  gatedTool({
    name: 'calendar.create_event',
    description:
      'Book a meeting. Outward-facing: this puts a real event on other people\'s calendars ' +
      'and can notify them, so it is subject to new_contact_policy and the daily budget, ' +
      'and every event is tagged threadmymail:created for the activity feed. Call ' +
      'get_freebusy or find_meeting_time first — a guessed slot is how you double-book someone.',
    onceConnected: 'create events on the calendar',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601.' },
        end: { type: 'string', description: 'ISO 8601.' },
        attendees: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        location: { type: 'string' },
        notify_attendees: {
          type: 'boolean',
          description: 'Send invitations. Default false — prefer adding silently first.',
        },
      },
      required: ['title', 'start', 'end'],
      additionalProperties: false,
    },
    permissions: ['data:calendar:write', 'network:google_calendar'],
    reversible: true,
    sideEffecting: true,
  }),

  gatedTool({
    name: 'calendar.reschedule',
    description:
      'Move an existing event to a new time. Change the time, never the purpose — if the ' +
      'invite needs a different agenda, that is a different conversation with the attendees.',
    onceConnected: 'move an event to a new time',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        start: { type: 'string', description: 'New start, ISO 8601.' },
        end: { type: 'string', description: 'New end, ISO 8601.' },
        notify_attendees: { type: 'boolean', description: 'Default true for a reschedule.' },
      },
      required: ['event_id', 'start'],
      additionalProperties: false,
    },
    permissions: ['data:calendar:write', 'network:google_calendar'],
    reversible: true,
    sideEffecting: true,
  }),

  gatedTool({
    name: 'calendar.cancel',
    description:
      'Cancel an event. Irreversible in the way that matters — the attendees have already ' +
      'seen the invitation. Prefer rescheduling, and warn the user before cancelling ' +
      'anything with external attendees.',
    onceConnected: 'cancel an event',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        notify_attendees: { type: 'boolean', description: 'Default true.' },
        reason: { type: 'string', description: 'Optional note included with the cancellation.' },
      },
      required: ['event_id'],
      additionalProperties: false,
    },
    permissions: ['data:calendar:write', 'network:google_calendar'],
    reversible: false,
    sideEffecting: true,
  }),

  gatedTool({
    name: 'calendar.rsvp',
    description:
      'Answer an invitation: accept, decline or tentative. Committing the user to attend ' +
      'is the point of this tool, so only accept when attendance is genuinely settled.',
    onceConnected: 'respond to invitations',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        response: {
          type: 'string',
          enum: ['accepted', 'declined', 'tentative'],
        },
      },
      required: ['event_id', 'response'],
      additionalProperties: false,
    },
    permissions: ['data:calendar:write', 'network:google_calendar'],
    reversible: true,
    sideEffecting: true,
  }),

  gatedTool({
    name: 'calendar.free_slots_for_me',
    description:
      'The user\'s OWN open slots in a range, with their preferences applied. Use it to ' +
      'answer "when am I free" and to decide what the agent may schedule without asking.',
    onceConnected: 'report the user\'s own open slots',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Range start, ISO 8601.' },
        to: { type: 'string', description: 'Range end, ISO 8601.' },
        min_duration_minutes: { type: 'integer', description: 'Ignore anything shorter. Default 30.' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    permissions: ['data:calendar:read'],
  }),
] as ToolDefinition<never, unknown>[];
