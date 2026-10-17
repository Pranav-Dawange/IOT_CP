/**
 * WebSocket Live Event Stream Client (Phase 7).
 * Connects to /ws/live endpoint with auto-reconnect, heartbeat ping,
 * and typed listener registration for telemetry, prediction, alert, and status events.
 */

import { LiveEvent, LiveEventType } from '../types';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';
export type LiveEventListener<T = any> = (event: LiveEvent<T>) => void;
export type StateChangeListener = (state: ConnectionState) => void;

class LiveWebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private listeners: Map<LiveEventType | '*', Set<LiveEventListener>> = new Map();
  private stateListeners: Set<StateChangeListener> = new Set();
  private state: ConnectionState = 'disconnected';
  private reconnectInterval = 3000;
  private isExplicitlyClosed = false;

  constructor() {
    this.url = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/live';
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public onStateChange(listener: StateChangeListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  private setState(newState: ConnectionState) {
    if (this.state !== newState) {
      this.state = newState;
      this.stateListeners.forEach((l) => l(newState));
    }
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isExplicitlyClosed = false;
    this.setState('connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.setState('connected');
        this.startHeartbeat();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (event.data === 'pong') {
          return;
        }

        try {
          const parsed = JSON.parse(event.data) as LiveEvent;
          if (parsed && parsed.type) {
            this.dispatchEvent(parsed);
          }
        } catch (err) {
          console.warn('[WebSocket] Malformed live payload received:', event.data, err);
        }
      };

      this.ws.onerror = () => {
        this.setState('error');
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.setState('disconnected');
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      this.setState('error');
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  public on<T = any>(eventType: LiveEventType | '*', listener: LiveEventListener<T>): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener as LiveEventListener);

    return () => {
      const set = this.listeners.get(eventType);
      if (set) {
        set.delete(listener as LiveEventListener);
      }
    };
  }

  private dispatchEvent(event: LiveEvent): void {
    const specificListeners = this.listeners.get(event.type);
    if (specificListeners) {
      specificListeners.forEach((listener) => {
        try {
          listener(event);
        } catch (err) {
          console.error(`[WebSocket] Listener error for event '${event.type}':`, err);
        }
      });
    }

    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      wildcardListeners.forEach((listener) => {
        try {
          listener(event);
        } catch (err) {
          console.error('[WebSocket] Wildcard listener error:', err);
        }
      });
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, 20000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isExplicitlyClosed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }
}

export const liveWs = new LiveWebSocketClient();
