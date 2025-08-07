/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FunctionDeclaration, PartListUnion, Schema } from '@google/genai';
import { ToolErrorType } from './tool-error.js';
import { DiffUpdateResult } from '../ide/ideContext.js';

/**
 * Represents a validated and ready-to-execute tool call.
 * An instance of this is created by a `ToolBuilder`.
 */
export interface ToolInvocation<
  TParams extends object,
  TResult extends ToolResult,
> {
  /**
   * The validated parameters for this specific invocation.
   */
  params: TParams;

  /**
   * Gets a pre-execution description of the tool operation.
   * @returns A markdown string describing what the tool will do.
   */
  getDescription(): string;

  /**
   * Determines what file system paths the tool will affect.
   * @returns A list of such paths.
   */
  toolLocations(): ToolLocation[];

  /**
   * Determines if the tool should prompt for confirmation before execution.
   * @returns Confirmation details or false if no confirmation is needed.
   */
  shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false>;

  /**
   * Executes the tool with the validated parameters.
   * @param signal AbortSignal for tool cancellation.
   * @param updateOutput Optional callback to stream output.
   * @returns Result of the tool execution.
   */
  execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<TResult>;
}

/**
 * A convenience base class for ToolInvocation.
 */
export abstract class BaseToolInvocation<
  TParams extends object,
  TResult extends ToolResult,
> implements ToolInvocation<TParams, TResult>
{
  constructor(readonly params: TParams) {}

  abstract getDescription(): string;

  toolLocations(): ToolLocation[] {
    return [];
  }

  shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return Promise.resolve(false);
  }

  abstract execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<TResult>;
}

/**
 * A type alias for a tool invocation where the specific parameter and result types are not known.
 */
export type AnyToolInvocation = ToolInvocation<object, ToolResult>;

/**
 * An adapter that wraps the legacy `Tool` interface to make it compatible
 * with the new `ToolInvocation` pattern.
 */
export class LegacyToolInvocation<
  TParams extends object,
  TResult extends ToolResult,
> implements ToolInvocation<TParams, TResult>
{
  constructor(
    private readonly legacyTool: BaseTool<TParams, TResult>,
    readonly params: TParams,
  ) {}

  getDescription(): string {
    return this.legacyTool.getDescription(this.params);
  }

  toolLocations(): ToolLocation[] {
    return this.legacyTool.toolLocations(this.params);
  }

  shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return this.legacyTool.shouldConfirmExecute(this.params, abortSignal);
  }

  execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<TResult> {
    return this.legacyTool.execute(this.params, signal, updateOutput);
  }
}

/**
 * Interface for a tool builder that validates parameters and creates invocations.
 */
export interface ToolBuilder<
  TParams extends object,
  TResult extends ToolResult,
> {
  /**
   * The internal name of the tool (used for API calls).
   */
  name: string;

  /**
   * The user-friendly display name of the tool.
   */
  displayName: string;

  /**
   * Description of what the tool does.
   */
  description: string;

  /**
   * The icon to display when interacting via ACP.
   */
  icon: Icon;

  /**
   * Function declaration schema from @google/genai.
   */
  schema: FunctionDeclaration;

  /**
   * Whether the tool's output should be rendered as markdown.
   */
  isOutputMarkdown: boolean;

  /**
   * Whether the tool supports live (streaming) output.
   */
  canUpdateOutput: boolean;

  /**
   * Validates raw parameters and builds a ready-to-execute invocation.
   * @param params The raw, untrusted parameters from the model.
   * @returns A valid `ToolInvocation` if successful. Throws an error if validation fails.
   */
  build(params: TParams): ToolInvocation<TParams, TResult>;
}

/**
 * New base class for tools that separates validation from execution.
 * New tools should extend this class.
 */
export abstract class DeclarativeTool<
  TParams extends object,
  TResult extends ToolResult,
> implements ToolBuilder<TParams, TResult>
{
  constructor(
    readonly name: string,
    readonly displayName: string,
    readonly description: string,
    readonly icon: Icon,
    readonly parameterSchema: Schema,
    readonly isOutputMarkdown: boolean = true,
    readonly canUpdateOutput: boolean = false,
  ) {}

  get schema(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameterSchema,
    };
  }

  /**
   * Validates the raw tool parameters.
   * Subclasses should override this to add custom validation logic
   * beyond the JSON schema check.
   * @param params The raw parameters from the model.
   * @returns An error message string if invalid, null otherwise.
   */
  protected validateToolParams(_params: TParams): string | null {
    // Base implementation can be extended by subclasses.
    return null;
  }

  /**
   * The core of the new pattern. It validates parameters and, if successful,
   * returns a `ToolInvocation` object that encapsulates the logic for the
   * specific, validated call.
   * @param params The raw, untrusted parameters from the model.
   * @returns A `ToolInvocation` instance.
   */
  abstract build(params: TParams): ToolInvocation<TParams, TResult>;

  /**
   * A convenience method that builds and executes the tool in one step.
   * Throws an error if validation fails.
   * @param params The raw, untrusted parameters from the model.
   * @param signal AbortSignal for tool cancellation.
   * @param updateOutput Optional callback to stream output.
   * @returns The result of the tool execution.
   */
  async buildAndExecute(
    params: TParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<TResult> {
    const invocation = this.build(params);
    return invocation.execute(signal, updateOutput);
  }
}

/**
 * New base class for declarative tools that separates validation from execution.
 * New tools should extend this class, which provides a `build` method that
 * validates parameters before deferring to a `createInvocation` method for
 * the final `ToolInvocation` object instantiation.
 */
export abstract class BaseDeclarativeTool<
  TParams extends object,
  TResult extends ToolResult,
> extends DeclarativeTool<TParams, TResult> {
  build(params: TParams): ToolInvocation<TParams, TResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      throw new Error(validationError);
    }
    return this.createInvocation(params);
  }

  protected abstract createInvocation(
    params: TParams,
  ): ToolInvocation<TParams, TResult>;
}

/**
 * A type alias for a declarative tool where the specific parameter and result types are not known.
 */
export type AnyDeclarativeTool = DeclarativeTool<object, ToolResult>;

/**
 * Base implementation for tools with common functionality
 * @deprecated Use `DeclarativeTool` for new tools.
 */
export abstract class BaseTool<
  TParams extends object,
  TResult extends ToolResult = ToolResult,
> extends DeclarativeTool<TParams, TResult> {
  /**
   * Creates a new instance of BaseTool
   * @param name Internal name of the tool (used for API calls)
   * @param displayName User-friendly display name of the tool
   * @param description Description of what the tool does
   * @param isOutputMarkdown Whether the tool's output should be rendered as markdown
   * @param canUpdateOutput Whether the tool supports live (streaming) output
   * @param parameterSchema Open API 3.0 Schema defining the parameters
   */
  constructor(
    readonly name: string,
    readonly displayName: string,
    readonly description: string,
    readonly icon: Icon,
    readonly parameterSchema: Schema,
    readonly isOutputMarkdown: boolean = true,
    readonly canUpdateOutput: boolean = false,
  ) {
    super(
      name,
      displayName,
      description,
      icon,
      parameterSchema,
      isOutputMarkdown,
      canUpdateOutput,
    );
  }

  build(params: TParams): ToolInvocation<TParams, TResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      throw new Error(validationError);
    }
    return new LegacyToolInvocation(this, params);
  }

  /**
   * Validates the parameters for the tool
   * This is a placeholder implementation and should be overridden
   * Should be called from both `shouldConfirmExecute` and `execute`
   * `shouldConfirmExecute` should return false immediately if invalid
   * @param params Parameters to validate
   * @returns An error message string if invalid, null otherwise
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validateToolParams(params: TParams): string | null {
    // Implementation would typically use a JSON Schema validator
    // This is a placeholder that should be implemented by derived classes
    return null;
  }

  /**
   * Gets a pre-execution description of the tool operation
   * Default implementation that should be overridden by derived classes
   * @param params Parameters for the tool execution
   * @returns A markdown string describing what the tool will do
   */
  getDescription(params: TParams): string {
    return JSON.stringify(params);
  }

  /**
   * Determines if the tool should prompt for confirmation before execution
   * @param params Parameters for the tool execution
   * @returns Whether or not execute should be confirmed by the user.
   */
  shouldConfirmExecute(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    params: TParams,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return Promise.resolve(false);
  }

  /**
   * Determines what file system paths the tool will affect
   * @param params Parameters for the tool execution
   * @returns A list of such paths
   */
  toolLocations(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    params: TParams,
  ): ToolLocation[] {
    return [];
  }

  /**
   * Abstract method to execute the tool with the given parameters
   * Must be implemented by derived classes
   * @param params Parameters for the tool execution
   * @param signal AbortSignal for tool cancellation
   * @returns Result of the tool execution
   */
  abstract execute(
    params: TParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<TResult>;
}

export interface ToolResult {
  /**
   * A short, one-line summary of the tool's action and result.
   * e.g., "Read 5 files", "Wrote 256 bytes to foo.txt"
   */
  summary?: string;
  /**
   * Content meant to be included in LLM history.
   * This should represent the factual outcome of the tool execution.
   */
  llmContent: PartListUnion;

  /**
   * Markdown string for user display.
   * This provides a user-friendly summary or visualization of the result.
   * NOTE: This might also be considered UI-specific and could potentially be
   * removed or modified in a further refactor if the server becomes purely API-driven.
   * For now, we keep it as the core logic in ReadFileTool currently produces it.
   */
  returnDisplay: ToolResultDisplay;

  /**
   * If this property is present, the tool call is considered a failure.
   */
  error?: {
    message: string; // raw error message
    type?: ToolErrorType; // An optional machine-readable error type (e.g., 'FILE_NOT_FOUND').
  };
}

/**
 * Detects cycles in a JSON schemas due to `$ref`s.
 * @param schema The root of the JSON schema.
 * @returns `true` if a cycle is detected, `false` otherwise.
 */
export function hasCycleInSchema(schema: object): boolean {
  function resolveRef(ref: string): object | null {
    if (!ref.startsWith('#/')) {
      return null;
    }
    const path = ref.substring(2).split('/');
    let current: unknown = schema;
    for (const segment of path) {
      if (
        typeof current !== 'object' ||
        current === null ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        return null;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current as object;
  }

  function traverse(
    node: unknown,
    visitedRefs: Set<string>,
    pathRefs: Set<string>,
  ): boolean {
    if (typeof node !== 'object' || node === null) {
      return false;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        if (traverse(item, visitedRefs, pathRefs)) {
          return true;
        }
      }
      return false;
    }

    if ('$ref' in node && typeof node.$ref === 'string') {
      const ref = node.$ref;
      if (ref === '#/' || pathRefs.has(ref)) {
        // A ref to just '#/' is always a cycle.
        return true; // Cycle detected!
      }
      if (visitedRefs.has(ref)) {
        return false; // Bail early, we have checked this ref before.
      }

      const resolvedNode = resolveRef(ref);
      if (resolvedNode) {
        // Add it to both visited and the current path
        visitedRefs.add(ref);
        pathRefs.add(ref);
        const hasCycle = traverse(resolvedNode, visitedRefs, pathRefs);
        pathRefs.delete(ref); // Backtrack, leaving it in visited
        return hasCycle;
      }
    }

    // Crawl all the properties of node
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        if (
          traverse(
            (node as Record<string, unknown>)[key],
            visitedRefs,
            pathRefs,
          )
        ) {
          return true;
        }
      }
    }

    return false;
  }

  return traverse(schema, new Set<string>(), new Set<string>());
}

export type ToolResultDisplay = string | FileDiff;

export interface FileDiff {
  fileDiff: string;
  fileName: string;
  originalContent: string | null;
  newContent: string;
}

export interface ToolEditConfirmationDetails {
  type: 'edit';
  title: string;
  onConfirm: (
    outcome: ToolConfirmationOutcome,
    payload?: ToolConfirmationPayload,
  ) => Promise<void>;
  fileName: string;
  filePath: string;
  fileDiff: string;
  originalContent: string | null;
  newContent: string;
  isModifying?: boolean;
  ideConfirmation?: Promise<DiffUpdateResult>;
}

export interface ToolConfirmationPayload {
  // used to override `modifiedProposedContent` for modifiable tools in the
  // inline modify flow
  newContent: string;
}

export interface ToolExecuteConfirmationDetails {
  type: 'exec';
  title: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
  command: string;
  rootCommand: string;
}

export interface ToolMcpConfirmationDetails {
  type: 'mcp';
  title: string;
  serverName: string;
  toolName: string;
  toolDisplayName: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
}

export interface ToolInfoConfirmationDetails {
  type: 'info';
  title: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
  prompt: string;
  urls?: string[];
}

export type ToolCallConfirmationDetails =
  | ToolEditConfirmationDetails
  | ToolExecuteConfirmationDetails
  | ToolMcpConfirmationDetails
  | ToolInfoConfirmationDetails;

export enum ToolConfirmationOutcome {
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAlwaysServer = 'proceed_always_server',
  ProceedAlwaysTool = 'proceed_always_tool',
  ModifyWithEditor = 'modify_with_editor',
  Cancel = 'cancel',
}

export enum Icon {
  FileSearch = 'fileSearch',
  Folder = 'folder',
  Globe = 'globe',
  Hammer = 'hammer',
  LightBulb = 'lightBulb',
  Pencil = 'pencil',
  Regex = 'regex',
  Terminal = 'terminal',
}

export interface ToolLocation {
  // Absolute path to the file
  path: string;
  // Which line (if known)
  line?: number;
}
