import { EventEmitter } from 'events';

// アプリケーション全体で共有される内部イベントバス
export const internalEventBus = new EventEmitter();

// イベントの種類を定義（必要に応じて追加）
export enum InternalEvent {
  FILE_CHANGED = 'fileChanged',
  WEBSOCKET_OPEN = 'webSocketOpen',
  WEBSOCKET_MESSAGE = 'webSocketMessage',
  WEBSOCKET_ERROR = 'webSocketError',
  WEBSOCKET_CLOSE = 'webSocketClose',
  // ... 他のイベント
}
