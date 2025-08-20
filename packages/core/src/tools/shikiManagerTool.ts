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

export interface ShikiManagerToolParams {
  subcommand: string;
  args?: string[];
}

interface ShikiManagerResponse {
  success: boolean;
  data?: any;
  error?: string;
  formattedDisplay?: string;
}

/**
 * A tool for managing the Shiki system.
 */
export class ShikiManagerTool extends BaseTool<
  ShikiManagerToolParams,
  ToolResult
> {
  static readonly Name: string = 'shiki_manager_tool';
  private static readonly DEFAULT_TIMEOUT = 30000; // 30 seconds

  constructor(private readonly config: Config) {
    super(
      ShikiManagerTool.Name,
      'ShikiManager',
      'A tool to manage the Shiki system, with subcommands: create_task, get_task, list_tasks, list_services',
      Icon.Hammer,
      {
        type: Type.OBJECT,
        properties: {
          subcommand: {
            type: Type.STRING,
            description:
              'The subcommand to execute: create_task, get_task, list_tasks, or list_services',
          },
          args: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
            description: 'Arguments for the subcommand',
          },
        },
        required: ['subcommand'],
      },
      false, // output is not markdown
      false, // does not update output
    );
  }

  /**
   * Validates the parameters for the tool.
   * @param params The parameters to validate.
   * @returns A string containing the validation error, or null if validation succeeds.
   */
  validateToolParams(params: ShikiManagerToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.subcommand || !params.subcommand.trim()) {
      return 'Subcommand cannot be empty or just whitespace.';
    }

    const validSubcommands = [
      'create_task',
      'get_task',
      'list_tasks',
      'list_services',
    ];
    if (!validSubcommands.includes(params.subcommand)) {
      return `Invalid subcommand: ${params.subcommand}. Valid subcommands are: ${validSubcommands.join(', ')}`;
    }

    return null;
  }

  /**
   * Gets a description of the tool's operation for logging.
   * @param params The parameters for the tool.
   * @returns A string describing the tool's operation.
   */
  getDescription(params: ShikiManagerToolParams): string {
    return `Executing Shiki Manager subcommand: ${params.subcommand}`;
  }

  /**
   * Executes the specified subcommand.
   * @param params The parameters for the tool.
   * @param signal An AbortSignal to cancel the operation.
   * @returns A promise that resolves with the subcommand response.
   */
  private async executeSubcommand(
    params: ShikiManagerToolParams,
    signal: AbortSignal,
  ): Promise<ShikiManagerResponse> {
    const { subcommand, args = [] } = params;

    switch (subcommand) {
      case 'create_task':
        const prompt = args[0];
        if (!prompt) {
          return {
            success: false,
            error: 'Missing required argument: prompt',
          };
        }

        try {
          const response = await fetch(
            `${this.config.getShikiManagerApiUrl()}/api/v1/tasks`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                metadata: {},
                prompt: prompt,
                working_directory: './',
              }),
              signal,
            },
          );

          if (!response.ok) {
            const errorData = await response.json();
            return {
              success: false,
              error: errorData.error || `HTTP error: ${response.status}`,
            };
          }

          const data = await response.json();
          return {
            success: true,
            data,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            success: false,
            error: `Network error: ${message}`,
          };
        }

      case 'get_task':
        const taskId = args[0];
        if (!taskId) {
          return {
            success: false,
            error: 'Missing required argument: task_id',
          };
        }

        try {
          const response = await fetch(
            `${this.config.getShikiManagerApiUrl()}/api/v1/tasks/${taskId}`,
            {
              method: 'GET',
              signal,
            },
          );

          if (!response.ok) {
            const errorData = await response.json();
            return {
              success: false,
              error: errorData.error || `HTTP error: ${response.status}`,
            };
          }

          const data = await response.json();
          return {
            success: true,
            data,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            success: false,
            error: `Network error: ${message}`,
          };
        }

      case 'list_tasks':
        const isVerbose = args.includes('--verbose');
        const filteredArgs = args.filter((arg) => arg !== '--verbose');

        try {
          const response = await fetch(
            `${this.config.getShikiManagerApiUrl()}/api/v1/tasks`,
            {
              method: 'GET',
              signal,
            },
          );

          if (!response.ok) {
            const errorData = await response.json();
            return {
              success: false,
              error: errorData.error || `HTTP error: ${response.status}`,
            };
          }

          const data = await response.json();

          if (isVerbose) {
            return {
              success: true,
              data,
            };
          } else {
            const tableString = this._formatTasksAsTable(data);
            return {
              success: true,
              data,
              formattedDisplay: tableString,
            };
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            success: false,
            error: `Network error: ${message}`,
          };
        }

      case 'list_services':
        try {
          const serviceType = args[0];
          const url = serviceType
            ? `${this.config.getShikiManagerApiUrl()}/api/v1/services?service_type=${serviceType}`
            : `${this.config.getShikiManagerApiUrl()}/api/v1/services`;

          const response = await fetch(url, {
            method: 'GET',
            signal,
          });

          if (!response.ok) {
            const errorData = await response.json();
            return {
              success: false,
              error: errorData.error || `HTTP error: ${response.status}`,
            };
          }

          const data = await response.json();
          return {
            success: true,
            data,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            success: false,
            error: `Network error: ${message}`,
          };
        }

      default:
        return {
          success: false,
          error: `Unknown subcommand: ${subcommand}`,
        };
    }
  }

  /**
   * Formats tasks as a formatted table.
   * @param tasks The array of task objects to format.
   * @returns A formatted string table.
   */
  private _formatTasksAsTable(tasks: any[]): string {
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

    // Top border
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

    // Header
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

    // Header separator
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

    // Data rows
    tasks.forEach((task, index) => {
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

    // Bottom border
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

  /**
   * Executes the tool.
   * @param params The parameters for the tool.
   * @param signal An AbortSignal to cancel the process.
   * @param updateOutput A callback to stream output updates (not used for this tool).
   * @returns A promise that resolves with the tool's result.
   */
  async execute(
    params: ShikiManagerToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    // Validate parameters
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: `❌ ${validationError}`,
        error: {
          message: validationError,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Execute the subcommand
    const response = await this.executeSubcommand(params, signal);

    // Handle execution failure
    if (!response.success) {
      const errorMessage = response.error || 'Unknown error occurred';
      return {
        llmContent: `Error executing Shiki Manager subcommand: ${errorMessage}`,
        returnDisplay: `❌ Shiki Manager execution failed: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.UNKNOWN,
        },
      };
    }

    // Check if we have a formatted display
    if (response.formattedDisplay) {
      return {
        summary: `Shiki Manager executed: ${params.subcommand}`,
        llmContent: response.formattedDisplay,
        returnDisplay: response.formattedDisplay,
      };
    }

    // Format the result
    const result = {
      subcommand: params.subcommand,
      args: params.args,
      data: response.data,
    };

    // Create a user-friendly summary
    let returnDisplay = `✅ Shiki Manager executed successfully\n\n`;
    returnDisplay += `**Subcommand:** ${params.subcommand}\n`;
    if (params.args && params.args.length > 0) {
      returnDisplay += `**Arguments:** ${params.args.join(', ')}\n`;
    }
    returnDisplay += `\n**Result:**\n${response.data}`;

    return {
      summary: `Shiki Manager executed: ${params.subcommand}`,
      llmContent: JSON.stringify(result, null, 2),
      returnDisplay,
    };
  }

  /**
   * Returns a usage message for the tool.
   * @returns A string with usage information.
   */
  static getUsageMessage(): string {
    return `
Shiki Manager Tool Usage:

Available subcommands:
  - create_task <prompt>     : Create a new task with the given prompt
  - get_task <task_id>       : Retrieve a task by its ID
  - list_tasks [--verbose]     : List all available tasks (shows summary by default)
  - list_services [type]     : List all available services (optionally filtered by type)

Example usage:
  shiki_manager_tool create_task "Process this data"
  shiki_manager_tool get_task task123
  shiki_manager_tool list_tasks
  shiki_manager_tool list_services
    `.trim();
  }
}
