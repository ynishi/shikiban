/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { glob } from 'glob';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { BaseTool, Icon, ToolLocation, ToolResult } from './tools.js';
import { Type } from '@google/genai';
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
 * Parameters for the IntelligentRead tool
 */
export interface IntelligentReadToolParams {
  /**
   * A partial path, relative path, or absolute path to the file
   */
  pathHint: string;
}

/**
 * Implementation of the IntelligentRead tool logic
 */
export class IntelligentReadTool extends BaseTool<IntelligentReadToolParams, ToolResult> {
  static readonly Name: string = 'intelligent_read';

  constructor(private config: Config) {
    super(
      IntelligentReadTool.Name,
      'IntelligentRead',
      'Reads file content by intelligently resolving partial paths or file names. Can find files using absolute paths, relative paths, or just file names.',
      Icon.FileSearch,
      {
        properties: {
          pathHint: {
            description:
              'A partial path, relative path, or absolute path to the file.',
            type: Type.STRING,
          },
        },
        required: ['pathHint'],
        type: Type.OBJECT,
      },
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  validateToolParams(params: IntelligentReadToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.pathHint || params.pathHint.trim() === '') {
      return 'pathHint parameter cannot be empty';
    }

    return null;
  }

  getDescription(params: IntelligentReadToolParams): string {
    if (
      !params ||
      typeof params.pathHint !== 'string' ||
      params.pathHint.trim() === ''
    ) {
      return `Path unavailable`;
    }
    return `Searching for: ${params.pathHint}`;
  }

  toolLocations(_params: IntelligentReadToolParams): ToolLocation[] {
    // Since we don't know the exact path yet, return empty array
    return [];
  }

  async execute(
    params: IntelligentReadToolParams,
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

    let filePath: string | null = null;
    let summary = '';

    // Helper function to check if a file exists and is within workspace
    const tryResolveFile = async (absolutePath: string): Promise<boolean> => {
      try {
        const workspaceContext = this.config.getWorkspaceContext();
        if (!workspaceContext.isPathWithinWorkspace(absolutePath)) {
          return false;
        }
        
        const fileService = this.config.getFileService();
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

    // 1. Check as absolute path
    if (path.isAbsolute(pathHint)) {
      const exists = await tryResolveFile(pathHint);
      if (exists) {
        filePath = pathHint;
      }
    }

    // 2. Check as relative to project root
    if (!filePath) {
      const projectRootRelativePath = path.join(projectRoot, pathHint);
      const exists = await tryResolveFile(projectRootRelativePath);
      if (exists) {
        filePath = projectRootRelativePath;
      }
    }

    // 3. Check as relative to current working directory
    if (!filePath) {
      const cwdRelativePath = path.join(currentWorkingDirectory, pathHint);
      const exists = await tryResolveFile(cwdRelativePath);
      if (exists) {
        filePath = cwdRelativePath;
      }
    }

    // 4. Global Glob Search
    if (!filePath) {
      const globPattern = `**/${pathHint}`;
      const matchingFiles = await glob(globPattern, {
        cwd: projectRoot,
        absolute: true,
        nodir: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
        signal,
      });

      // Filter files within workspace and not ignored
      const workspaceContext = this.config.getWorkspaceContext();
      const fileService = this.config.getFileService();
      const validFiles = matchingFiles.filter(file => 
        workspaceContext.isPathWithinWorkspace(file) &&
        !fileService.shouldGeminiIgnoreFile(file)
      );

      if (validFiles.length === 1) {
        filePath = validFiles[0];
      } else if (validFiles.length > 1) {
        let output = '複数のファイルが見つかりました。上位10件のファイルの先頭20行を表示します:\n\n';
        const filesToRead = validFiles.slice(0, 10);

        for (const file of filesToRead) {
          const result = await processSingleFileContent(
            file,
            this.config.getTargetDir(),
            0,
            20,
          );
          if (result.error) {
            output += `--- ${file} ---\nファイルの読み込み中にエラーが発生しました: ${result.error}\n\n`;
          } else {
            output += `--- ${file} ---\n${result.llmContent}\n\n`;
          }
        }
        summary = `Found ${validFiles.length} files. Displaying snippets from ${Math.min(10, validFiles.length)}.`;
        return {
          llmContent: output,
          returnDisplay: output,
          summary,
        };
      }
    }

    if (filePath) {
      const result = await processSingleFileContent(
        filePath,
        this.config.getTargetDir(),
      );

      if (result.error) {
        return {
          llmContent: result.error,
          returnDisplay: result.returnDisplay || 'Error reading file',
        };
      }

      const contentLines =
        typeof result.llmContent === 'string'
          ? result.llmContent.split('\n').length
          : undefined;
      const mimetype = getSpecificMimeType(filePath);
      recordFileOperationMetric(
        this.config,
        FileOperation.READ,
        contentLines,
        mimetype,
        path.extname(filePath),
      );

      const fullContent = result.llmContent || '';
      const first10Lines = fullContent.toString().split('\n').slice(0, 10).join('\n');
      summary = `Read file: ${filePath}`;
      return {
        llmContent: fullContent,
        returnDisplay: `--- ${filePath} ---\n${first10Lines}`,
        summary,
      };
    } else {
      summary = `File not found: ${pathHint}`;
      return {
        llmContent: summary,
        returnDisplay: summary,
        summary,
      };
    }
  }
}
