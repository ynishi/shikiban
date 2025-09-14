/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolCall } from './nonInteractiveToolExecutor.js';
import {
  ToolRegistry,
  ToolCallRequestInfo,
  ToolResult,
  Config,
  ToolErrorType,
} from '../index.js';
import { Part } from '@google/genai';
import { MockTool } from '../test-utils/tools.js';

describe('executeToolCall', () => {
  let mockToolRegistry: ToolRegistry;
  let mockTool: MockTool;
  let abortController: AbortController;
  let mockConfig: Config;

  beforeEach(() => {
    mockTool = new MockTool();

    mockToolRegistry = {
      getTool: vi.fn(),
      // Add other ToolRegistry methods if needed, or use a more complete mock
    } as unknown as ToolRegistry;

    mockConfig = {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
        authType: 'oauth-personal',
      }),
      getToolRegistry: () => mockToolRegistry,
    } as unknown as Config;

    abortController = new AbortController();
  });

  it('should execute a tool successfully', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call1',
      name: 'testTool',
      args: { param1: 'value1' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    };
    const toolResult: ToolResult = {
      llmContent: 'Tool executed successfully',
      returnDisplay: 'Success!',
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    vi.spyOn(mockTool, 'validateBuildAndExecute').mockResolvedValue(toolResult);

    const response = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    expect(mockToolRegistry.getTool).toHaveBeenCalledWith('testTool');
    expect(mockTool.validateBuildAndExecute).toHaveBeenCalledWith(
      request.args,
      abortController.signal,
    );
    expect(response.callId).toBe('call1');
    expect(response.error).toBeUndefined();
    expect(response.resultDisplay).toBe('Success!');
    expect(response.responseParts).toEqual({
      functionResponse: {
        name: 'testTool',
        id: 'call1',
        response: { output: 'Tool executed successfully' },
      },
    });
  });

  it('should return an error if tool is not found', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call2',
      name: 'nonexistentTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-2',
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(undefined);

    const response = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    expect(response.callId).toBe('call2');
    expect(response.error).toBeInstanceOf(Error);
    expect(response.error?.message).toBe(
      'Tool "nonexistentTool" not found in registry.',
    );
    expect(response.resultDisplay).toBe(
      'Tool "nonexistentTool" not found in registry.',
    );
    expect(response.responseParts).toEqual([
      {
        functionResponse: {
          name: 'nonexistentTool',
          id: 'call2',
          response: { error: 'Tool "nonexistentTool" not found in registry.' },
        },
      },
    ]);
  });

  it('should return an error if tool validation fails', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call3',
      name: 'testTool',
      args: { param1: 'invalid' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-3',
    };
    const validationErrorResult: ToolResult = {
      llmContent: 'Error: Invalid parameters',
      returnDisplay: 'Invalid parameters',
      error: {
        message: 'Invalid parameters',
        type: ToolErrorType.INVALID_TOOL_PARAMS,
      },
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    vi.spyOn(mockTool, 'validateBuildAndExecute').mockResolvedValue(
      validationErrorResult,
    );

    const response = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );
    expect(response).toStrictEqual({
      callId: 'call3',
      error: new Error('Invalid parameters'),
      errorType: ToolErrorType.INVALID_TOOL_PARAMS,
      responseParts: {
        functionResponse: {
          id: 'call3',
          name: 'testTool',
          response: {
            output: 'Error: Invalid parameters',
          },
        },
      },
      resultDisplay: 'Invalid parameters',
    });
  });

  it('should return an error if tool execution fails', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call4',
      name: 'testTool',
      args: { param1: 'value1' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-4',
    };
    const executionErrorResult: ToolResult = {
      llmContent: 'Error: Execution failed',
      returnDisplay: 'Execution failed',
      error: {
        message: 'Execution failed',
        type: ToolErrorType.EXECUTION_FAILED,
      },
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    vi.spyOn(mockTool, 'validateBuildAndExecute').mockResolvedValue(
      executionErrorResult,
    );

    const response = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );
    expect(response).toStrictEqual({
      callId: 'call4',
      error: new Error('Execution failed'),
      errorType: ToolErrorType.EXECUTION_FAILED,
      responseParts: {
        functionResponse: {
          id: 'call4',
          name: 'testTool',
          response: {
            output: 'Error: Execution failed',
          },
        },
      },
      resultDisplay: 'Execution failed',
    });
  });

  it('should return an unhandled exception error if execution throws', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call5',
      name: 'testTool',
      args: { param1: 'value1' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-5',
    };
    const executionError = new Error('Something went very wrong');
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    vi.spyOn(mockTool, 'validateBuildAndExecute').mockRejectedValue(
      executionError,
    );

    const response = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    expect(response.callId).toBe('call5');
    expect(response.error).toBe(executionError);
    expect(response.errorType).toBe(ToolErrorType.UNHANDLED_EXCEPTION);
    expect(response.resultDisplay).toBe('Something went very wrong');
    expect(response.responseParts).toEqual([
      {
        functionResponse: {
          name: 'testTool',
          id: 'call5',
          response: { error: 'Something went very wrong' },
        },
      },
    ]);
  });

  it('should correctly format llmContent with inlineData', async () => {
    const request: ToolCallRequestInfo = {
      callId: 'call6',
      name: 'testTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-6',
    };
    const imageDataPart: Part = {
      inlineData: { mimeType: 'image/png', data: 'base64data' },
    };
    const toolResult: ToolResult = {
      llmContent: [imageDataPart],
      returnDisplay: 'Image processed',
    };
    vi.mocked(mockToolRegistry.getTool).mockReturnValue(mockTool);
    vi.spyOn(mockTool, 'validateBuildAndExecute').mockResolvedValue(toolResult);

    const response = await executeToolCall(
      mockConfig,
      request,
      abortController.signal,
    );

    expect(response.resultDisplay).toBe('Image processed');
    expect(response.responseParts).toEqual([
      {
        functionResponse: {
          name: 'testTool',
          id: 'call6',
          response: {
            output: 'Binary content of type image/png was processed.',
          },
        },
      },
      imageDataPart,
    ]);
  });
});
