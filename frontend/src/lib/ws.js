/**
 * Agent stream client — GET /agent/stream (WebSocket).
 *
 * Protocol per docs/API.md §3.1. The Worker does not exist yet, so this client
 * surfaces `connecting` / `offline` states rather than pretending to work.
 *
 * Reconnects with exponential backoff and a small jitter, because a Durable
 * Object hibernation or a Worker eviction drops the socket without warning.
 */
import { streamOrigin } from './api.js';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 800;

export class AgentStream extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.status = 'idle'; // idle | connecting | open | offline
    this.attempt = 0;
    this.closedByUs = false;
    this._timer = null;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  connect() {
    if (this.socket && this.socket.readyState <= 1) return;
    this.closedByUs = false;
    this.setStatus('connecting');

    let ws;
    try {
      ws = new WebSocket(streamOrigin());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
      this.emit('open', null);
    };

    ws.onmessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!frame || typeof frame.type !== 'string') return;
      this.emit(frame.type, frame);
    };

    ws.onerror = () => {
      /* onclose always follows; handle there to avoid double-reconnect */
    };

    ws.onclose = () => {
      this.socket = null;
      this.setStatus('offline');
      if (!this.closedByUs) this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    if (this._timer) return;
    const exponential = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * 2 ** this.attempt,
    );
    const jitter = Math.random() * 400;
    this.attempt += 1;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.connect();
    }, exponential + jitter);
  }

  send(frame) {
    if (this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  sendMessage(content) {
    return this.send({ type: 'message', id: cryptoId(), content });
  }

  interrupt(runId) {
    return this.send({ type: 'interrupt', id: runId });
  }

  close() {
    this.closedByUs = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus('idle');
  }
}

function cryptoId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export { cryptoId };
