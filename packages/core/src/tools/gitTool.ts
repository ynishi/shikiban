/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// packages/core/src/tools/gitTool.ts

import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import { ToolErrorType } from './tool-error.js';
import { Type } from '@google/genai';
import { BaseTool, Icon, ToolResult } from './tools.js';
import { Config } from '../config/config.js';
import { SchemaValidator } from '../utils/schemaValidator.js';

// Define the parameters for the GitTool
export interface GitToolParams {
  command: string;
  args?: string[];
  directory?: string;
  timeout?: number; // Optional: similar to ClaudeCodeTool
}

// Define the structure of the response from the Git process
interface GitProcessResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode: number | null;
  executionTime: number;
  errorMessage?: string;
}

/**
 * A tool for executing Git commands.
 */
export class GitTool extends BaseTool<GitToolParams, ToolResult> {
  static readonly Name: string = 'git_tool';
  private static readonly DEFAULT_TIMEOUT = 60000; // 1 minute
  private static readonly MAX_TIMEOUT = 300000; // 5 minutes

  constructor(private readonly config: Config) {
    super(
      GitTool.Name,
      'Git',
      'Executes Git commands robustly and securely.',
      Icon.Terminal, // Or a more specific Git icon if available
      {
        type: Type.OBJECT,
        properties: {
          command: {
            type: Type.STRING,
            description:
              'The Git subcommand to execute (e.g., "status", "add", "commit").',
          },
          args: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'An array of arguments to pass to the Git subcommand.',
          },
          directory: {
            type: Type.STRING,
            description:
              'Optional: The directory in which to execute the Git command. Defaults to the current working directory.',
          },
          timeout: {
            type: Type.NUMBER,
            description: `Optional timeout in milliseconds (default: ${GitTool.DEFAULT_TIMEOUT}).`,
          },
        },
        required: ['command'],
      },
      false, // output is not markdown
      true, // can update output (streaming)
    );
  }

  validateToolParams(params: GitToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.command || !params.command.trim()) {
      return 'Git command cannot be empty or just whitespace.';
    }

    if (params.timeout !== undefined) {
      if (params.timeout <= 0) {
        return 'Timeout must be a positive number.';
      }
      if (params.timeout > GitTool.MAX_TIMEOUT) {
        return `Timeout cannot exceed ${GitTool.MAX_TIMEOUT / 1000 / 60} minutes (${GitTool.MAX_TIMEOUT}ms).`;
      }
    }

    // TODO: Add more specific validation for Git commands/args if necessary

    return null;
  }

  getDescription(params: GitToolParams): string {
    const argsString = params.args ? ` ${params.args.join(' ')}` : '';
    const directoryString = params.directory
      ? ` in directory "${params.directory}"`
      : '';
    return `Executing Git command: "git ${params.command}${argsString}"${directoryString}`;
  }

  private killProcess(process: ChildProcess, pidOrPgid?: number): void {
    const isWindows = os.platform() === 'win32';

    if (isWindows && process.pid) {
      try {
        spawn('taskkill', ['/t', '/f', '/pid', process.pid.toString()], {
          stdio: 'ignore',
        });
      } catch (err) {
        console.error(`[GitTool] Failed to kill Windows process: ${err}`);
        process.kill('SIGTERM');
      }
    } else if (!isWindows && pidOrPgid) {
      try {
        global.process.kill(-pidOrPgid, 'SIGTERM');
      } catch (err) {
        console.error(`[GitTool] Failed to kill process group: ${err}`);
        process.kill('SIGTERM');
      }
    } else {
      process.kill('SIGTERM');
    }
  }

  private async executeGitCommand(
    params: GitToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<GitProcessResponse> {
    const startTime = Date.now();
    console.log(
      `[GitTool] executeGitCommand started for command: ${params.command}`,
    );

    return new Promise<GitProcessResponse>((resolve) => {
      const commandArgs = [params.command, ...(params.args || [])];

      console.log(`[GitTool] Spawning git with args:`, commandArgs);
      const isWindows = os.platform() === 'win32';

      let gitProcess: ChildProcess;

      let stdout = '';
      let stderr = '';
      let processEnded = false;
      let timeoutId: NodeJS.Timeout | null = null;

      const endProcess = (
        success: boolean,
        exitCode: number | null = null,
        error?: string,
      ) => {
        if (processEnded) {
          console.log(
            `[GitTool] endProcess called but process already ended. Success: ${success}, ExitCode: ${exitCode}, Error: ${error}`,
          );
          return;
        }
        processEnded = true;
        console.log(
          `[GitTool] endProcess called. Success: ${success}, ExitCode: ${exitCode}, Error: ${error}`,
        );

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        const executionTime = Date.now() - startTime;
        resolve({
          success,
          stdout,
          stderr,
          exitCode,
          executionTime,
          ...(error && { errorMessage: error }),
        });
      };

      try {
        gitProcess = spawn('git', commandArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: params.directory, // Set working directory
          shell: false,
          detached: !isWindows,
          env: {
            ...process.env,
            GEMINI_CLI: '1',
          },
        });
      } catch (err: any) {
        endProcess(false, null, `Failed to spawn Git process: ${err.message}`);
        return;
      }

      const timeout = params.timeout || GitTool.DEFAULT_TIMEOUT;
      timeoutId = setTimeout(() => {
        if (!processEnded) {
          console.log(
            `[GitTool] Process timed out after ${timeout}ms. Killing process.`,
          );
          this.killProcess(gitProcess, gitProcess.pid);
          endProcess(false, null, `Process timed out after ${timeout}ms`);
        }
      }, timeout);

      const abortHandler = () => {
        console.log(`[GitTool] Abort signal received.`);
        if (!processEnded) {
          this.killProcess(gitProcess, gitProcess.pid);
          endProcess(false, null, 'Process aborted by user');
        }
      };
      signal.addEventListener('abort', abortHandler);

      gitProcess.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        console.log(
          `[GitTool] STDOUT chunk received: ${chunk.substring(0, 100)}...`,
        );
        if (updateOutput) {
          updateOutput(chunk);
        }
      });

      gitProcess.stderr?.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        console.log(
          `[GitTool] STDERR chunk received: ${chunk.substring(0, 100)}...`,
        );
      });

      gitProcess.on('close', (code) => {
        console.log(`[GitTool] Process 'close' event. Code: ${code}`);
        signal.removeEventListener('abort', abortHandler);
        endProcess(code === 0, code !== null ? code : null);
      });

      gitProcess.on('error', (err) => {
        console.log(`[GitTool] Process 'error' event: ${err.message}`);
        signal.removeEventListener('abort', abortHandler);
        endProcess(false, null, `Failed to spawn Git process: ${err.message}`);
      });
    });
  }

  async execute(
    params: GitToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
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

    const processResponse = await this.executeGitCommand(
      params,
      signal,
      updateOutput,
    );

    if (!processResponse.success) {
      const errorMessage =
        processResponse.stderr ||
        processResponse.errorMessage ||
        'Unknown error occurred';
      return {
        llmContent: `Error executing Git command: ${errorMessage}`,
        returnDisplay: `❌ Git command failed: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.UNKNOWN,
        },
      };
    }

    const metadata = {
      executionTime: processResponse.executionTime,
      exitCode: processResponse.exitCode,
    };

    const result = {
      stdout: processResponse.stdout,
      stderr: processResponse.stderr,
      metadata,
    };

    let returnDisplay = `✅ Git command "git ${params.command}" executed successfully\n\n`;
    if (processResponse.stdout) {
      returnDisplay +=
        '**STDOUT:**\n```\n' + processResponse.stdout + '\n```\n';
    }
    if (processResponse.stderr) {
      returnDisplay +=
        '**STDERR:**\n```\n' + processResponse.stderr + '\n```\n';
    }
    returnDisplay += `\n**Execution Time:** ${processResponse.executionTime}ms`;
    returnDisplay += `\n**Exit Code:** ${processResponse.exitCode}`;

    return {
      summary: `Git command "git ${params.command}" executed in ${processResponse.executionTime}ms`,
      llmContent: JSON.stringify(result, null, 2),
      returnDisplay,
    };
  }
}
