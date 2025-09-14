/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { glob } from 'glob';
import { makeRelative, shortenPath } from '../utils/paths.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolInvocation,
  ToolLocation,
  ToolResult,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { PartUnion } from '@google/genai';
import {
  processSingleFileContent,
  getSpecificMimeType,
} from '../utils/fileUtils.js';
import { Config } from '../config/config.js';
import {
  recordFileOperationMetric,
  FileOperation,
} from '../telemetry/metrics.js';

/**
 * Parameters for the ReadFile tool
 */
export interface ReadFileToolParams {
  /**
   * A partial path, relative path, or absolute path to the file
   */
  pathHint: string;

  /**
   * The line number to start reading from (optional)
   */
  offset?: number;

  /**
   * The number of lines to read (optional)
   */
  limit?: number;
}

class ReadFileToolInvocation extends BaseToolInvocation<
  ReadFileToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: ReadFileToolParams,
  ) {
    super(params);
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.pathHint,
      this.config.getTargetDir(),
    );
    return shortenPath(relativePath);
  }

  toolLocations(): ToolLocation[] {
    return [{ path: this.params.pathHint, line: this.params.offset }];
  }

  async execute(): Promise<ToolResult> {
    const { pathHint } = this.params;
    const projectRoot = this.config.getTargetDir();
    const currentWorkingDirectory = process.cwd();
    const fileSystemService = this.config.getFileSystemService();
    const workspaceContext = this.config.getWorkspaceContext();

    let resolvedPath: string | null = null;

    // Helper function to check if a file exists and is within workspace and not ignored
    const tryResolveFile = async (absolutePath: string): Promise<boolean> => {
      try {
        if (!workspaceContext.isPathWithinWorkspace(absolutePath)) {
          return false;
        }
        if (fileSystemService.shouldGeminiIgnoreFile(absolutePath)) {
          return false;
        }
        // Try to read just to check if file exists
        const result = await processSingleFileContent(
          absolutePath,
          projectRoot,
          fileSystemService,
          0,
          1,
        );
        return !result.error;
      } catch {
        return false;
      }
    };

    // 1. Check as @project-root relative path
    if (pathHint.startsWith('@')) {
      const projectRootRelativePath = path.join(
        projectRoot,
        pathHint.substring(1),
      );
      const exists = await tryResolveFile(projectRootRelativePath);
      if (exists) {
        resolvedPath = projectRootRelativePath;
      }
    }

    // 2. Check as absolute path (if not resolved by @)
    if (!resolvedPath && path.isAbsolute(pathHint)) {
      const exists = await tryResolveFile(pathHint);
      if (exists) {
        resolvedPath = pathHint;
      }
    }

    // 3. Check as relative to project root (if not resolved by @ or absolute)
    if (!resolvedPath) {
      const projectRootRelativePath = path.join(projectRoot, pathHint);
      const exists = await tryResolveFile(projectRootRelativePath);
      if (exists) {
        resolvedPath = projectRootRelativePath;
      }
    }

    // 4. Check as relative to current working directory (if not resolved by any above)
    if (!resolvedPath) {
      const cwdRelativePath = path.join(currentWorkingDirectory, pathHint);
      const exists = await tryResolveFile(cwdRelativePath);
      if (exists) {
        resolvedPath = cwdRelativePath;
      }
    }

    if (!resolvedPath) {
      const errorMessage = `File not found: ${pathHint}. Could not resolve as @project-root relative, absolute, project-root relative, or current-directory relative path.`;
      return {
        llmContent: 'Could not read file because no file was found at the specified path.',
        returnDisplay: errorMessage,
        error: {
          message: errorMessage,
          type: ToolErrorType.FILE_NOT_FOUND,
        },
      };
    }

    // Final check after path resolution: ensure it's within workspace and not ignored
    if (!workspaceContext.isPathWithinWorkspace(resolvedPath)) {
      const directories = workspaceContext.getDirectories();
      const errorMessage = `File path '${resolvedPath}' is not within one of the workspace directories: ${directories.join(', ')}`;
      return {
        llmContent: errorMessage,
        returnDisplay: errorMessage,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    if (fileSystemService.shouldGeminiIgnoreFile(resolvedPath)) {
      const errorMessage = `File path '${resolvedPath}' is ignored by .geminiignore pattern(s).`;
      return {
        llmContent: errorMessage,
        returnDisplay: errorMessage,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    const result = await processSingleFileContent(
      resolvedPath,
      projectRoot,
      fileSystemService,
      this.params.offset,
      this.params.limit,
    );

    if (result.error) {
      // Map error messages to ToolErrorType
      let errorType: ToolErrorType;
      let llmContent: string;

      // Check error message patterns to determine error type
      if (
        result.error.includes('File not found') ||
        result.error.includes('does not exist') ||
        result.error.includes('ENOENT')
      ) {
        errorType = ToolErrorType.FILE_NOT_FOUND;
        llmContent =
          'Could not read file because no file was found at the specified path.';
      } else if (
        result.error.includes('is a directory') ||
        result.error.includes('EISDIR')
      ) {
        errorType = ToolErrorType.INVALID_TOOL_PARAMS;
        llmContent =
          'Could not read file because the provided path is a directory, not a file.';
      } else if (
        result.error.includes('too large') ||
        result.error.includes('File size exceeds')
      ) {
        errorType = ToolErrorType.FILE_TOO_LARGE;
        llmContent = `Could not read file. ${result.error}`;
      } else {
        // Other read errors map to READ_CONTENT_FAILURE
        errorType = ToolErrorType.READ_CONTENT_FAILURE;
        llmContent = `Could not read file. ${result.error}`;
      }

      return {
        llmContent,
        returnDisplay: result.returnDisplay || 'Error reading file',
        error: {
          message: result.error,
          type: errorType,
        },
      };
    }

    let llmContent: PartUnion;
    if (result.isTruncated) {
      const [start, end] = result.linesShown!;
      const total = result.originalLineCount!;
      const nextOffset = this.params.offset
        ? this.params.offset + end - start + 1
        : end;
      llmContent = `
IMPORTANT: The file content has been truncated.
Status: Showing lines ${start}-${end} of ${total} total lines.
Action: To read more of the file, you can use the 'offset' and 'limit' parameters in a subsequent 'read_file' call. For example, to read the next section of the file, use offset: ${nextOffset}.

--- FILE CONTENT (truncated) ---
${result.llmContent}`;
    } else {
      llmContent = result.llmContent || '';
    }

    const lines =
      typeof result.llmContent === 'string'
        ? result.llmContent.split('\n').length
        : undefined;
    const mimetype = getSpecificMimeType(resolvedPath);
    recordFileOperationMetric(
      this.config,
      FileOperation.READ,
      lines,
      mimetype,
      path.extname(resolvedPath),
    );

    return {
      llmContent,
      returnDisplay: result.returnDisplay || '',
    };
  }
}

/**
 * Implementation of the ReadFile tool logic
 */
export class ReadFileTool extends BaseDeclarativeTool<
  ReadFileToolParams,
  ToolResult
> {
  static readonly Name: string = 'read_file';

  constructor(private config: Config) {
    super(
      ReadFileTool.Name,
      'ReadFile',
      `Reads and returns the content of a specified file. If the file is large, the content will be truncated. The tool's response will clearly indicate if truncation has occurred and will provide details on how to read more of the file using the 'offset' and 'limit' parameters. Handles text, images (PNG, JPG, GIF, WEBP, SVG, BMP), and PDF files. For text files, it can read specific line ranges.`,
      Kind.Read,
      {
        properties: {
          pathHint: {
            description:
              'A partial path, relative path, or absolute path to the file.',
            type: 'string',
          },
          offset: {
            description:
              "Optional: For text files, the 0-based line number to start reading from. Requires 'limit' to be set. Use for paginating through large files.",
            type: 'number',
          },
          limit: {
            description:
              "Optional: For text files, maximum number of lines to read. Use with 'offset' to paginate through large files. If omitted, reads the entire file (if feasible, up to a default limit).",
            type: 'number',
          },
        },
        required: ['pathHint'],
        type: 'object',
      },
    );
  }

  protected createInvocation(
    params: ReadFileToolParams,
  ): ToolInvocation<ReadFileToolParams, ToolResult> {
    return new ReadFileToolInvocation(this.config, params);
  }

  protected override validateToolParamValues(
    params: ReadFileToolParams,
  ): string | null {
    if (!params.pathHint || params.pathHint.trim() === '') {
      return "The 'pathHint' parameter must be non-empty.";
    }

    if (params.offset !== undefined && params.offset < 0) {
      return 'Offset must be a non-negative number';
    }
    if (params.limit !== undefined && params.limit <= 0) {
      return 'Limit must be a positive number';
    }

    return null;
  }
}