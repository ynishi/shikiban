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
    nodeTitle: string;
    widgetName: string;
    value: unknown;
  }>;
}

export class ComfyEditorTool extends BaseTool<ComfyEditorToolParams, ToolResult> {
  static readonly Name: string = 'comfy_editor';

  constructor(private readonly config: Config) {
    super(
      ComfyEditorTool.Name,
      'ComfyEditor',
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
                nodeTitle: { type: Type.STRING },
                widgetName: { type: Type.STRING },
                value: {},
              },
              required: ['nodeTitle', 'widgetName', 'value'],
            },
          },
        },
        required: ['file_path', 'updates'],
      },
      false,
      false
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