/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import { ToolErrorType } from './tool-error.js';
import { Type } from '@google/genai';
import {
  BaseDeclarativeTool,
  Kind,
  ToolResult,
  ToolInvocation,
  ToolLocation,
  ToolCallConfirmationDetails, // Added for shouldConfirmExecute return type
} from './tools.js';
import { Config } from '../config/config.js';
import { SchemaValidator } from '../utils/schemaValidator.js';

// Define the parameters for the ClaudeCodeTool
export interface ClaudeCodeToolParams {
  prompt: string;
  timeout?: number;
  continue?: boolean;
}

// Define the structure of the response from the Claude Code CLI process
interface ClaudeCodeProcessResponse {
  success: boolean;
  output?: string;
  error?: string;
  executionTime: number;
}

// Define type-safe output interfaces
export interface ClaudeCodeSuccessOutput {
  [key: string]: unknown;
}

export interface ClaudeCodeRawOutput {
  rawOutput: string;
}

export type ParsedClaudeOutput = ClaudeCodeSuccessOutput | ClaudeCodeRawOutput;

/**
 * Represents an invocation of the Claude Code tool.
 */
class ClaudeCodeToolInvocation
  implements ToolInvocation<ClaudeCodeToolParams, ToolResult>
{
  constructor(
    public readonly params: ClaudeCodeToolParams,
    private readonly config: Config,
  ) {}

  getDescription(): string {
    const promptPreview =
      this.params.prompt.length > 200
        ? `${this.params.prompt.substring(0, 200)}...`
        : this.params.prompt;
    return `Executing Claude Code with prompt: "${promptPreview}"`;
  }

  toolLocations(): ToolLocation[] {
    return [];
  }

  shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<false | ToolCallConfirmationDetails> {
    return Promise.resolve(false);
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    // Execute Claude Code
    const processResponse = await this.executeClaudeCode(
      this.params,
      signal,
      updateOutput,
    );

    // Handle execution failure
    if (!processResponse.success) {
      const errorMessage = processResponse.error || 'Unknown error occurred';
      return {
        llmContent: `Error executing Claude Code: ${errorMessage}`,
        returnDisplay: `❌ Claude Code execution failed: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.UNKNOWN,
        },
      };
    }

    // Parse the output
    const parsedOutput = this.parseClaudeOutput(processResponse.output || '');

    // Format the result
    const metadata = {
      executionTime: processResponse.executionTime,
    };

    const result = {
      output: parsedOutput,
      metadata,
    };

    // Create a user-friendly summary
    let returnDisplay = '✅ Claude Code executed successfully\n\n';

    // Use type guard to check if parsing failed
    if (this.isRawOutput(parsedOutput)) {
      // If parsing failed, show raw output
      returnDisplay +=
        '**Raw Output:**\n```\n' + parsedOutput.rawOutput + '\n```\n';
    } else {
      // If parsing succeeded, format the output nicely
      returnDisplay +=
        '**Result:**\n```json\n' +
        JSON.stringify(parsedOutput, null, 2) +
        '\n```\n';
    }

    returnDisplay += `\n**Execution Time:** ${processResponse.executionTime}ms`;

    return {
      summary: `Claude Code executed in ${processResponse.executionTime}ms`,
      llmContent: JSON.stringify(result, null, 2),
      returnDisplay,
    };
  }

  /**
   * Helper function to kill a process robustly.
   * @param process The child process to kill.
   * @param pidOrPgid The process ID or process group ID.
   */
  private killProcess(process: ChildProcess, pidOrPgid?: number): void {
    const isWindows = os.platform() === 'win32';

    if (isWindows && process.pid) {
      // On Windows, use taskkill to terminate the process tree
      try {
        spawn('taskkill', ['/t', '/f', '/pid', process.pid.toString()], {
          stdio: 'ignore',
        });
      } catch (err) {
        console.error(
          `[ClaudeCodeTool] Failed to kill Windows process: ${err}`,
        );
        // Fallback to regular kill
        process.kill('SIGTERM');
      }
    } else if (!isWindows && pidOrPgid) {
      // On non-Windows, kill the process group
      try {
        global.process.kill(-pidOrPgid, 'SIGTERM');
      } catch (err) {
        console.error(`[ClaudeCodeTool] Failed to kill process group: ${err}`);
        // Fallback to regular kill
        process.kill('SIGTERM');
      }
    } else {
      // Default kill
      process.kill('SIGTERM');
    }
  }

  /**
   * Executes the Claude Code CLI process.
   * This is the core logic that needs to be implemented by Claude Code.
   * @param params The parameters for the tool.
   * @param signal An AbortSignal to cancel the process.
   * @param updateOutput A callback to stream output updates.
   * @returns A promise that resolves with the process response.
   */
  private async executeClaudeCode(
    params: ClaudeCodeToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ClaudeCodeProcessResponse> {
    const startTime = Date.now();
    console.log(
      `[ClaudeCodeTool] executeClaudeCode started for prompt: ${params.prompt.substring(0, 50)}...`,
    );

    return new Promise<ClaudeCodeProcessResponse>((resolve) => {
      const args = [
        '-p',
        params.prompt,
        '--output-format',
        'json',
        '--permission-mode',
        'acceptEdits',
      ];
      if (params.continue) {
        args.push('--continue');
      }

      console.log(`[ClaudeCodeTool] Spawning command`, args);
      const isWindows = os.platform() === 'win32';
      // Spawn the Claude process with the single command string and shell: true
      const claudeProcess = spawn('claude', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        // Use process groups on non-Windows for robust killing.
        // Windows termination is handled by `taskkill /t`.
        detached: !isWindows,
        env: {
          ...process.env,
          GEMINI_CLI: '1',
        },
      });

      let stdout = '';
      let stderr = '';
      let processEnded = false;
      let timeoutId: NodeJS.Timeout | null = null;

      // Helper function to end the process
      const endProcess = (success: boolean, error?: string) => {
        if (processEnded) {
          console.log(
            `[ClaudeCodeTool] endProcess called but process already ended. Success: ${success}, Error: ${error}`,
          );
          return;
        }
        processEnded = true;
        console.log(
          `[ClaudeCodeTool] endProcess called. Success: ${success}, Error: ${error}`,
        );

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        const executionTime = Date.now() - startTime;
        resolve({
          success,
          output: stdout,
          error: error || stderr,
          executionTime,
        });
      };

      // Set up timeout
      const timeout = params.timeout || ClaudeCodeTool.DEFAULT_TIMEOUT;
      timeoutId = setTimeout(() => {
        if (!processEnded) {
          console.log(
            `[ClaudeCodeTool] Process timed out after ${timeout}ms. Killing process.`,
          );
          this.killProcess(claudeProcess, claudeProcess.pid);
          endProcess(false, `Process timed out after ${timeout}ms`);
        }
      }, timeout);

      // Handle abort signal
      const abortHandler = () => {
        console.log(`[ClaudeCodeTool] Abort signal received.`);
        if (!processEnded) {
          this.killProcess(claudeProcess, claudeProcess.pid);
          endProcess(false, 'Process aborted by user');
        }
      };
      signal.addEventListener('abort', abortHandler);

      // Capture stdout
      claudeProcess.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        console.log(
          `[ClaudeCodeTool] STDOUT chunk received: ${chunk.substring(0, 100)}...`,
        );
        if (updateOutput) {
          updateOutput(chunk);
        }
      });

      // Capture stderr
      claudeProcess.stderr?.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        console.log(
          `[ClaudeCodeTool] STDERR chunk received: ${chunk.substring(0, 100)}...`,
        );
      });

      // Handle process close
      claudeProcess.on('close', (code) => {
        console.log(`[ClaudeCodeTool] Process 'close' event. Code: ${code}`);
        signal.removeEventListener('abort', abortHandler);
        if (code === 0) {
          endProcess(true);
        } else {
          endProcess(false, `Process exited with code ${code}`);
        }
      });

      // Handle process error
      claudeProcess.on('error', (err) => {
        console.log(`[ClaudeCodeTool] Process 'error' event: ${err.message}`);
        signal.removeEventListener('abort', abortHandler);
        endProcess(false, `Failed to spawn Claude process: ${err.message}`);
      });
    });
  }

  /**
   * Parses the JSON output from the Claude Code CLI.
   * @param output The raw string output from the CLI.
   * @returns The parsed JSON object, or an object with the raw output if parsing fails.
   */
  private parseClaudeOutput(output: string): ParsedClaudeOutput {
    try {
      return JSON.parse(output) as ClaudeCodeSuccessOutput;
    } catch {
      return { rawOutput: output };
    }
  }

  /**
   * Type guard to check if the output is a raw output.
   * @param output The parsed output to check.
   * @returns True if the output is a raw output, false otherwise.
   */
  private isRawOutput(
    output: ParsedClaudeOutput,
  ): output is ClaudeCodeRawOutput {
    return 'rawOutput' in output;
  }
}

/**
 * A tool for interacting with the Claude Code CLI.
 */
export class ClaudeCodeTool extends BaseDeclarativeTool< // Changed from BaseTool
  ClaudeCodeToolParams,
  ToolResult
> {
  static readonly Name: string = 'claude_code';
  public static readonly DEFAULT_TIMEOUT = 1200000; // 20 minutes // Changed from private
  public static readonly MAX_TIMEOUT = 6000000; // 60 minutes // Changed from private

  constructor(private readonly config: Config) {
    super(
      ClaudeCodeTool.Name,
      'ClaudeCode',
      'Executes a prompt using the Claude Code CLI to perform complex code analysis, generation, and manipulation.',
      Kind.Execute,
      {
        type: Type.OBJECT,
        properties: {
          prompt: {
            type: Type.STRING,
            description: `About the prompt argument for the claude_code tool

* Purpose: The prompt argument is a string that describes the specific task or instruction you want the
  Claude Code CLI to execute. This is how you communicate the objective that the Claude Code CLI should
  achieve, leveraging its internal tools (e.g., Bash, Read, Write, etc.).

* Nature of Content:
    * Instructions and Tasks: The prompt should contain concrete commands for the Claude Code CLI, such as
      "Fix the bug in this file," "Refactor this module," or "Generate tests for this feature."
    * Context Provision: If necessary, include additional context required for the task (e.g., "This code
      is part of the authentication logic," "This function processes user input").
    * File Path References: If you want operations to be performed on specific files or directories, refer
      to their file paths within the 
      prompt (e.g., "Optimize the calculateSum function in
      src/utils/helper.ts").

* Important Notes (to avoid misunderstanding):
    * Not Direct File Content: You do not directly paste file content into the prompt argument. The
      Claude Code CLI will, based on the instructions given in the prompt, read relevant files itself
      using its Read tool or Bash tool (e.g., cat command) if necessary.
    * Instruction for Claude Code CLI: It functions purely as an "instruction manual" for Claude Code
      CLI, which is another AI agent.

* Good 
      prompt 
      examples:
    * "Fix the memory leak in 'src/data_processor.ts' related to the 'cache' object. Focus on lines
      120-150."
    * "Refactor the 'UserAuthService' class in 'packages/cli/src/services/auth.ts' to use functional
      components instead of classes, following the guidelines in GEMINI.md."
    * "Generate comprehensive unit tests for the 'parseInput' function in 'src/parser/input.ts'. Ensure
      edge cases like empty strings and invalid characters are covered."

* Bad 
      prompt 
      examples (cases attempting to pass file content directly to 
      prompt):
    * "Here is the file content: function processData(...) { ... }. Fix the bug."
        * Reason: The Claude Code CLI will not recognize this string as file content; it will interpret
          it as merely part of a long instruction. If file content needs to be read, you should specify
          the file path in the prompt and let the Claude Code CLI read it itself.`,
          },
          timeout: {
            type: Type.NUMBER,
            description: `Optional timeout in milliseconds (default: ${ClaudeCodeTool.DEFAULT_TIMEOUT}).`,
          },
          continue: {
            type: Type.BOOLEAN,
            description: 'Optional: Whether to continue the previous session.',
          },
        },
        required: ['prompt'],
      },
      false, // output is not markdown
      true, // can update output (streaming)
    );
  }

  protected validateToolParams(params: ClaudeCodeToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.prompt || !params.prompt.trim()) {
      return 'Prompt cannot be empty or just whitespace.';
    }

    if (params.timeout !== undefined) {
      if (params.timeout <= 0) {
        return 'Timeout must be a positive number.';
      }
      if (params.timeout > ClaudeCodeTool.MAX_TIMEOUT) {
        return `Timeout cannot exceed ${ClaudeCodeTool.MAX_TIMEOUT / 1000 / 60} minutes (${ClaudeCodeTool.MAX_TIMEOUT}ms).`;
      }
    }

    return null;
  }

  protected createInvocation(
    params: ClaudeCodeToolParams,
  ): ToolInvocation<ClaudeCodeToolParams, ToolResult> {
    return new ClaudeCodeToolInvocation(params, this.config);
  }
}
