/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShikiTool, Task } from './shikiTool.js';
import { Config } from '../config/config.js';
import { ShikiManagerTool } from './shikiManagerTool.js';
import { ToolResult } from './tools.js';
import WebSocket from 'ws';

// Mock dependencies
vi.mock('../config/config.js');
vi.mock('./shikiManagerTool.js');
vi.mock('ws');

describe('ShikiTool', () => {
  let config: Config;
  let shikiTool: ShikiTool;
  let mockShikiManagerTool: ShikiManagerTool;
  let mockUpdateOutput: (output: string) => void;

  const mockTaskData = {
    id: 'task-123',
    status: 'Pending',
    definition: { prompt: 'Test prompt' },
    created_at: new Date().toISOString(),
    result: null,
  };

  // Helper to create a valid ToolResult mock
  const createMockToolResult = (data: any): ToolResult => ({
    llmContent: JSON.stringify({ data }),
    returnDisplay: 'Success',
    summary: 'Successful execution',
  });

  beforeEach(() => {
    config = new Config({} as any); // Provide dummy arg to constructor
    vi.spyOn(config, 'getShikiManagerApiUrl').mockReturnValue('http://localhost:8080');
    
    shikiTool = new ShikiTool(config);
    mockShikiManagerTool = (shikiTool as any).shikiManagerTool;
    mockUpdateOutput = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    shikiTool.closeAllSubscriptions();
  });

  describe('Synchronous Subcommands', () => {
    it('list_tasks should call shikiManagerTool and format the result', async () => {
      const mockApiResponse = createMockToolResult([mockTaskData]);
      vi.spyOn(mockShikiManagerTool, 'execute').mockResolvedValue(mockApiResponse);

      const result = await shikiTool.execute({ subcommand: 'list_tasks' }, new AbortController().signal);

      expect(mockShikiManagerTool.execute).toHaveBeenCalledWith(
        { subcommand: 'list_tasks', args: ['--verbose'] },
        expect.any(AbortSignal)
      );
      
      const expectedTasks: Task[] = [{
        id: 'task-123',
        status: 'Pending',
        prompt: 'Test prompt',
        createdAt: mockTaskData.created_at,
        result: null,
      }];
      expect(JSON.parse(result.llmContent as string)).toEqual(expectedTasks);
    });

    it('get_task should call shikiManagerTool and format the result', async () => {
      const mockApiResponse = createMockToolResult(mockTaskData);
      vi.spyOn(mockShikiManagerTool, 'execute').mockResolvedValue(mockApiResponse);

      const result = await shikiTool.execute({ subcommand: 'get_task', taskId: 'task-123' }, new AbortController().signal);

      expect(mockShikiManagerTool.execute).toHaveBeenCalledWith(
        { subcommand: 'get_task', args: ['task-123'] },
        expect.any(AbortSignal)
      );

      const expectedTask: Task = {
        id: 'task-123',
        status: 'Pending',
        prompt: 'Test prompt',
        createdAt: mockTaskData.created_at,
        result: null,
      };
      expect(JSON.parse(result.llmContent as string)).toEqual(expectedTask);
    });
  });

  describe('create_task and WebSocket logic', () => {
    let mockWsInstance: WebSocket;
    const mockWsEvents: { [key: string]: (...args: any[]) => void } = {};

    beforeEach(() => {
      mockWsInstance = {
        on: vi.fn((event, cb) => { mockWsEvents[event] = cb; }),
        close: vi.fn(),
        readyState: WebSocket.OPEN,
      } as unknown as WebSocket;

      (WebSocket as any).mockImplementation(() => mockWsInstance);

      const mockApiResponse = createMockToolResult(mockTaskData);
      vi.spyOn(mockShikiManagerTool, 'execute').mockResolvedValue(mockApiResponse);
    });

    it('create_task should call shikiManagerTool and initiate a WebSocket connection', async () => {
      await shikiTool.execute(
        { subcommand: 'create_task', prompt: 'Test prompt' }, 
        new AbortController().signal, 
        mockUpdateOutput
      );

      expect(mockShikiManagerTool.execute).toHaveBeenCalledWith(
        { subcommand: 'create_task', args: ['Test prompt'] },
        expect.any(AbortSignal)
      );

      expect(WebSocket).toHaveBeenCalledWith('ws://localhost:8080/api/v1/tasks/task-123/ws');
      expect(mockUpdateOutput).toHaveBeenCalledWith('✅ Task created with ID: task-123');
    });

    it('should handle WebSocket open event', async () => {
      await shikiTool.execute({ subcommand: 'create_task', prompt: 'Test prompt' }, new AbortController().signal, mockUpdateOutput);
      mockWsEvents.open();
      expect(mockUpdateOutput).toHaveBeenCalledWith('[WS] 🔌 Connection established for task task-123. Waiting for updates...');
    });

    it('should handle WebSocket message event', async () => {
      await shikiTool.execute({ subcommand: 'create_task', prompt: 'Test prompt' }, new AbortController().signal, mockUpdateOutput);
      const updateMessage = JSON.stringify({ status: 'InProgress' });
      mockWsEvents.message(updateMessage);
      expect(mockUpdateOutput).toHaveBeenCalledWith('[WS] 🔄 Task task-123 status: InProgress');
    });

    it('should handle WebSocket error event', async () => {
      await shikiTool.execute({ subcommand: 'create_task', prompt: 'Test prompt' }, new AbortController().signal, mockUpdateOutput);
      const error = new Error('Connection failed');
      mockWsEvents.error(error);
      expect(mockUpdateOutput).toHaveBeenCalledWith('[WS] ❌ Error for task task-123: Connection failed');
      expect((shikiTool as any).subscriptions.has('task-123')).toBe(false);
    });

    it('should handle WebSocket close event', async () => {
      await shikiTool.execute({ subcommand: 'create_task', prompt: 'Test prompt' }, new AbortController().signal, mockUpdateOutput);
      mockWsEvents.close(1000, 'Normal closure');
      expect(mockUpdateOutput).toHaveBeenCalledWith('[WS] 🔌 Connection closed for task task-123. Code: 1000, Reason: Normal closure');
      expect((shikiTool as any).subscriptions.has('task-123')).toBe(false);
    });

    it('closeAllSubscriptions should close any open WebSockets', async () => {
      await shikiTool.execute({ subcommand: 'create_task', prompt: 'Test prompt' }, new AbortController().signal);
      expect((shikiTool as any).subscriptions.has('task-123')).toBe(true);

      shikiTool.closeAllSubscriptions();

      expect(mockWsInstance.close).toHaveBeenCalled();
      expect((shikiTool as any).subscriptions.has('task-123')).toBe(false);
    });
  });
});