/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitTool } from './gitTool.js';
import { Config } from '../config/config.js';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process module
vi.mock('child_process');

describe('GitTool', () => {
  let gitTool: GitTool;
  let mockConfig: Config;
  let mockProcess: any;
  let mockStdout: EventEmitter;
  let mockStderr: EventEmitter;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create mock config
    mockConfig = {} as Config;

    // Create GitTool instance
    gitTool = new GitTool(mockConfig);

    // Create mock process with event emitters
    mockStdout = new EventEmitter();
    mockStderr = new EventEmitter();
    mockProcess = new EventEmitter();
    mockProcess.stdout = mockStdout;
    mockProcess.stderr = mockStderr;
    mockProcess.pid = 12345;
    mockProcess.kill = vi.fn();

    // Mock spawn to return our mock process
    vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('executeGitCommand', () => {
    it('should handle standard case with command as git subcommand', async () => {
      // Create invocation with standard command
      const invocation = gitTool['createInvocation']({
        command: 'status',
        args: ['--short'],
      });

      // Start execution
      const abortController = new AbortController();
      const executePromise = invocation.execute(abortController.signal);

      // Simulate successful git command
      setTimeout(() => {
        mockStdout.emit('data', Buffer.from('M  file.txt\n'));
        mockProcess.emit('close', 0);
      }, 10);

      const result = await executePromise;

      // Verify spawn was called with correct arguments
      expect(vi.mocked(child_process.spawn)).toHaveBeenCalledWith(
        'git',
        ['status', '--short'],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        })
      );

      // Verify result
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('M  file.txt');
    });

    it('should handle new case where command is "git"', async () => {
      // Create invocation with command as 'git'
      const invocation = gitTool['createInvocation']({
        command: 'git',
        args: ['status', '--short'],
      });

      // Start execution
      const abortController = new AbortController();
      const executePromise = invocation.execute(abortController.signal);

      // Simulate successful git command
      setTimeout(() => {
        mockStdout.emit('data', Buffer.from('M  file.txt\n'));
        mockProcess.emit('close', 0);
      }, 10);

      const result = await executePromise;

      // Verify spawn was called with adjusted arguments (args used directly)
      expect(vi.mocked(child_process.spawn)).toHaveBeenCalledWith(
        'git',
        ['status', '--short'],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        })
      );

      // Verify result
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('M  file.txt');
    });

    it('should handle "git" command with no args as standard case', async () => {
      // Create invocation with command as 'git' but no args
      const invocation = gitTool['createInvocation']({
        command: 'git',
      });

      // Start execution
      const abortController = new AbortController();
      const executePromise = invocation.execute(abortController.signal);

      // Simulate git command failure (git without subcommand shows usage)
      setTimeout(() => {
        mockStderr.emit('data', Buffer.from('usage: git [--version]'));
        mockProcess.emit('close', 1);
      }, 10);

      const result = await executePromise;

      // Verify spawn was called with 'git' as subcommand (standard case)
      expect(vi.mocked(child_process.spawn)).toHaveBeenCalledWith(
        'git',
        ['git'],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        })
      );

      // Verify error result
      expect(result.error).toBeDefined();
      expect(result.llmContent).toContain('Error');
    });

    it('should handle "git" command with empty args array as standard case', async () => {
      // Create invocation with command as 'git' and empty args array
      const invocation = gitTool['createInvocation']({
        command: 'git',
        args: [],
      });

      // Start execution
      const abortController = new AbortController();
      const executePromise = invocation.execute(abortController.signal);

      // Simulate git command failure
      setTimeout(() => {
        mockStderr.emit('data', Buffer.from('usage: git [--version]'));
        mockProcess.emit('close', 1);
      }, 10);

      const result = await executePromise;

      // Verify spawn was called with 'git' as subcommand (standard case)
      expect(vi.mocked(child_process.spawn)).toHaveBeenCalledWith(
        'git',
        ['git'],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        })
      );

      // Verify error result
      expect(result.error).toBeDefined();
    });

    it('should pass directory option to spawn', async () => {
      const testDir = '/path/to/repo';
      
      // Create invocation with directory
      const invocation = gitTool['createInvocation']({
        command: 'log',
        args: ['--oneline', '-5'],
        directory: testDir,
      });

      // Start execution
      const abortController = new AbortController();
      const executePromise = invocation.execute(abortController.signal);

      // Simulate successful git command
      setTimeout(() => {
        mockStdout.emit('data', Buffer.from('abc123 Commit message\n'));
        mockProcess.emit('close', 0);
      }, 10);

      await executePromise;

      // Verify spawn was called with correct cwd
      expect(vi.mocked(child_process.spawn)).toHaveBeenCalledWith(
        'git',
        ['log', '--oneline', '-5'],
        expect.objectContaining({
          cwd: testDir,
        })
      );
    });

    it('should handle complex git command through "git" command parameter', async () => {
      // Create invocation simulating a complex git command
      const invocation = gitTool['createInvocation']({
        command: 'git',
        args: ['commit', '-m', 'Fix: resolved issue #123', '--amend'],
      });

      // Start execution
      const abortController = new AbortController();
      const executePromise = invocation.execute(abortController.signal);

      // Simulate successful git command
      setTimeout(() => {
        mockStdout.emit('data', Buffer.from('[main abc1234] Fix: resolved issue #123\n'));
        mockProcess.emit('close', 0);
      }, 10);

      const result = await executePromise;

      // Verify spawn was called with all args passed through
      expect(vi.mocked(child_process.spawn)).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'Fix: resolved issue #123', '--amend'],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        })
      );

      // Verify result contains the commit output
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('[main abc1234] Fix: resolved issue #123');
    });

    it('should de-duplicate command and args', async () => {
      // Create invocation with duplicated command in args
      const invocation = gitTool['createInvocation']({
        command: 'status',
        args: ['status', '--short'],
      });

      // Start execution
      const abortController = new AbortController();
      const executePromise = invocation.execute(abortController.signal);

      // Simulate successful git command
      setTimeout(() => {
        mockStdout.emit('data', Buffer.from('M  file.txt\n'));
        mockProcess.emit('close', 0);
      }, 10);

      await executePromise;

      // Verify spawn was called with de-duplicated arguments
      expect(vi.mocked(child_process.spawn)).toHaveBeenCalledWith(
        'git',
        ['status', '--short'], // The 'status' duplicate should be removed
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        })
      );
    });
  });

  describe('validateToolParams', () => {
    it('should reject git add with . (dot)', () => {
      const params = {
        command: 'add',
        args: ['.'],
      };
      
      const validationError = gitTool['validateToolParams'](params);
      expect(validationError).toBe('Git add with "." is disallowed for safety. Please add files explicitly by name.');
    });

    it('should reject git add with -A flag', () => {
      const params = {
        command: 'add',
        args: ['-A'],
      };
      
      const validationError = gitTool['validateToolParams'](params);
      expect(validationError).toBe('Git add with "-A" is disallowed for safety. Please add files explicitly by name.');
    });

    it('should reject git add with --all flag', () => {
      const params = {
        command: 'add',
        args: ['--all'],
      };
      
      const validationError = gitTool['validateToolParams'](params);
      expect(validationError).toBe('Git add with "--all" is disallowed for safety. Please add files explicitly by name.');
    });

    it('should reject git add with . even when combined with other args', () => {
      const params = {
        command: 'add',
        args: ['-v', '.', '--no-ignore'],
      };
      
      const validationError = gitTool['validateToolParams'](params);
      expect(validationError).toBe('Git add with "." is disallowed for safety. Please add files explicitly by name.');
    });

    it('should accept git add with specific file names', () => {
      const params = {
        command: 'add',
        args: ['my-file.ts', 'another-file.js'],
      };
      
      const validationError = gitTool['validateToolParams'](params);
      expect(validationError).toBeNull();
    });

    it('should accept git add with paths containing dots', () => {
      const params = {
        command: 'add',
        args: ['./src/file.ts', '../lib/other.js'],
      };
      
      const validationError = gitTool['validateToolParams'](params);
      expect(validationError).toBeNull();
    });

    it('should accept other git commands without restriction', () => {
      const params = {
        command: 'status',
        args: ['--all'],
      };
      
      const validationError = gitTool['validateToolParams'](params);
      expect(validationError).toBeNull();
    });
  });
});