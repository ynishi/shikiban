/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as chokidar from 'chokidar';
import { internalEventBus, InternalEvent } from '../utils/internalEventBus.js';

interface FileWatcherOptions {
  path: string;
  enabled?: boolean;
  ignored?: string | string[];
  persistent?: boolean;
  ignoreInitial?: boolean;
  depth?: number;
}

class FileWatcherService {
  private watcher: chokidar.FSWatcher | null = null;
  private static instance: FileWatcherService;

  private constructor() {}

  static getInstance(): FileWatcherService {
    if (!FileWatcherService.instance) {
      FileWatcherService.instance = new FileWatcherService();
    }
    return FileWatcherService.instance;
  }

  startWatching(options: FileWatcherOptions): void {
    if (options.enabled === false) {
      console.log('File watching is disabled.');
      this.stopWatching();
      return;
    }

    if (this.watcher) {
      console.warn(
        'FileWatcherService is already watching. Stopping current watcher before starting a new one.',
      );
      this.stopWatching();
    }

    const { path, ...chokidarOptions } = options;

    this.watcher = chokidar.watch(path, {
      ignored: chokidarOptions.ignored || /(^|[\\/])\\..*/, // ignore dotfiles
      persistent:
        chokidarOptions.persistent !== undefined
          ? chokidarOptions.persistent
          : true,
      ignoreInitial:
        chokidarOptions.ignoreInitial !== undefined
          ? chokidarOptions.ignoreInitial
          : false,
      depth: chokidarOptions.depth,
    });

    this.watcher
      .on('add', (path: string) => {
        internalEventBus.emit(InternalEvent.FILE_CHANGED, {
          type: 'add',
          path,
        });
        console.log(`File ${path} has been added`);
      })
      .on('change', (path: string) => {
        internalEventBus.emit(InternalEvent.FILE_CHANGED, {
          type: 'change',
          path,
        });
        console.log(`File ${path} has been changed`);
      })
      .on('unlink', (path: string) => {
        internalEventBus.emit(InternalEvent.FILE_CHANGED, {
          type: 'unlink',
          path,
        });
        console.log(`File ${path} has been removed`);
      })
      .on('error', (error: unknown) => console.error(`Watcher error: ${error}`))
      .on('ready', () =>
        console.log('Initial scan complete. Ready for changes'),
      );

    console.log(`Started watching: ${path}`);
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log('Stopped watching.');
    }
  }
}

export const fileWatcherService = FileWatcherService.getInstance();
