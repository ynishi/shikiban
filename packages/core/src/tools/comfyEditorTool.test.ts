/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ComfyEditorTool, ComfyEditorToolParams } from './comfyEditorTool.js';
import { executeWorkflowUpdates } from './comfy-editor/tool.js';
import { Config } from '../config/config.js';
import { ToolErrorType } from './tool-error.js';

vi.mock('./comfy-editor/tool.js');

describe('ComfyEditorTool', () => {
  let tool: ComfyEditorTool;
  let mockConfig: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {} as Config;
    tool = new ComfyEditorTool(mockConfig);
  });

  it('should call executeWorkflowUpdates with the correct parameters on success', async () => {
    const params: ComfyEditorToolParams = {
      file_path: '/test/workflow.json',
      updates: [
        {
          nodeTitle: 'KSampler',
          widgetName: 'seed',
          value: 123,
        },
      ],
    };

    const result = await tool.execute(params);

    expect(executeWorkflowUpdates).toHaveBeenCalledTimes(1);
    expect(executeWorkflowUpdates).toHaveBeenCalledWith(
      params.file_path,
      params.updates,
    );

    const successMessage = '✅ ComfyUI workflow updated successfully.';
    expect(result.llmContent).toBe(successMessage);
    expect(result.returnDisplay).toBe(successMessage);
    expect(result.error).toBeUndefined();
  });

  it('should return an error result when executeWorkflowUpdates fails', async () => {
    const errorMessage = 'Something went wrong';
    vi.mocked(executeWorkflowUpdates).mockRejectedValue(
      new Error(errorMessage),
    );

    const params: ComfyEditorToolParams = {
      file_path: '/test/workflow.json',
      updates: [],
    };

    const result = await tool.execute(params);

    expect(executeWorkflowUpdates).toHaveBeenCalledTimes(1);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe(errorMessage);
    expect(result.error?.type).toBe(ToolErrorType.UNKNOWN);
    expect(result.returnDisplay).toContain(errorMessage);
  });
});
