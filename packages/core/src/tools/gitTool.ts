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
import {
  BaseDeclarativeTool, // Changed from BaseTool
  Kind,
  ToolResult,
  ToolInvocation, // Added
  ToolLocation, // Added
  ToolCallConfirmationDetails, // Added for shouldConfirmExecute return type
} from './tools.js';
import { Config } from '../config/config.js';
import { SchemaValidator } from '../utils/schemaValidator.js';

// Define the parameters for the GitTool
export interface GitToolParams {
  command: string;
  args?: string[];
  directory?: string;
  timeout?: number;
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
 * Represents an invocation of the Git tool.
 */
class GitToolInvocation implements ToolInvocation<GitToolParams, ToolResult> {
  constructor(
    public readonly params: GitToolParams,
    private readonly config: Config,
  ) {}

  getDescription(): string {
    const argsString = this.params.args ? ` ${this.params.args.join(' ')}` : '';
    const directoryString = this.params.directory
      ? ` in directory "${this.params.directory}"`
      : '';
    return `Executing Git command: "git ${this.params.command}${argsString}"${directoryString}`;
  }

  toolLocations(): ToolLocation[] {
    return [];
  }

  shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<false | ToolCallConfirmationDetails> {
    return Promise.resolve(false);
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
      let commandArgs: string[];
      
      // Handle case where command is 'git'
      if (params.command === 'git' && params.args && params.args.length > 0) {
        // Use first arg as the actual git command, rest as arguments
        commandArgs = params.args;
      } else {
        // Standard case: use command as git subcommand
        commandArgs = [params.command, ...(params.args || [])];
      }

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
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const processResponse = await this.executeGitCommand(
      this.params,
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

    let returnDisplay = `✅ Git command "git ${this.params.command}" executed successfully\n\n`;
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
      summary: `Git command "git ${this.params.command}" executed in ${processResponse.executionTime}ms`,
      llmContent: JSON.stringify(result, null, 2),
      returnDisplay,
    };
  }
}

/**
 * A tool for executing Git commands.
 */
export class GitTool extends BaseDeclarativeTool<GitToolParams, ToolResult> {
  static readonly Name: string = 'git_tool';
  public static readonly DEFAULT_TIMEOUT = 60000; // 1 minute // Changed from private
  public static readonly MAX_TIMEOUT = 300000; // 5 minutes // Changed from private

  constructor(private readonly config: Config) {
    super(
      GitTool.Name,
      'Git',
      'Executes Git commands robustly and securely.',
      Kind.Execute, // Or a more specific Git icon if available
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

  protected validateToolParams(params: GitToolParams): string | null {
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

    // Validate unsafe git add commands for safety
    if (params.command === 'add' && params.args) {
      const unsafeAddPatterns = ['.', '-A', '--all'];
      for (const arg of params.args) {
        if (unsafeAddPatterns.includes(arg)) {
          return `Git add with "${arg}" is disallowed for safety. Please add files explicitly by name.`;
        }
      }
    }

    return null;
  }

  protected createInvocation(
    params: GitToolParams,
  ): ToolInvocation<GitToolParams, ToolResult> {
    return new GitToolInvocation(params, this.config);
  }
}