/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from '@google/genai';
import { executeWorkflowUpdates } from './comfy-editor/tool.js';
import { ToolErrorType } from './tool-error.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolResult,
  ToolInvocation,
} from './tools.js';

export interface ComfyEditorToolParams {
  file_path: string;
  updates: Array<{
    action?: 'add_node' | 'update_widget';
    node?: any; // For adding nodes
    nodeId?: number; // For updating widgets
    nodeTitle?: string;
    nodeType?: string;
    widgetName?: string;
    value?: any;
  }>;
}

/**
 * Represents an invocation of the ComfyEditor tool.
 */
class ComfyEditorToolInvocation extends BaseToolInvocation<
  ComfyEditorToolParams,
  ToolResult
> {
  constructor(public override readonly params: ComfyEditorToolParams) {
    super(params);
  }

  override getDescription(): string {
    return `Editing ComfyUI workflow: ${this.params.file_path}`;
  }

  override async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    try {
      await executeWorkflowUpdates(this.params.file_path, this.params.updates);
      const successMessage = '✅ ComfyUI workflow updated successfully.';
      return {
        llmContent: successMessage,
        returnDisplay: successMessage,
      };
    } catch (e) {
      const err = e as Error;
      return {
        llmContent: `Error: ${err.message}`,
        returnDisplay: `❌ Error updating ComfyUI workflow: ${err.message}`,
        error: {
          message: err.message,
          type: ToolErrorType.UNKNOWN,
        },
      };
    }
  }
}

export class ComfyEditorTool extends BaseDeclarativeTool<
  ComfyEditorToolParams,
  ToolResult
> {
  static readonly Name: string = 'comfy_editor';

  constructor() {
    super(
      ComfyEditorTool.Name,
      'ComfyEditor',
      // TODO(b/12345): Clarify that 'nodeTitle' refers to the user-set 'title' property in the JSON, which may not exist by default. The tool should be improved to fall back to other identifiers like node ID or properties['Node name for S&R'].
      'Programmatically edits a ComfyUI workflow JSON file by applying a series of updates.',
      Kind.Edit,
      {
        type: Type.OBJECT,
        properties: {
          file_path: {
            type: Type.STRING,
            description: 'Absolute path to the ComfyUI workflow JSON file.',
          },
          updates: {
            type: Type.ARRAY,
            description: 'An array of update or add operations to apply.',
            items: {
              type: Type.OBJECT,
              properties: {
                action: {
                  type: Type.STRING,
                  description:
                    'The action to perform: `add_node` or `update_widget`. Defaults to `update_widget`.',
                },
                node: {
                  type: Type.OBJECT,
                  description:
                    'The node object to add. Required for `add_node` action.',
                },
                nodeId: {
                  type: Type.NUMBER,
                  description:
                    'The unique ID of the node to target for updates. If provided, this takes precedence over nodeTitle.',
                },
                nodeTitle: { type: Type.STRING },
                nodeType: {
                  type: Type.STRING,
                  description: 'The type of nodes to target for a bulk update.',
                },
                widgetName: { type: Type.STRING },
                value: {},
              },
            },
          },
        },
        required: ['file_path', 'updates'],
      },
      false,
      false,
    );
  }

  protected createInvocation(
    params: ComfyEditorToolParams,
  ): ToolInvocation<ComfyEditorToolParams, ToolResult> {
    return new ComfyEditorToolInvocation(params);
  }
}