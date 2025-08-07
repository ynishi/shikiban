/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { glob } from 'glob';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Icon,
  ToolInvocation,
  ToolLocation,
  ToolResult,
} from './tools.js';
import { PartUnion, Type } from '@google/genai';
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
    const result = await processSingleFileContent(
      this.params.pathHint,
      this.config.getTargetDir(),
      this.params.offset,
      this.params.limit,
    );

    if (result.error) {
      return {
        llmContent: result.error, // The detailed error for LLM
        returnDisplay: result.returnDisplay || 'Error reading file', // User-friendly error
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
    const mimetype = getSpecificMimeType(this.params.pathHint);
    recordFileOperationMetric(
      this.config,
      FileOperation.READ,
      lines,
      mimetype,
      path.extname(this.params.pathHint),
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
      Icon.FileSearch,
      {
        properties: {
          pathHint: {
            description:
              'A partial path, relative path, or absolute path to the file.',
            type: Type.STRING,
          },
          offset: {
            description:
              "Optional: For text files, the 0-based line number to start reading from. Requires 'limit' to be set. Use for paginating through large files.",
            type: Type.NUMBER,
          },
          limit: {
            description:
              "Optional: For text files, maximum number of lines to read. Use with 'offset' to paginate through large files. If omitted, reads the entire file (if feasible, up to a default limit).",
            type: Type.NUMBER,
          },
        },
        required: ['pathHint'],
        type: Type.OBJECT,
      },
    );
  }

  protected createInvocation(
    params: ReadFileToolParams,
  ): ToolInvocation<ReadFileToolParams, ToolResult> {
    return new ReadFileToolInvocation(this.config, params);
  }

  protected validateToolParams(params: ReadFileToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.pathHint || params.pathHint.trim() === '') {
      return 'pathHint parameter cannot be empty';
    }

    // Path resolution will happen in execute, so we remove the absolute path check here.
    // The workspace check will also happen after resolution.

    if (params.offset !== undefined && params.offset < 0) {
      return 'Offset must be a non-negative number';
    }
    if (params.limit !== undefined && params.limit <= 0) {
      return 'Limit must be a positive number';
    }

    // The .geminiignore check will be performed after path resolution in execute.

    return null;
  }

  getDescription(params: ReadFileToolParams): string {
    if (
      !params ||
      typeof params.pathHint !== 'string' ||
      params.pathHint.trim() === ''
    ) {
      return `Path unavailable`;
    }
    // Description will now reflect the path hint, not a resolved absolute path
    return `Searching for: ${params.pathHint}`;
  }

  toolLocations(params: ReadFileToolParams): ToolLocation[] {
    // Since we don't know the exact path yet, return empty array or a hint
    // For now, returning an empty array as the path is resolved in execute.
    return [];
  }

  async execute(
    params: ReadFileToolParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError,
      };
    }

    const { pathHint } = params;
    const projectRoot = this.config.getProjectRoot();
    const currentWorkingDirectory = process.cwd();
    const fileService = this.config.getFileService();
    const workspaceContext = this.config.getWorkspaceContext();

    let filePath: string | null = null;
    let summary = '';

    // Helper function to check if a file exists and is within workspace and not ignored
    const tryResolveFile = async (absolutePath: string): Promise<boolean> => {
      try {
        if (!workspaceContext.isPathWithinWorkspace(absolutePath)) {
          return false;
        }
        if (fileService.shouldGeminiIgnoreFile(absolutePath)) {
          return false;
        }
        // Try to read just to check if file exists
        const result = await processSingleFileContent(
          absolutePath,
          this.config.getTargetDir(),
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
        filePath = projectRootRelativePath;
      }
    }

    // 2. Check as absolute path (if not resolved by @)
    if (!filePath && path.isAbsolute(pathHint)) {
      const exists = await tryResolveFile(pathHint);
      if (exists) {
        filePath = pathHint;
      }
    }

    // 3. Check as relative to project root (if not resolved by @ or absolute)
    if (!filePath) {
      const projectRootRelativePath = path.join(projectRoot, pathHint);
      const exists = await tryResolveFile(projectRootRelativePath);
      if (exists) {
        filePath = projectRootRelativePath;
      }
    }

    // 4. Check as relative to current working directory (if not resolved by any above)
    if (!filePath) {
      const cwdRelativePath = path.join(currentWorkingDirectory, pathHint);
      const exists = await tryResolveFile(cwdRelativePath);
      if (exists) {
        filePath = cwdRelativePath;
      }
    }

    if (!filePath) {
      summary = `File not found: ${pathHint}. Could not resolve as @project-root relative, absolute, project-root relative, or current-directory relative path.`;
      return {
        llmContent: summary,
        returnDisplay: summary,
        summary,
      };
    }

    // Final check after path resolution: ensure it's within workspace and not ignored
    if (!workspaceContext.isPathWithinWorkspace(filePath)) {
      const directories = workspaceContext.getDirectories();
      summary = `File path '${filePath}' is not within one of the workspace directories: ${directories.join(', ')}`;
      return {
        llmContent: summary,
        returnDisplay: summary,
        summary,
      };
    }
    if (fileService.shouldGeminiIgnoreFile(filePath)) {
      summary = `File path '${filePath}' is ignored by .geminiignore pattern(s).`;
      return {
        llmContent: summary,
        returnDisplay: summary,
        summary,
      };
    }

    const result = await processSingleFileContent(
      filePath, // Use the resolved filePath
      this.config.getTargetDir(),
      params.offset,
      params.limit,
    );

    if (result.error) {
      return {
        llmContent: result.error, // The detailed error for LLM
        returnDisplay: `Error reading file '${filePath}': ${result.returnDisplay || 'Unknown error'}`, // User-friendly error with full path
      };
    }

    const lines =
      typeof result.llmContent === 'string'
        ? result.llmContent.split('\n').length
        : undefined;
    const mimetype = getSpecificMimeType(filePath);
    recordFileOperationMetric(
      this.config,
      FileOperation.READ,
      lines,
      mimetype,
      path.extname(filePath),
    );

    // Always return the full path in returnDisplay
    return {
      llmContent: result.llmContent || '',
      returnDisplay: `--- ${filePath} ---\n${result.returnDisplay || ''}`,
    };
  }
}
