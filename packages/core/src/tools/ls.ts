/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { BaseTool, Icon, ToolResult, ToolLocation } from './tools.js';
import { Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { Config, DEFAULT_FILE_FILTERING_OPTIONS } from '../config/config.js';

/**
 * Parameters for the LS tool
 */
export interface LSToolParams {
  /**
   * The absolute path to the directory to list
   */
  path: string;

  /**
   * Array of glob patterns to ignore (optional)
   */
  ignore?: string[];

  /**
   * Whether to respect .gitignore and .geminiignore patterns (optional, defaults to true)
   */
  file_filtering_options?: {
    respect_git_ignore?: boolean;
    respect_gemini_ignore?: boolean;
  };
}

/**
 * File entry returned by LS tool
 */
export interface FileEntry {
  /**
   * Name of the file or directory
   */
  name: string;

  /**
   * Absolute path to the file or directory
   */
  path: string;

  /**
   * Whether this entry is a directory
   */
  isDirectory: boolean;

  /**
   * Size of the file in bytes (0 for directories)
   */
  size: number;

  /**
   * Last modified timestamp
   */
  modifiedTime: Date;
}

/**
 * Implementation of the LS tool logic
 */
export class LSTool extends BaseTool<LSToolParams, ToolResult> {
  static readonly Name = 'list_directory';

  constructor(private config: Config) {
    super(
      LSTool.Name,
      'ReadFolder',
      'Lists the names of files and subdirectories directly within a specified directory path. Can optionally ignore entries matching provided glob patterns.',
      Icon.Folder,
      {
        properties: {
          path: {
            description:
              'The absolute path to the directory to list (must be absolute, not relative)',
            type: Type.STRING,
          },
          ignore: {
            description: 'List of glob patterns to ignore',
            items: {
              type: Type.STRING,
            },
            type: Type.ARRAY,
          },
          file_filtering_options: {
            description:
              'Optional: Whether to respect ignore patterns from .gitignore or .geminiignore',
            type: Type.OBJECT,
            properties: {
              respect_git_ignore: {
                description:
                  'Optional: Whether to respect .gitignore patterns when listing files. Only available in git repositories. Defaults to true.',
                type: Type.BOOLEAN,
              },
              respect_gemini_ignore: {
                description:
                  'Optional: Whether to respect .geminiignore patterns when listing files. Defaults to true.',
                type: Type.BOOLEAN,
              },
            },
          },
        },
        required: ['path'],
        type: Type.OBJECT,
      },
    );
  }

  /**
   * Validates the parameters for the tool
   * @param params Parameters to validate
   * @returns An error message string if invalid, null otherwise
   */
  validateToolParams(params: LSToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }
    // Path validation and workspace check moved to execute for intelligent resolution
    return null;
  }

  /**
   * Checks if a filename matches any of the ignore patterns
   * @param filename Filename to check
   * @param patterns Array of glob patterns to check against
   * @returns True if the filename should be ignored
   */
  private shouldIgnore(filename: string, patterns?: string[]): boolean {
    if (!patterns || patterns.length === 0) {
      return false;
    }
    for (const pattern of patterns) {
      // Convert glob pattern to RegExp
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(filename)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Gets a description of the file reading operation
   * @param params Parameters for the file reading
   * @returns A string describing the file being read
   */
  getDescription(params: LSToolParams): string {
    if (!params || typeof params.path !== 'string' || params.path.trim() === '') {
      return `Path unavailable`;
    }
    // Description will now reflect the path hint, not a resolved absolute path
    return `Listing directory for: ${params.path}`;
  }

  // Helper for consistent error formatting
  private errorResult(llmContent: string, returnDisplay: string): ToolResult {
    return {
      llmContent,
      // Keep returnDisplay simpler in core logic
      returnDisplay: `Error: ${returnDisplay}`,
    };
  }

  toolLocations(_params: LSToolParams): ToolLocation[] {
    // Path is resolved in execute, so we can't provide a precise location here.
    return [];
  }

  /**
   * Executes the LS operation with the given parameters
   * @param params Parameters for the LS operation
   * @returns Result of the LS operation
   */
  async execute(
    params: LSToolParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.errorResult(
        `Error: Invalid parameters provided. Reason: ${validationError}`,
        `Failed to execute tool.`,
      );
    }

    const pathHint = params.path;
    let resolvedPath: string | null = null;
    const projectRoot = this.config.getProjectRoot();

    if (pathHint.startsWith('@')) {
      resolvedPath = path.join(projectRoot, pathHint.substring(1));
    } else {
      // For non-'@' paths, it must be an absolute path as per current LS tool contract
      if (path.isAbsolute(pathHint)) {
        resolvedPath = pathHint;
      } else {
        return this.errorResult(
          `Error: Path must be absolute or start with '@' for project root relative path. Received: ${pathHint}`,
          `Invalid path format.`, // User-friendly message
        );
      }
    }

    // Now that we have a resolvedPath, perform workspace and existence checks
    if (!resolvedPath) {
      return this.errorResult(
        `Error: Could not resolve path: ${pathHint}`,
        `Failed to resolve path.`, // User-friendly message
      );
    }

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(resolvedPath)) {
      const directories = workspaceContext.getDirectories();
      return this.errorResult(
        `Error: Path '${resolvedPath}' is not within one of the workspace directories: ${directories.join(', ')}`,
        `Path outside workspace.`, // User-friendly message
      );
    }

    try {
      const stats = fs.statSync(resolvedPath);
      if (!stats) {
        // fs.statSync throws on non-existence, so this check might be redundant
        // but keeping for clarity. Error message adjusted.
        return this.errorResult(
          `Error: Directory not found or inaccessible: ${resolvedPath}`,
          `Directory not found or inaccessible.`, // User-friendly message
        );
      }
      if (!stats.isDirectory()) {
        return this.errorResult(
          `Error: Path is not a directory: ${resolvedPath}`,
          `Path is not a directory.`, // User-friendly message
        );
      }

      const files = fs.readdirSync(resolvedPath);

      const defaultFileIgnores =
        this.config.getFileFilteringOptions() ?? DEFAULT_FILE_FILTERING_OPTIONS;

      const fileFilteringOptions = {
        respectGitIgnore:
          params.file_filtering_options?.respect_git_ignore ??
          defaultFileIgnores.respectGitIgnore,
        respectGeminiIgnore:
          params.file_filtering_options?.respect_gemini_ignore ??
          defaultFileIgnores.respectGeminiIgnore,
      };

      // Get centralized file discovery service

      const fileDiscovery = this.config.getFileService();

      const entries: FileEntry[] = [];
      let gitIgnoredCount = 0;
      let geminiIgnoredCount = 0;

      if (files.length === 0) {
        // Changed error message to be more neutral for LLM
        return {
          llmContent: `Directory ${resolvedPath} is empty.`,
          returnDisplay: `Directory is empty.`,
        };
      }

      for (const file of files) {
        if (this.shouldIgnore(file, params.ignore)) {
          continue;
        }

        const fullPath = path.join(resolvedPath, file);
        const relativePath = path.relative(
          this.config.getTargetDir(),
          fullPath,
        );

        // Check if this file should be ignored based on git or gemini ignore rules
        if (
          fileFilteringOptions.respectGitIgnore &&
          fileDiscovery.shouldGitIgnoreFile(relativePath)
        ) {
          gitIgnoredCount++;
          continue;
        }
        if (
          fileFilteringOptions.respectGeminiIgnore &&
          fileDiscovery.shouldGeminiIgnoreFile(relativePath)
        ) {
          geminiIgnoredCount++;
          continue;
        }

        try {
          const stats = fs.statSync(fullPath);
          const isDir = stats.isDirectory();
          entries.push({
            name: file,
            path: fullPath,
            isDirectory: isDir,
            size: isDir ? 0 : stats.size,
            modifiedTime: stats.mtime,
          });
        } catch (error) {
          // Log error internally but don't fail the whole listing
          console.error(`Error accessing ${fullPath}: ${error}`);
        }
      }

      // Sort entries (directories first, then alphabetically)
      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      // Create formatted content for LLM
      const directoryContent = entries
        .map((entry) => `${entry.isDirectory ? '[DIR] ' : ''}${entry.name}`)
        .join('\n');

      let resultMessage = `Directory listing for ${resolvedPath}:\n${directoryContent}`;
      const ignoredMessages = [];
      if (gitIgnoredCount > 0) {
        ignoredMessages.push(`${gitIgnoredCount} git-ignored`);
      }
      if (geminiIgnoredCount > 0) {
        ignoredMessages.push(`${geminiIgnoredCount} gemini-ignored`);
      }

      if (ignoredMessages.length > 0) {
        resultMessage += `\n\n(${ignoredMessages.join(', ')})`;
      }

      let displayMessage = `Listed ${entries.length} item(s) in ${resolvedPath}.`;
      if (ignoredMessages.length > 0) {
        displayMessage += ` (${ignoredMessages.join(', ')})`;
      }

      return {
        llmContent: resultMessage,
        returnDisplay: displayMessage,
      };
    } catch (error) {
      const errorMsg = `Error listing directory: ${error instanceof Error ? error.message : String(error)}`;
      return this.errorResult(errorMsg, `Failed to list directory: ${resolvedPath}.`);
    }
  }
}
