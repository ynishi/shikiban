/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from '@google/genai';
import { executeWorkflowUpdates } from './comfy-editor/tool.js';
import { ToolErrorType } from './tool-error.js';
import { BaseTool, Icon, ToolResult } from './tools.js';
import { Config } from '../config/config.js';

export interface ComfyEditorToolParams {
  file_path: string;
  updates: Array<{
    nodeId?: number;
    nodeTitle?: string;
    widgetName: string;
    value: unknown;
  }>;
}

export class ComfyEditorTool extends BaseTool<
  ComfyEditorToolParams,
  ToolResult
> {
  static readonly Name: string = 'comfy_editor';

  constructor(private readonly config: Config) {
    super(
      ComfyEditorTool.Name,
      'ComfyEditor',
      // TODO(b/12345): Clarify that 'nodeTitle' refers to the user-set 'title' property in the JSON, which may not exist by default. The tool should be improved to fall back to other identifiers like node ID or properties['Node name for S&R'].
      'Programmatically edits a ComfyUI workflow JSON file by applying a series of updates.',
      Icon.Pencil,
      {
        type: Type.OBJECT,
        properties: {
          file_path: {
            type: Type.STRING,
            description: 'Absolute path to the ComfyUI workflow JSON file.',
          },
          updates: {
            type: Type.ARRAY,
            description: 'An array of update operations to apply.',
            items: {
              type: Type.OBJECT,
              properties: {
                nodeId: {
                  type: Type.NUMBER,
                  description:
                    'The unique ID of the node to target. If provided, this takes precedence over nodeTitle.',
                },
                nodeTitle: { type: Type.STRING },
                widgetName: { type: Type.STRING },
                value: {},
              },
              required: ['widgetName', 'value'],
            },
          },
        },
        required: ['file_path', 'updates'],
      },
      false,
      false,
    );
  }

  async execute(params: ComfyEditorToolParams): Promise<ToolResult> {
    try {
      await executeWorkflowUpdates(params.file_path, params.updates);
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
