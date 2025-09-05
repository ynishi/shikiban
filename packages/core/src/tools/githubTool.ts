/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// packages/core/src/tools/githubTool.ts

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

/**
 * Parameters for the GitHub CLI tool
 */
export interface GitHubToolParams {
  command: string;
  args?: string[];
  directory?: string;
  timeout?: number;
}

/**
 * Response structure from the GitHub CLI process
 */
interface GitHubProcessResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode: number | null;
  executionTime: number;
  errorMessage?: string;
}

/**
 * Represents an invocation of the GitHub CLI tool.
 */
class GitHubToolInvocation
  implements ToolInvocation<GitHubToolParams, ToolResult>
{
  constructor(
    public readonly params: GitHubToolParams,
    private readonly config: Config,
  ) {}

  getDescription(): string {
    const argsString = this.params.args ? ` ${this.params.args.join(' ')}` : '';
    const directoryString = this.params.directory
      ? ` in directory "${this.params.directory}"`
      : '';
    return `Executing GitHub CLI command: "gh ${this.params.command}${argsString}"${directoryString}`;
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
        console.error(`[GitHubTool] Failed to kill Windows process: ${err}`);
        process.kill('SIGTERM');
      }
    } else if (!isWindows && pidOrPgid) {
      try {
        global.process.kill(-pidOrPgid, 'SIGTERM');
      } catch (err) {
        console.error(`[GitHubTool] Failed to kill process group: ${err}`);
        process.kill('SIGTERM');
      }
    } else {
      process.kill('SIGTERM');
    }
  }

  private async executeGitHubCommand(
    params: GitHubToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<GitHubProcessResponse> {
    const startTime = Date.now();
    console.log(
      `[GitHubTool] executeGitHubCommand started for command: ${params.command}`,
    );

    return new Promise<GitHubProcessResponse>((resolve) => {
      const commandArgs = [params.command, ...(params.args || [])];

      console.log(`[GitHubTool] Spawning gh with args:`, commandArgs);
      const isWindows = os.platform() === 'win32';

      let ghProcess: ChildProcess;

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
            `[GitHubTool] endProcess called but process already ended. Success: ${success}, ExitCode: ${exitCode}, Error: ${error}`,
          );
          return;
        }
        processEnded = true;
        console.log(
          `[GitHubTool] endProcess called. Success: ${success}, ExitCode: ${exitCode}, Error: ${error}`,
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
        ghProcess = spawn('gh', commandArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: params.directory,
          shell: false,
          detached: !isWindows,
          env: {
            ...process.env,
            GEMINI_CLI: '1',
          },
        });
      } catch (err: any) {
        endProcess(
          false,
          null,
          `Failed to spawn GitHub CLI process: ${err.message}`,
        );
        return;
      }

      const timeout = params.timeout || GitHubTool.DEFAULT_TIMEOUT;
      timeoutId = setTimeout(() => {
        if (!processEnded) {
          console.log(
            `[GitHubTool] Process timed out after ${timeout}ms. Killing process.`,
          );
          this.killProcess(ghProcess, ghProcess.pid);
          endProcess(false, null, `Process timed out after ${timeout}ms`);
        }
      }, timeout);

      const abortHandler = () => {
        console.log(`[GitHubTool] Abort signal received.`);
        if (!processEnded) {
          this.killProcess(ghProcess, ghProcess.pid);
          endProcess(false, null, 'Process aborted by user');
        }
      };
      signal.addEventListener('abort', abortHandler);

      ghProcess.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        console.log(
          `[GitHubTool] STDOUT chunk received: ${chunk.substring(0, 100)}...`,
        );
        if (updateOutput) {
          updateOutput(chunk);
        }
      });

      ghProcess.stderr?.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        console.log(
          `[GitHubTool] STDERR chunk received: ${chunk.substring(0, 100)}...`,
        );
      });

      ghProcess.on('close', (code) => {
        console.log(`[GitHubTool] Process 'close' event. Code: ${code}`);
        signal.removeEventListener('abort', abortHandler);
        endProcess(code === 0, code !== null ? code : null);
      });

      ghProcess.on('error', (err) => {
        console.log(`[GitHubTool] Process 'error' event: ${err.message}`);
        signal.removeEventListener('abort', abortHandler);
        endProcess(
          false,
          null,
          `Failed to spawn GitHub CLI process: ${err.message}`,
        );
      });
    });
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const processResponse = await this.executeGitHubCommand(
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
        llmContent: `Error executing GitHub CLI command: ${errorMessage}`,
        returnDisplay: `❌ GitHub CLI command failed: ${errorMessage}`,
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

    let returnDisplay = `✅ GitHub CLI command "gh ${this.params.command}" executed successfully\n\n`;
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
      summary: `GitHub CLI command "gh ${this.params.command}" executed in ${processResponse.executionTime}ms`,
      llmContent: JSON.stringify(result, null, 2),
      returnDisplay,
    };
  }
}

/**
 * Tool for executing GitHub CLI (gh) commands
 *
 * This tool provides a safe and robust interface to execute GitHub CLI commands
 * with proper error handling, timeout support, and process management.
 *
 * @example
 * ```typescript
 * const result = await github_tool('pr', ['list'], '/path/to/repo', 30000);
 * ```
 */
export class GitHubTool extends BaseDeclarativeTool<GitHubToolParams, ToolResult> {
  static readonly Name: string = 'github_tool';
  public static readonly DEFAULT_TIMEOUT = 60000; // 1 minute // Changed from private
  public static readonly MAX_TIMEOUT = 600000; // 10 minutes // Changed from private

  constructor(private readonly config: Config) {
    super(
      GitHubTool.Name,
      'GitHub CLI',
      'Executes GitHub CLI (gh) commands for repository management, pull requests, issues, and more.',
      Kind.Execute,
      {
        type: Type.OBJECT,
        properties: {
          command: {
            type: Type.STRING,
            description:
              'The GitHub CLI subcommand to execute (e.g., "pr", "issue", "repo", "api").',
          },
          args: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'An array of arguments to pass to the GitHub CLI subcommand.',
          },
          directory: {
            type: Type.STRING,
            description:
              'Optional: The directory in which to execute the command. Defaults to the current working directory.',
          },
          timeout: {
            type: Type.NUMBER,
            description: `Optional timeout in milliseconds (default: ${GitHubTool.DEFAULT_TIMEOUT}, max: ${GitHubTool.MAX_TIMEOUT}).`,
          },
        },
        required: ['command'],
      },
      false, // output is not markdown
      true, // can update output (streaming)
    );
  }

  protected validateToolParams(params: GitHubToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.command || !params.command.trim()) {
      return 'GitHub CLI command cannot be empty or just whitespace.';
    }

    if (params.timeout !== undefined) {
      if (params.timeout <= 0) {
        return 'Timeout must be a positive number.';
      }
      if (params.timeout > GitHubTool.MAX_TIMEOUT) {
        return `Timeout cannot exceed ${GitHubTool.MAX_TIMEOUT / 1000 / 60} minutes (${GitHubTool.MAX_TIMEOUT}ms).`;
      }
    }

    return null;
  }

  protected createInvocation(
    params: GitHubToolParams,
  ): ToolInvocation<GitHubToolParams, ToolResult> {
    return new GitHubToolInvocation(params, this.config);
  }
}

/**
 * Executes a GitHub CLI (gh) command with the specified arguments
 *
 * @param command - The GitHub CLI subcommand to execute (e.g., "pr", "issue", "repo")
 * @param args - Optional array of arguments to pass to the command
 * @param directory - Optional directory to execute the command in
 * @param timeout - Optional timeout in milliseconds (max 600000ms / 10 minutes)
 * @returns Promise resolving to command execution results including stdout, stderr, exit_code, signal, and error
 *
 * @example
 * ```typescript
 * // List pull requests
 * const result = await github_tool('pr', ['list']);
 *
 * // Create a new issue
 * const result = await github_tool('issue', ['create', '--title', 'Bug report', '--body', 'Description']);
 *
 * // Use GitHub API directly
 * const result = await github_tool('api', ['/repos/owner/repo/releases']);
 * ```
 */
export async function github_tool(
  command: string,
  args?: string[],
  directory?: string,
  timeout?: number,
): Promise<{
  stdout: string;
  stderr: string;
  exit_code: number | null;
  signal: string | null;
  error: string | null;
}> {
  // This function would need to be implemented with access to the Config instance
  // In practice, this would be called through the tool registry system
  throw new Error(
    'github_tool function should be called through the tool registry system, not directly',
  );
}