/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { internalEventBus, InternalEvent } from '../utils/internalEventBus.js';
import WebSocket from 'ws';

interface WebSocketSubscriberOptions {
  url: string;
  enabled?: boolean;
}

class WebSocketSubscriberService {
  private ws: WebSocket | null = null;
  private static instance: WebSocketSubscriberService;

  private constructor() {}

  static getInstance(): WebSocketSubscriberService {
    if (!WebSocketSubscriberService.instance) {
      WebSocketSubscriberService.instance = new WebSocketSubscriberService();
    }
    return WebSocketSubscriberService.instance;
  }

  start(options: WebSocketSubscriberOptions): void {
    if (options.enabled === false) {
      console.log('WebSocket subscription is disabled.');
      this.stop();
      return;
    }

    if (this.ws) {
      console.warn(
        'WebSocketSubscriberService is already connected. Closing current connection before starting a new one.',
      );
      this.stop();
    }

    const { url } = options;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log(`WebSocket connected to ${url}`);
        internalEventBus.emit(InternalEvent.WEBSOCKET_OPEN, { url });
      };

      this.ws.onmessage = (event) => {
        console.log(`WebSocket message from ${url}: ${event.data}`);
        internalEventBus.emit(InternalEvent.WEBSOCKET_MESSAGE, {
          url,
          data: event.data,
        });
      };

      this.ws.onerror = (error) => {
        console.error(`WebSocket error from ${url}:`, error);
        internalEventBus.emit(InternalEvent.WEBSOCKET_ERROR, { url, error });
      };

      this.ws.onclose = (event) => {
        console.log(
          `WebSocket disconnected from ${url}. Code: ${event.code}, Reason: ${event.reason}`,
        );
        internalEventBus.emit(InternalEvent.WEBSOCKET_CLOSE, {
          url,
          code: event.code,
          reason: event.reason,
        });
        this.ws = null;
      };

      console.log(`Attempting to connect to WebSocket: ${url}`);
    } catch (error) {
      console.error(`Failed to create WebSocket connection to ${url}:`, error);
      internalEventBus.emit(InternalEvent.WEBSOCKET_ERROR, { url, error });
    }
  }

  stop(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      console.log('Stopped WebSocket subscription.');
    }
  }
}

export const webSocketSubscriberService =
  WebSocketSubscriberService.getInstance();
