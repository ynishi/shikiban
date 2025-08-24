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
import WebSocket from 'ws';

export interface Task {
  id: string;
  status: string;
  prompt: string;
  result?: Record<string, unknown> | null;
  createdAt: string;
}

interface ApiTaskData {
  id: string;
  status: string;
  created_at: string;
  definition?: {
    prompt?: string;
    [key: string]: unknown;
  };
  result?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ShikiToolParams {
  subcommand: 'create_task' | 'get_task' | 'list_tasks' | 'list_services';
  prompt?: string;
  taskId?: string;
  title?: string;
  repo_origin?: string;
  branch?: string;
  files?: Record<string, string>;
  local_repo_dir?: string;
  metadata?: Record<string, unknown>;
  post_execution_check_command?: string;
  keep_working_dir?: boolean;
  working_dir_prefix?: string;
  verbose?: boolean;
  service_type?: string;
}

/**
 * A tool to interact with the Shiki system.
 * Handles task management and WebSocket communication for real-time updates.
 */
export class ShikiTool extends BaseTool<ShikiToolParams, ToolResult> {
  static readonly Name: string = 'shiki_tool';
  private subscriptions = new Map<string, WebSocket>();

  constructor(private readonly config: Config) {
    super(
      ShikiTool.Name,
      'Shiki',
      'A tool to create and manage tasks in the Shiki system.',
      Icon.Hammer,
      {
        type: Type.OBJECT,
        properties: {
          subcommand: {
            type: Type.STRING,
            description: 'The subcommand to execute: create_task, get_task, list_tasks, list_services',
            enum: ['create_task', 'get_task', 'list_tasks', 'list_services'],
          },
          prompt: {
            type: Type.STRING,
            description: 'The prompt for creating a new task. Required for create_task.',
          },
          taskId: {
            type: Type.STRING,
            description: 'The ID of the task to get. Required for get_task.',
          },
          title: {
            type: Type.STRING,
            description: 'Optional: Title for the task.',
          },
          repo_origin: {
            type: Type.STRING,
            description: 'The URL of the Git repository to clone. Required for create_task.',
          },
          branch: {
            type: Type.STRING,
            description: 'The branch name to clone. Required for create_task.',
          },
          files: {
            type: Type.OBJECT,
            description: 'Optional: Map of file paths to file contents to include in the task.',
          },
          local_repo_dir: {
            type: Type.STRING,
            description: 'Optional: Path to a local repository directory.',
          },
          metadata: {
            type: Type.OBJECT,
            description: 'Optional: Additional metadata for the task.',
          },
          post_execution_check_command: {
            type: Type.STRING,
            description: 'Optional: Command to run after task execution for validation.',
          },
          keep_working_dir: {
            type: Type.BOOLEAN,
            description: 'Optional: Whether to keep the working directory after task completion. Defaults to false.',
          },
          working_dir_prefix: {
            type: Type.STRING,
            description: 'Optional: Prefix for the working directory name.',
          },
          verbose: {
            type: Type.BOOLEAN,
            description: 'Optional: Show detailed output for list_tasks. Defaults to false.',
          },
          service_type: {
            type: Type.STRING,
            description: 'Optional: Filter services by type for list_services.',
          },
        },
        required: ['subcommand'],
      },
      false,
      true
    );
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
        if (!params.repo_origin) {
          return 'Missing required parameter: repo_origin';
        }
        if (!params.branch) {
          return 'Missing required parameter: branch';
        }
        break;
      case 'get_task':
        if (!params.taskId) {
          return 'Missing required parameter: taskId';
        }
        break;
      case 'list_tasks':
      case 'list_services':
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

  private toApiTask(data: ApiTaskData): Task {
    return {
      id: data.id,
      status: data.status,
      prompt: data.definition?.prompt || '',
      createdAt: data.created_at,
      result: data.result,
    };
  }

  private formatTasksAsTable(tasks: ApiTaskData[]): string {
    if (!tasks || tasks.length === 0) {
      return 'No tasks found.';
    }

    const columnWidths = {
      id: 38,
      status: 10,
      createdAt: 21,
      prompt: 62,
    };

    let table = '';

    table +=
      '┌' +
      '─'.repeat(columnWidths.id) +
      '┬' +
      '─'.repeat(columnWidths.status) +
      '┬' +
      '─'.repeat(columnWidths.createdAt) +
      '┬' +
      '─'.repeat(columnWidths.prompt) +
      '┐\n';

    table +=
      '│ ' +
      'ID'.padEnd(columnWidths.id - 2) +
      ' │ ' +
      'Status'.padEnd(columnWidths.status - 2) +
      ' │ ' +
      'Created At'.padEnd(columnWidths.createdAt - 2) +
      ' │ ' +
      'Prompt'.padEnd(columnWidths.prompt - 2) +
      ' │\n';

    table +=
      '├' +
      '─'.repeat(columnWidths.id) +
      '┼' +
      '─'.repeat(columnWidths.status) +
      '┼' +
      '─'.repeat(columnWidths.createdAt) +
      '┼' +
      '─'.repeat(columnWidths.prompt) +
      '┤\n';

    tasks.forEach((task) => {
      const id = task.id || '';
      const status = task.status || '';
      const createdAt = task.created_at
        ? new Date(task.created_at).toLocaleString('sv')
        : '';
      const prompt = task.definition?.prompt || '';
      const truncatedPrompt =
        prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt;

      table +=
        '│ ' +
        id.padEnd(columnWidths.id - 2) +
        ' │ ' +
        status.padEnd(columnWidths.status - 2) +
        ' │ ' +
        createdAt.padEnd(columnWidths.createdAt - 2) +
        ' │ ' +
        truncatedPrompt.padEnd(columnWidths.prompt - 2) +
        ' │\n';
    });

    table +=
      '└' +
      '─'.repeat(columnWidths.id) +
      '┴' +
      '─'.repeat(columnWidths.status) +
      '┴' +
      '─'.repeat(columnWidths.createdAt) +
      '┴' +
      '─'.repeat(columnWidths.prompt) +
      '┘';

    return table;
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

    const apiUrl = this.config.getShikiManagerApiUrl();

    try {
      switch (params.subcommand) {
        case 'list_tasks': {
          const response = await fetch(`${apiUrl}/api/v1/tasks`, {
            method: 'GET',
            signal,
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error: ${response.status}`);
          }

          const data = await response.json();
          
          if (params.verbose) {
            const tasks = data.map(this.toApiTask);
            const llmContent = JSON.stringify(tasks, null, 2);
            return {
              summary: `Found ${tasks.length} tasks.`,
              llmContent,
              returnDisplay: `Found ${tasks.length} tasks.`,
            };
          } else {
            const tableString = this.formatTasksAsTable(data);
            return {
              summary: `Found ${data.length} tasks.`,
              llmContent: JSON.stringify(data.map(this.toApiTask), null, 2),
              returnDisplay: tableString,
            };
          }
        }

        case 'get_task': {
          const response = await fetch(`${apiUrl}/api/v1/tasks/${params.taskId}`, {
            method: 'GET',
            signal,
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error: ${response.status}`);
          }

          const data = await response.json();
          const task = this.toApiTask(data);
          const llmContent = JSON.stringify(task, null, 2);
          return {
            summary: `Fetched task ${task.id}`,
            llmContent,
            returnDisplay: `Fetched task ${task.id}\nStatus: ${task.status}\nPrompt: ${task.prompt}`,
          };
        }

        case 'create_task': {
          updateOutput?.('⏳ Task creation initiated...');
          
          const taskDefinition: Record<string, unknown> = {
            prompt: params.prompt!,
            repo_origin: params.repo_origin!,
            branch: params.branch!,
          };
          
          if (params.title) {
            taskDefinition.title = params.title;
          }
          if (params.files) {
            taskDefinition.files = params.files;
          }
          if (params.local_repo_dir) {
            taskDefinition.local_repo_dir = params.local_repo_dir;
          }
          if (params.metadata) {
            taskDefinition.metadata = params.metadata;
          }
          if (params.post_execution_check_command) {
            taskDefinition.post_execution_check_command = params.post_execution_check_command;
          }
          if (params.keep_working_dir !== undefined) {
            taskDefinition.keep_working_dir = params.keep_working_dir;
          }
          if (params.working_dir_prefix) {
            taskDefinition.working_dir_prefix = params.working_dir_prefix;
          }
          
          const response = await fetch(`${apiUrl}/api/v1/tasks`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(taskDefinition),
            signal,
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error: ${response.status}`);
          }
          
          const data = await response.json();
          const task = this.toApiTask(data);
          updateOutput?.(`✅ Task created with ID: ${task.id}`);

          // WebSocket subscription for real-time updates
          const wsUrl = apiUrl.replace(/^http/, 'ws') + `/api/v1/tasks/${task.id}/ws`;
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
            } catch (_e) {
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
            returnDisplay: `Created task ${task.id}\nStatus: ${task.status}\nPrompt: ${task.prompt}`,
          };
        }

        case 'list_services': {
          const url = params.service_type
            ? `${apiUrl}/api/v1/services?service_type=${params.service_type}`
            : `${apiUrl}/api/v1/services`;

          const response = await fetch(url, {
            method: 'GET',
            signal,
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error: ${response.status}`);
          }

          const data = await response.json();
          const llmContent = JSON.stringify(data, null, 2);
          return {
            summary: `Found ${data.length} services${params.service_type ? ` of type ${params.service_type}` : ''}.`,
            llmContent,
            returnDisplay: `Found ${data.length} services${params.service_type ? ` of type ${params.service_type}` : ''}.`,
          };
        }

        default:
          return {
            error: {
              message: `Unknown subcommand: ${params.subcommand}`,
              type: ToolErrorType.INVALID_TOOL_PARAMS,
            },
            llmContent: `Unknown subcommand: ${params.subcommand}`,
            returnDisplay: `❌ Unknown subcommand: ${params.subcommand}`,
          };
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