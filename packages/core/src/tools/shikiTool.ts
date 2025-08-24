/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolErrorType } from './tool-error.js';
import { Type } from '@google/genai';
import { BaseTool, Icon, ToolResult } from './tools.js';
import { Config } from '../config/config.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { ShikiManagerTool } from './shikiManagerTool.js';
import WebSocket from 'ws';

export interface Task {
  id: string;
  status: string; // "Pending", "InProgress", "Completed", "Failed"
  prompt: string;
  result?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ShikiToolParams {
  subcommand: 'create_task' | 'get_task' | 'list_tasks';
  prompt?: string;
  taskId?: string;
}

/**
 * A high-level tool to interact with the Shiki system.
 * Handles asynchronous communication via WebSockets internally.
 */
export class ShikiTool extends BaseTool<ShikiToolParams, ToolResult> {
  static readonly Name: string = 'shiki_tool';
  private shikiManagerTool: ShikiManagerTool;
  private subscriptions = new Map<string, WebSocket>();

  constructor(private readonly config: Config) {
    super(
      ShikiTool.Name,
      'Shiki',
      'A high-level tool to create and manage tasks in the Shiki system.',
      Icon.Hammer, // Corrected Icon
      {
        type: Type.OBJECT,
        properties: {
          subcommand: {
            type: Type.STRING,
            description: 'The subcommand to execute: create_task, get_task, list_tasks',
            enum: ['create_task', 'get_task', 'list_tasks'],
          },
          prompt: {
            type: Type.STRING,
            description: 'The prompt for creating a new task. Required for `create_task`.',
          },
          taskId: {
            type: Type.STRING,
            description: 'The ID of the task to get. Required for `get_task`.',
          },
        },
        required: ['subcommand'],
      },
      false,
      true // canUpdateOutput = true
    );

    this.shikiManagerTool = new ShikiManagerTool(this.config);
  }

  validateToolParams(params: ShikiToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    switch (params.subcommand) {
      case 'create_task':
        if (!params.prompt) {
          return 'Missing required parameter: prompt';
        }
        break;
      case 'get_task':
        if (!params.taskId) {
          return 'Missing required parameter: taskId';
        }
        break;
      case 'list_tasks':
        break;
      default:
        return `Invalid subcommand: ${params.subcommand}`;
    }

    return null;
  }

  getDescription(params: ShikiToolParams): string {
    if (params.subcommand === 'create_task') {
      return `Creating Shiki task with prompt: "${params.prompt?.substring(0, 50)}..."`;
    }
    return `Executing Shiki command: ${params.subcommand}`;
  }

  private toApiTask(data: any): Task {
    return {
      id: data.id,
      status: data.status,
      prompt: data.definition?.prompt || '',
      createdAt: data.created_at,
      result: data.result,
    };
  }

  closeAllSubscriptions() {
    for (const [taskId, ws] of this.subscriptions.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      this.subscriptions.delete(taskId);
    }
  }

  async execute(
    params: ShikiToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        error: {
          message: validationError,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
        llmContent: validationError,
        returnDisplay: `❌ Error: ${validationError}`,
      };
    }

    try {
      switch (params.subcommand) {
        case 'list_tasks': {
          const result = await this.shikiManagerTool.execute(
            { subcommand: 'list_tasks', args: ['--verbose'] },
            signal
          );

          if (result.error || !result.llmContent) {
            throw new Error(result.error?.message || 'Failed to list tasks');
          }
          
          const tasks = JSON.parse(result.llmContent as string).data.map(this.toApiTask);
          const llmContent = JSON.stringify(tasks, null, 2);
          return {
            summary: `Found ${tasks.length} tasks.`,
            llmContent,
            returnDisplay: `Found ${tasks.length} tasks.`,
          };
        }

        case 'get_task': {
          const result = await this.shikiManagerTool.execute(
            { subcommand: 'get_task', args: [params.taskId!] },
            signal
          );

          if (result.error || !result.llmContent) {
            throw new Error(result.error?.message || 'Failed to get task');
          }

          const task = this.toApiTask(JSON.parse(result.llmContent as string).data);
          const llmContent = JSON.stringify(task, null, 2);
          return {
            summary: `Fetched task ${task.id}`,
            llmContent,
            returnDisplay: `Fetched task ${task.id}`,
          };
        }

        case 'create_task': {
          updateOutput?.('⏳ Task creation initiated...');
          const result = await this.shikiManagerTool.execute(
            { subcommand: 'create_task', args: [params.prompt!] },
            signal
          );

          if (result.error || !result.llmContent) {
            throw new Error(result.error?.message || 'Failed to create task');
          }
          
          const task = this.toApiTask(JSON.parse(result.llmContent as string).data);
          updateOutput?.(`✅ Task created with ID: ${task.id}`);

          // --- WebSocket Implementation ---
          const wsUrl = this.config.getShikiManagerApiUrl().replace(/^http/, 'ws') + `/api/v1/tasks/${task.id}/ws`;
          const ws = new WebSocket(wsUrl);
          this.subscriptions.set(task.id, ws);

          ws.on('open', () => {
            updateOutput?.(`[WS] 🔌 Connection established for task ${task.id}. Waiting for updates...`);
          });

          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              if (message.status) {
                 updateOutput?.(`[WS] 🔄 Task ${task.id} status: ${message.status}`);
              }
              if (message.result) {
                updateOutput?.(`[WS] ✨ Task ${task.id} result: ${JSON.stringify(message.result)}`);
              }
            } catch (e) {
              updateOutput?.(`[WS] Received raw message: ${data.toString()}`);
            }
          });

          ws.on('error', (error) => {
            updateOutput?.(`[WS] ❌ Error for task ${task.id}: ${error.message}`);
            this.subscriptions.delete(task.id);
          });

          ws.on('close', (code, reason) => {
            updateOutput?.(`[WS] 🔌 Connection closed for task ${task.id}. Code: ${code}, Reason: ${reason.toString()}`);
            this.subscriptions.delete(task.id);
          });
          
          const llmContent = JSON.stringify(task, null, 2);
          return {
            summary: `Created task ${task.id}`,
            llmContent,
            returnDisplay: `Created task ${task.id}`,
          };
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        error: { message, type: ToolErrorType.UNHANDLED_EXCEPTION },
        llmContent: message,
        returnDisplay: `❌ Error: ${message}`,
      };
    }
  }
}