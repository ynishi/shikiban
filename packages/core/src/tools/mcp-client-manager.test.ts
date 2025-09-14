/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClientManager } from './mcp-client-manager.js';
import { McpClient } from './mcp-client.js';
import { ToolRegistry } from './tool-registry.js';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';

vi.mock('./mcp-client.js', async () => {
  const originalModule = await vi.importActual('./mcp-client.js');
  return {
    ...originalModule,
    McpClient: vi.fn(),
    populateMcpServerCommand: vi.fn(() => ({
      'test-server': {},
    })),
  };
});

describe('McpClientManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should discover tools from all servers', async () => {
    const mockedMcpClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn(),
      getStatus: vi.fn(),
    };
    vi.mocked(McpClient).mockReturnValue(
      mockedMcpClient as unknown as McpClient,
    );
    const manager = new McpClientManager(
      {
        'test-server': {},
      },
      '',
      {} as ToolRegistry,
      {} as PromptRegistry,
      false,
      {} as WorkspaceContext,
    );
    await manager.discoverAllMcpTools();
    expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
    expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
  });
});
