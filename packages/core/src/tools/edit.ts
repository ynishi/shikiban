/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as Diff from 'diff';
import {
  BaseTool,
  Icon,
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolEditConfirmationDetails,
  ToolLocation,
  ToolResult,
  ToolResultDisplay,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { isNodeError } from '../utils/errors.js';
import { Config, ApprovalMode } from '../config/config.js';
import { ensureCorrectEdit } from '../utils/editCorrector.js';
import { DEFAULT_DIFF_OPTIONS } from './diffOptions.js';
import { ReadFileTool } from './read-file.js';
import { ModifiableTool, ModifyContext } from './modifiable-tool.js';
import { ReplacementMetrics } from './replacementMetrics.js';

/**
 * Parameters for the Edit tool
 */
export interface EditToolParams {
  /**
   * The absolute path to the file to modify
   */
  file_path: string;

  /**
   * The text to replace
   */
  old_string: string;

  /**
   * The text to replace it with
   */
  new_string: string;

  /**
   * Number of replacements expected. Defaults to 1 if not specified.
   * Use when you want to replace multiple occurrences.
   */
  expected_replacements?: number;

  /**
   * The 0-based index of the specific occurrence to replace when multiple matches are found.
   * Only applicable when `expected_replacements` is 1 or unspecified.
   */
  target_occurrence_index?: number;

  /**
   * Whether the edit was modified manually by the user.
   */
  modified_by_user?: boolean;
}

interface CalculatedEdit {
  currentContent: string | null;
  newContent: string;
  replacementMetrics: ReplacementMetrics; // Replace 'occurrences' with the new object
  error?: { display: string; raw: string; type: ToolErrorType };
  isNewFile: boolean;
}

/**
 * Implementation of the Edit tool logic
 */
export class EditTool
  extends BaseTool<EditToolParams, ToolResult>
  implements ModifiableTool<EditToolParams>
{
  static readonly Name = 'replace';

  constructor(private readonly config: Config) {
    super(
      EditTool.Name,
      'Edit',
      `Replaces text within a file. By default, replaces a single occurrence, but can replace multiple occurrences when \`expected_replacements\` is specified. This tool requires providing significant context around the change to ensure precise targeting. Always use the ${ReadFileTool.Name} tool to examine the file's current content before attempting a text replacement.

      The user has the ability to modify the \`new_string\` content. If modified, this will be stated in the response.

Expectation for required parameters:
1. \`file_path\` MUST be an absolute path; otherwise an error will be thrown.
2. \`old_string\` MUST be the exact literal text to replace (including all whitespace, indentation, newlines, and surrounding code etc.).
3. \`new_string\` MUST be the exact literal text to replace \`old_string\` with (also including all whitespace, indentation, newlines, and surrounding code etc.). Ensure the resulting code is correct and idiomatic.
4. NEVER escape \`old_string\` or \`new_string\`, that would break the exact literal text requirement.
**Important:** If ANY of the above are not satisfied, the tool will fail. CRITICAL for \`old_string\`: Must uniquely identify the single instance to change. Include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. If this string matches multiple locations, or does not match exactly, the tool will fail.
**Multiple replacements:** Set \`expected_replacements\` to the number of occurrences you want to replace. The tool will replace ALL occurrences that match \`old_string\` exactly. Ensure the number of replacements matches your expectation.`,
      Icon.Pencil,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to modify. Must start with '/'.",
            type: Type.STRING,
          },
          old_string: {
            description:
              'The exact literal text to replace, preferably unescaped. For single replacements (default), include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. For multiple replacements, specify expected_replacements parameter. If this string is not the exact literal text (i.e. you escaped it) or does not match exactly, the tool will fail.',
            type: Type.STRING,
          },
          new_string: {
            description:
              'The exact literal text to replace `old_string` with, preferably unescaped. Provide the EXACT text. Ensure the resulting code is correct and idiomatic.',
            type: Type.STRING,
          },
          expected_replacements: {
            type: Type.NUMBER,
            description:
              'Number of replacements expected. Defaults to 1 if not specified. Use when you want to replace multiple occurrences.',
            minimum: 1,
          },
          target_occurrence_index: {
            type: Type.NUMBER,
            description:
              'The 0-based index of the specific occurrence to replace when multiple matches are found. Only applicable when `expected_replacements` is 1 or unspecified.',
            minimum: 0,
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
        type: Type.OBJECT,
      },
    );
  }

  /**
   * Validates the parameters for the Edit tool
   * @param params Parameters to validate
   * @returns Error message string or null if valid
   */
  validateToolParams(params: EditToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!path.isAbsolute(params.file_path)) {
      return `File path must be absolute: ${params.file_path}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(params.file_path)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within one of the workspace directories: ${directories.join(', ')}`;
    }

    return null;
  }

  /**
   * Determines any file locations affected by the tool execution
   * @param params Parameters for the tool execution
   * @returns A list of such paths
   */
  toolLocations(params: EditToolParams): ToolLocation[] {
    return [{ path: params.file_path }];
  }

  private _applyReplacement(
    currentContent: string | null,
    oldString: string,
    newString: string,
    isNewFile: boolean,
    targetOccurrenceIndex?: number,
  ): string {
    if (isNewFile) {
      return newString;
    }
    if (currentContent === null) {
      return oldString === '' ? newString : '';
    }
    if (oldString === '' && !isNewFile) {
      return currentContent;
    }

    if (targetOccurrenceIndex !== undefined) {
      let parts: string[] = [];
      let currentPos = 0;
      let count = 0;
      let foundTarget = false;

      let matchIndex = currentContent.indexOf(oldString, currentPos);
      while (matchIndex !== -1) {
        if (count === targetOccurrenceIndex) {
          // Add the part before the target occurrence
          parts.push(currentContent.substring(currentPos, matchIndex));
          // Add the new string
          parts.push(newString);
          // Move currentPos past the replaced oldString
          currentPos = matchIndex + oldString.length;
          foundTarget = true;
          break; // Exit after replacing the target
        } else {
          // For non-target occurrences, just add the part and the oldString itself
          parts.push(currentContent.substring(currentPos, matchIndex + oldString.length));
          currentPos = matchIndex + oldString.length;
        }
        count++;
        matchIndex = currentContent.indexOf(oldString, currentPos);
      }

      if (foundTarget) {
        // Add any remaining content after the target replacement
        parts.push(currentContent.substring(currentPos));
        return parts.join('');
      } else {
        // If targetOccurrenceIndex not found (e.g., out of bounds), return original
        return currentContent;
      }
    } else {
      return currentContent.replaceAll(oldString, newString);
    }
  }

  /**
   * Calculates the potential outcome of an edit operation.
   * @param params Parameters for the edit operation
   * @returns An object describing the potential edit outcome
   * @throws File system errors if reading the file fails unexpectedly (e.g., permissions)
   */
  private async calculateEdit(
    params: EditToolParams,
    abortSignal: AbortSignal,
  ): Promise<CalculatedEdit> {
    const expectedReplacements = params.expected_replacements ?? 1;
    let currentContent: string | null = null;
    let fileExists = false;
    let isNewFile = false;
    let finalNewString = params.new_string;
    let finalOldString = params.old_string;
    let error:
      | { display: string; raw: string; type: ToolErrorType }
      | undefined = undefined;

    // Create ReplacementMetrics instance early to encapsulate all occurrence-related logic
    let replacementMetrics: ReplacementMetrics;

    try {
      currentContent = fs.readFileSync(params.file_path, 'utf8');
      // Normalize line endings to LF for consistent processing.
      currentContent = currentContent.replace(/\r\n/g, '\n');
      fileExists = true;
    } catch (err: unknown) {
      if (!isNodeError(err) || err.code !== 'ENOENT') {
        // Rethrow unexpected FS errors (permissions, etc.)
        throw err;
      }
      fileExists = false;
    }

    if (params.old_string === '' && !fileExists) {
      // Creating a new file
      isNewFile = true;
      // For new files, there are no occurrences of old_string, and 1 replacement is expected (the new file itself)
      replacementMetrics = new ReplacementMetrics(
        '', // No content yet
        params.old_string,
        1, // Expected 1 replacement (the new file)
        undefined,
      );
    } else if (!fileExists) {
      // Trying to edit a nonexistent file (and old_string is not empty)
      error = {
        display: `File not found. Cannot apply edit. Use an empty old_string to create a new file.`,
        raw: `File not found: ${params.file_path}`,
        type: ToolErrorType.FILE_NOT_FOUND,
      };
      replacementMetrics = new ReplacementMetrics(
        '', // No content
        params.old_string,
        expectedReplacements,
        params.target_occurrence_index,
      );
    } else if (currentContent !== null) {
      // Editing an existing file
      const correctedEdit = await ensureCorrectEdit(
        params.file_path,
        currentContent,
        params,
        this.config.getGeminiClient(),
        abortSignal,
      );
      finalOldString = correctedEdit.params.old_string;
      finalNewString = correctedEdit.params.new_string;

      // Initialize ReplacementMetrics with actual content and corrected oldString
      replacementMetrics = new ReplacementMetrics(
        currentContent,
        finalOldString,
        expectedReplacements,
        params.target_occurrence_index,
      );

      if (params.old_string === '') {
        // Error: Trying to create a file that already exists
        error = {
          display: `Failed to edit. Attempted to create a file that already exists.`,
          raw: `File already exists, cannot create: ${params.file_path}`,
          type: ToolErrorType.ATTEMPT_TO_CREATE_EXISTING_FILE,
        };
      } else if (replacementMetrics.totalMatchesInFile === 0) {
        error = {
          display: `Failed to edit, could not find the string to replace.`,
          raw: `Failed to edit, 0 occurrences found for old_string in ${params.file_path}. No edits made. The exact text in old_string was not found. Ensure you're not escaping content incorrectly and check whitespace, indentation, and context. Use ${ReadFileTool.Name} tool to verify.`,
          type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
        };
      } else if (!replacementMetrics.isValidTargetIndex) {
        error = {
          display: replacementMetrics.getErrorMessageForTargetIndexOutOfBounds(),
          raw: replacementMetrics.getErrorMessageForTargetIndexOutOfBounds(),
          type: ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
        };
      } else if (replacementMetrics.isMultipleMatchesForSingleExpected) {
        error = {
          display: replacementMetrics.getErrorMessageForMultipleMatches(),
          raw: replacementMetrics.getErrorMessageForMultipleMatches(),
          type: ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
        };
      } else if (replacementMetrics.actualReplacementsCount !== expectedReplacements) {
        // This covers cases where expectedReplacements is > 1 but actualReplacementsCount is different
        error = {
          display: replacementMetrics.getErrorMessageForMismatch(),
          raw: `Failed to edit, Expected ${expectedReplacements} ${expectedReplacements === 1 ? 'occurrence' : 'occurrences'} but found ${replacementMetrics.actualReplacementsCount} for old_string in file: ${params.file_path}`,
          type: ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
        };
      } else if (finalOldString === finalNewString) {
        error = {
          display: `No changes to apply. The old_string and new_string are identical.`,
          raw: `No changes to apply. The old_string and new_string are identical in file: ${params.file_path}`,
          type: ToolErrorType.EDIT_NO_CHANGE,
        };
      }
    } else {
      // Should not happen if fileExists and no exception was thrown, but defensively:
      error = {
        display: `Failed to read content of file.`,
        raw: `Failed to read content of existing file: ${params.file_path}`,
        type: ToolErrorType.READ_CONTENT_FAILURE,
      };
      replacementMetrics = new ReplacementMetrics(
        '', // No content
        params.old_string,
        expectedReplacements,
        params.target_occurrence_index,
      );
    }

    const newContent = this._applyReplacement(
      currentContent,
      finalOldString,
      finalNewString,
      isNewFile,
      params.target_occurrence_index,
    );

    return {
      currentContent,
      newContent,
      replacementMetrics,
      error,
      isNewFile,
    };
  }

  /**
   * Handles the confirmation prompt for the Edit tool in the CLI.
   * It needs to calculate the diff to show the user.
   */
  async shouldConfirmExecute(
    params: EditToolParams,
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }
    const validationError = this.validateToolParams(params);
    if (validationError) {
      console.error(
        `[EditTool Wrapper] Attempted confirmation with invalid parameters: ${validationError}`,
      );
      return false;
    }

    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(params, abortSignal);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`Error preparing edit: ${errorMsg}`);
      return false;
    }

    if (editData.error) {
      console.log(`Error: ${editData.error.display}`);
      return false;
    }

    const fileName = path.basename(params.file_path);
    const fileDiff = Diff.createPatch(
      fileName,
      editData.currentContent ?? '',
      editData.newContent,
      'Current',
      'Proposed',
      DEFAULT_DIFF_OPTIONS,
    );
    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Edit: ${shortenPath(makeRelative(params.file_path, this.config.getTargetDir()))}`,
      fileName,
      fileDiff,
      originalContent: editData.currentContent,
      newContent: editData.newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
    };
    return confirmationDetails;
  }

  getDescription(params: EditToolParams): string {
    if (!params.file_path || !params.old_string || !params.new_string) {
      return `Model did not provide valid parameters for edit tool`;
    }
    const relativePath = makeRelative(
      params.file_path,
      this.config.getTargetDir(),
    );
    if (params.old_string === '') {
      return `Create ${shortenPath(relativePath)}`;
    }

    const oldStringSnippet =
      params.old_string.split('\n')[0].substring(0, 30) +
      (params.old_string.length > 30 ? '...' : '');
    const newStringSnippet =
      params.new_string.split('\n')[0].substring(0, 30) +
      (params.new_string.length > 30 ? '...' : '');

    if (params.old_string === params.new_string) {
      return `No file changes to ${shortenPath(relativePath)}`;
    }
    return `${shortenPath(relativePath)}: ${oldStringSnippet} => ${newStringSnippet}`;
  }

  /**
   * Executes the edit operation with the given parameters.
   * @param params Parameters for the edit operation
   * @returns Result of the edit operation
   */
  async execute(
    params: EditToolParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: `Error: ${validationError}`,
        error: {
          message: validationError,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(params, signal);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error preparing edit: ${errorMsg}`,
        returnDisplay: `Error preparing edit: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.EDIT_PREPARATION_FAILURE,
        },
      };
    }

    if (editData.error) {
      return {
        llmContent: editData.error.raw,
        returnDisplay: `Error: ${editData.error.display}`,
        error: {
          message: editData.error.raw,
          type: editData.error.type,
        },
      };
    }

    try {
      this.ensureParentDirectoriesExist(params.file_path);
      fs.writeFileSync(params.file_path, editData.newContent, 'utf8');

      let displayResult: ToolResultDisplay;
      if (editData.isNewFile) {
        displayResult = `Created ${shortenPath(makeRelative(params.file_path, this.config.getTargetDir()))}`;
      } else {
        // Generate diff for display, even though core logic doesn't technically need it
        // The CLI wrapper will use this part of the ToolResult
        const fileName = path.basename(params.file_path);
        const fileDiff = Diff.createPatch(
          fileName,
          editData.currentContent ?? '', // Should not be null here if not isNewFile
          editData.newContent,
          'Current',
          'Proposed',
          DEFAULT_DIFF_OPTIONS,
        );
        displayResult = {
          fileDiff,
          fileName,
          originalContent: editData.currentContent,
          newContent: editData.newContent,
        };
      }

      const llmSuccessMessageParts = [
        editData.isNewFile
          ? `Created new file: ${params.file_path} with provided content.`
          : `Successfully modified file: ${params.file_path} (${editData.replacementMetrics.actualReplacementsCount} replacements).`,
      ];
      if (params.modified_by_user) {
        llmSuccessMessageParts.push(
          `User modified the \`new_string\` content to be: ${params.new_string}.`,
        );
      }

      return {
        llmContent: llmSuccessMessageParts.join(' '),
        returnDisplay: displayResult,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error executing edit: ${errorMsg}`,
        returnDisplay: `Error writing file: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }
  }

  /**
   * Creates parent directories if they don't exist
   */
  private ensureParentDirectoriesExist(filePath: string): void {
    const dirName = path.dirname(filePath);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }
  }

  getModifyContext(_: AbortSignal): ModifyContext<EditToolParams> {
    return {
      getFilePath: (params: EditToolParams) => params.file_path,
      getCurrentContent: async (params: EditToolParams): Promise<string> => {
        try {
          return fs.readFileSync(params.file_path, 'utf8');
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (params: EditToolParams): Promise<string> => {
        try {
          const currentContent = fs.readFileSync(params.file_path, 'utf8');
          return this._applyReplacement(
            currentContent,
            params.old_string,
            params.new_string,
            params.old_string === '' && currentContent === '',
            params.target_occurrence_index,
          );
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      createUpdatedParams: (
        oldContent: string,
        modifiedProposedContent: string,
        originalParams: EditToolParams,
      ): EditToolParams => ({
        ...originalParams,
        old_string: oldContent,
        new_string: modifiedProposedContent,
        modified_by_user: true,
      }),
    };
  }
}
