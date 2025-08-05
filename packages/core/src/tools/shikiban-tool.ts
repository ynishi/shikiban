/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult, Icon } from './tools.js';
import { Type } from '@google/genai';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import { Config } from '../config/config.js';

interface ShikibanConfig {
  serverUrl?: string;
  apiKey?: string;
}

interface CreateSessionResponse {
  sessionId: string;
}

export interface TurnData {
  role: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

interface ShikibanToolParams {
  action: 'create_session' | 'create_turn';
  turnData?: TurnData;
}

/**
 * Tool for integrating with Shikiban Server for session history tracking.
 */
export class ShikibanTool extends BaseTool<ShikibanToolParams, ToolResult> {
  private config: ShikibanConfig;

  constructor() {
    super(
      'shikiban',
      'Shikiban Server',
      'Manages session history with Shikiban Server',
      Icon.Globe,
      {
        type: Type.OBJECT,
        properties: {
          action: {
            type: Type.STRING,
            enum: ['create_session', 'create_turn'],
            description: 'The action to perform',
          },
          turnData: {
            type: Type.OBJECT,
            description: 'The turn data to send (for create_turn action)',
            properties: {
              role: { type: Type.STRING },
              content: { type: Type.STRING },
              timestamp: { type: Type.STRING },
              metadata: { type: Type.OBJECT },
            },
          },
        },
        required: ['action'],
      },
      false, // isOutputMarkdown
      false, // canUpdateOutput
    );

    this.config = {
      serverUrl: process.env.SHIKIBAN_SERVER_URL,
      apiKey: process.env.SHIKIBAN_API_KEY,
    };
  }

  /**
   * Execute the tool action.
   */
  async execute(
    args: ShikibanToolParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    if (!this.config.serverUrl || !this.config.apiKey) {
      console.warn(
        'Shikiban Server configuration not found. Set SHIKIBAN_SERVER_URL and SHIKIBAN_API_KEY environment variables.',
      );
      return {
        summary: 'Shikiban Server not configured',
        llmContent: 'Shikiban Server is not configured. Environment variables SHIKIBAN_SERVER_URL and SHIKIBAN_API_KEY are not set.',
        returnDisplay: 'Shikiban Server not configured',
      };
    }

    try {
      switch (args.action) {
        case 'create_session':
          return await this.createSession();
        case 'create_turn':
          // The execute method is primarily for LLM use
          // Programmatic calls should use createTurn directly with a sessionId
          return {
            summary: 'Use createTurn method directly',
            llmContent: 'For programmatic calls, use the createTurn method directly with a sessionId parameter',
            returnDisplay: 'Use createTurn method directly',
            error: {
              message: 'Use createTurn method directly for programmatic calls',
            },
          };
        default:
          return {
            summary: 'Unknown action',
            llmContent: `Unknown action: ${(args as any).action}`,
            returnDisplay: `Unknown action: ${(args as any).action}`,
            error: {
              message: `Unknown action: ${(args as any).action}`,
            },
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        summary: 'Shikiban tool error',
        llmContent: `Shikiban tool error: ${errorMessage}`,
        returnDisplay: `Shikiban tool error: ${errorMessage}`,
        error: {
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Create a new session on Shikiban Server.
   */
  public async createSession(): Promise<ToolResult & { sessionId?: string }> {
    const response = await fetch(`${this.config.serverUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: {
        'X-Shikiban-API-Key': this.config.apiKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create session: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as CreateSessionResponse;

    return {
      summary: 'Session created',
      llmContent: `Session created with ID: ${data.sessionId}`,
      returnDisplay: `Session created: ${data.sessionId}`,
      sessionId: data.sessionId,
    };
  }

  /**
   * Create a new turn in the specified session.
   */
  public async createTurn(sessionId: string, turnData: TurnData): Promise<ToolResult> {
    if (!this.config.serverUrl || !this.config.apiKey) {
      return {
        summary: 'Shikiban Server not configured',
        llmContent: 'Shikiban Server is not configured',
        returnDisplay: 'Shikiban Server not configured',
        error: {
          message: 'Shikiban Server not configured',
        },
      };
    }

    const response = await fetch(
      `${this.config.serverUrl}/api/v1/sessions/${sessionId}/turns`,
      {
        method: 'POST',
        headers: {
          'X-Shikiban-API-Key': this.config.apiKey!,
          'Content-Type': 'application/json',
        },
        body: safeJsonStringify(turnData),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create turn: ${response.status} - ${errorText}`);
    }

    return {
      summary: 'Turn created',
      llmContent: 'Turn created successfully',
      returnDisplay: 'Turn created successfully',
    };
  }

}

/**
 * Singleton instance of ShikibanTool for use across the application.
 */
export const shikibanTool = new ShikibanTool();

/**
 * Helper class to manage Shikiban session history logging.
 * This is designed to be used by the Logger class to send session data to Shikiban Server.
 */
export class ShikibanSessionManager {
  private static instance: ShikibanSessionManager;
  private shikibanTool: ShikibanTool;
  private config: Config | null = null;
  private sessionId: string | null = null;
  private isInitialized = false;

  private constructor() {
    this.shikibanTool = shikibanTool;
  }

  static getInstance(): ShikibanSessionManager {
    if (!ShikibanSessionManager.instance) {
      ShikibanSessionManager.instance = new ShikibanSessionManager();
    }
    return ShikibanSessionManager.instance;
  }

  /**
   * Initialize the manager with a config instance.
   */
  initialize(config: Config): void {
    this.config = config;
  }

  /**
   * Ensure a session exists, creating one if necessary.
   */
  async ensureSession(): Promise<string | null> {
    if (!process.env.SHIKIBAN_SERVER_URL || !process.env.SHIKIBAN_API_KEY) {
      return null;
    }

    if (this.sessionId) {
      return this.sessionId;
    }

    try {
      const result = await this.shikibanTool.createSession();
      
      if (!result.error && 'sessionId' in result && result.sessionId) {
        this.sessionId = result.sessionId;
        this.isInitialized = true;
      }
      
      return this.sessionId;
    } catch (error) {
      console.warn('Failed to create Shikiban session:', error);
      return null;
    }
  }

  /**
   * Log a turn to the Shikiban server.
   */
  async logTurn(turnData: TurnData): Promise<void> {
    if (!this.isInitialized) {
      await this.ensureSession();
    }

    if (!this.sessionId) {
      return;
    }

    try {
      await this.shikibanTool.createTurn(this.sessionId, turnData);
    } catch (error) {
      console.warn('Failed to log turn to Shikiban:', error);
    }
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }
}