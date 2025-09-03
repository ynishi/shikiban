/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolErrorType } from './tool-error.js';
import { Type } from '@google/genai';
import { 
  BaseDeclarativeTool, // Changed from BaseTool
  Icon,
  ToolResult,
  ToolInvocation, // Added
  ToolLocation, // Added
  ToolCallConfirmationDetails, // Added for shouldConfirmExecute return type
} from './tools.js';
import { Config } from '../config/config.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import WebSocket from 'ws';
import { execSync } from 'child_process';

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
 * Represents an invocation of the Shiki tool.
 */
class ShikiToolInvocation implements ToolInvocation<ShikiToolParams, ToolResult> {
  private subscriptions = new Map<string, WebSocket>();

  constructor(
    public readonly params: ShikiToolParams,
    private readonly config: Config,
  ) {}

  getDescription(): string {
    if (this.params.subcommand === 'create_task') {
      return `Creating Shiki task with prompt: "${this.params.prompt?.substring(0, 50)}"...`;
    }
    return `Executing Shiki command: ${this.params.subcommand}`;
  }

  toolLocations(): ToolLocation[] {
    return [];
  }

  shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<false | ToolCallConfirmationDetails> {
    return Promise.resolve(false);
  }

  private getGitOrigin(): string | null {
    try {
      const origin = execSync('git config --get remote.origin.url', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      return origin || null;
    } catch {
      return null;
    }
  }

  private getCurrentBranch(): string {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      return branch || 'main';
    } catch {
      return 'main';
    }
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
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const apiUrl = this.config.getShikiManagerApiUrl();

    try {
      switch (this.params.subcommand) {
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
          
          if (this.params.verbose) {
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
          const response = await fetch(`${apiUrl}/api/v1/tasks/${this.params.taskId}`, {
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
          
          // Use provided values or git defaults
          const repoOrigin = this.params.repo_origin || this.getGitOrigin();
          const branch = this.params.branch || this.getCurrentBranch();
          
          const taskDefinition: Record<string, unknown> = {
            prompt: this.params.prompt!,
            metadata: this.params.metadata || {},
          };
          
          // Always include repo_origin and branch for clarity
          if (repoOrigin) {
            taskDefinition.repo_origin = repoOrigin;
          }
          if (branch) {
            taskDefinition.branch = branch;
          }
          if (this.params.title) {
            taskDefinition.title = this.params.title;
          }
          if (this.params.files) {
            taskDefinition.files = this.params.files;
          }
          if (this.params.local_repo_dir) {
            taskDefinition.local_repo_dir = this.params.local_repo_dir;
          }
          if (this.params.post_execution_check_command) {
            taskDefinition.post_execution_check_command = this.params.post_execution_check_command;
          }
          if (this.params.keep_working_dir !== undefined) {
            taskDefinition.keep_working_dir = this.params.keep_working_dir;
          }
          if (this.params.working_dir_prefix) {
            taskDefinition.working_dir_prefix = this.params.working_dir_prefix;
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
            let errorMessage = `HTTP error: ${response.status}`;
            try {
              const errorText = await response.text();
              if (errorText) {
                try {
                  const errorData = JSON.parse(errorText);
                  errorMessage = errorData.error || errorData.message || errorMessage;
                } catch {
                  errorMessage = errorText;
                }
              }
            } catch {
              // Failed to read response text
            }
            throw new Error(errorMessage);
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
          const url = this.params.service_type
            ? `${apiUrl}/api/v1/services?service_type=${this.params.service_type}`
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
            summary: `Found ${data.length} services${this.params.service_type ? ` of type ${this.params.service_type}` : ''}.`,
            llmContent,
            returnDisplay: `Found ${data.length} services${this.params.service_type ? ` of type ${this.params.service_type}` : ''}.`,
          };
        }

        default:
          return {
            error: {
              message: `Unknown subcommand: ${this.params.subcommand}`,
              type: ToolErrorType.INVALID_TOOL_PARAMS,
            },
            llmContent: `Unknown subcommand: ${this.params.subcommand}`,
            returnDisplay: `❌ Unknown subcommand: ${this.params.subcommand}`,
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

/**
 * A tool to interact with the Shiki system.
 * Handles task management and WebSocket communication for real-time updates.
 */
export class ShikiTool extends BaseDeclarativeTool<ShikiToolParams, ToolResult> {
  static readonly Name: string = 'shiki_tool';

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
            description: 'Optional: The URL of the Git repository to clone.',
          },
          branch: {
            type: Type.STRING,
            description: 'Optional: The branch name to clone.',
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

  protected createInvocation(
    params: ShikiToolParams,
  ): ToolInvocation<ShikiToolParams, ToolResult> {
    return new ShikiToolInvocation(params, this.config);
  }
}
