/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink';
import { AppWrapper } from './ui/App.js';
import { loadCliConfig, parseArguments } from './config/config.js';
import { loadAllPersonas } from './config/personaLoader.js';
import { readStdin } from './utils/readStdin.js';
import { basename } from 'node:path';
import v8 from 'node:v8';
import os from 'node:os';
import dns from 'node:dns';
import { spawn } from 'node:child_process';
import { start_sandbox } from './utils/sandbox.js';
import {
  DnsResolutionOrder,
  LoadedSettings,
  loadSettings,
  SettingScope,
} from './config/settings.js';
import { themeManager } from './ui/themes/theme-manager.js';
import { getStartupWarnings } from './utils/startupWarnings.js';
import { getUserStartupWarnings } from './utils/userStartupWarnings.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { loadExtensions } from './config/extension.js';
import { cleanupCheckpoints, registerCleanup } from './utils/cleanup.js';
import { getCliVersion } from './utils/version.js';
import {
  Config,
  sessionId,
  logUserPrompt,
  AuthType,
  getOauthClient,
  logIdeConnection,
  IdeConnectionEvent,
  IdeConnectionType,
} from '@google/gemini-cli-core';
import { validateAuthMethod } from './config/auth.js';
import { setMaxSizedBoxDebugging } from './ui/components/shared/MaxSizedBox.js';
import { validateNonInteractiveAuth } from './validateNonInterActiveAuth.js';
import { detectAndEnableKittyProtocol } from './ui/utils/kittyProtocolDetector.js';
import { checkForUpdates } from './ui/utils/updateCheck.js';
import { handleAutoUpdate } from './utils/handleAutoUpdate.js';
import { appEvents, AppEvent } from './utils/events.js';
import { getSavedChatTags } from './ui/commands/chatCommand.js';
import { SettingsContext } from './ui/contexts/SettingsContext.js';

export function validateDnsResolutionOrder(
  order: string | undefined,
): DnsResolutionOrder {
  const defaultValue: DnsResolutionOrder = 'ipv4first';
  if (order === undefined) {
    return defaultValue;
  }
  if (order === 'ipv4first' || order === 'verbatim') {
    return order;
  }
  // We don't want to throw here, just warn and use the default.
  console.warn(
    `Invalid value for dnsResolutionOrder in settings: "${order}". Using default "${defaultValue}".`,
  );
  return defaultValue;
}

function getNodeMemoryArgs(config: Config): string[] {
  const totalMemoryMB = os.totalmem() / (1024 * 1024);
  const heapStats = v8.getHeapStatistics();
  const currentMaxOldSpaceSizeMb = Math.floor(
    heapStats.heap_size_limit / 1024 / 1024,
  );

  // Set target to 50% of total memory
  const targetMaxOldSpaceSizeInMB = Math.floor(totalMemoryMB * 0.5);
  if (config.getDebugMode()) {
    console.debug(
      `Current heap size ${currentMaxOldSpaceSizeMb.toFixed(2)} MB`,
    );
  }

  if (process.env['GEMINI_CLI_NO_RELAUNCH']) {
    return [];
  }

  if (targetMaxOldSpaceSizeInMB > currentMaxOldSpaceSizeMb) {
    if (config.getDebugMode()) {
      console.debug(
        `Need to relaunch with more memory: ${targetMaxOldSpaceSizeInMB.toFixed(2)} MB`,
      );
    }
    return [`--max-old-space-size=${targetMaxOldSpaceSizeInMB}`];
  }

  return [];
}

async function relaunchWithAdditionalArgs(additionalArgs: string[]) {
  const nodeArgs = [...additionalArgs, ...process.argv.slice(1)];
  const newEnv = { ...process.env, GEMINI_CLI_NO_RELAUNCH: 'true' };

  const child = spawn(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env: newEnv,
  });

  await new Promise((resolve) => child.on('close', resolve));
  process.exit(0);
}
import { runZedIntegration } from './zed-integration/zedIntegration.js';

export function setupUnhandledRejectionHandler() {
  let unhandledRejectionOccurred = false;
  process.on('unhandledRejection', (reason, _promise) => {
    const errorMessage = `=========================================
This is an unexpected error. Please file a bug report using the /bug tool.
CRITICAL: Unhandled Promise Rejection!
=========================================
Reason: ${reason}${
      reason instanceof Error && reason.stack
        ? `
Stack trace:
${reason.stack}`
        : ''
    }`;
    appEvents.emit(AppEvent.LogError, errorMessage);
    if (!unhandledRejectionOccurred) {
      unhandledRejectionOccurred = true;
      appEvents.emit(AppEvent.OpenDebugConsole);
    }
  });
}

export async function main() {
  setupUnhandledRejectionHandler();
  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);

  await cleanupCheckpoints();
  if (settings.errors.length > 0) {
    for (const error of settings.errors) {
      let errorMessage = `Error in ${error.path}: ${error.message}`;
      if (!process.env['NO_COLOR']) {
        errorMessage = `\x1b[31m${errorMessage}\x1b[0m`;
      }
      console.error(errorMessage);
      console.error(`Please fix ${error.path} and try again.`);
    }
    process.exit(1);
  }

  const argv = await parseArguments();
  
  if (argv.listPersonas) {
    const personas = await loadAllPersonas();
    if (personas.length === 0) {
      console.log('No personas found in project (`./personas`) or global (`~/.gemini/personas`) directories.');
      process.exit(0);
    }

    console.log('Available Personas:\n');
    // Group by source for better readability
    const grouped = personas.reduce((acc, p) => {
      acc[p.source] = acc[p.source] || [];
      acc[p.source].push(p);
      return acc;
    }, {} as Record<string, typeof personas>);

    for (const source of ['Project', 'Global']) {
      if (grouped[source]) {
        console.log(`--- ${source} Personas ---`);
        for (const p of grouped[source]) {
          const typeInfo = p.type === 'Auto-Detected' ? '(auto-detected)' : '';
          console.log(`  - ${p.id} ${typeInfo}`);
        }
        console.log('');
      }
    }
    process.exit(0);
  }
  
  const extensions = loadExtensions(workspaceRoot);
  const config = await loadCliConfig(
    settings.merged,
    extensions,
    sessionId,
    argv,
  );

  const consolePatcher = new ConsolePatcher({
    stderr: true,
    debugMode: config.getDebugMode(),
  });
  consolePatcher.patch();
  registerCleanup(consolePatcher.cleanup);

  dns.setDefaultResultOrder(
    validateDnsResolutionOrder(settings.merged.dnsResolutionOrder),
  );

  if (argv.promptInteractive && !process.stdin.isTTY) {
    console.error(
      'Error: The --prompt-interactive flag is not supported when piping input from stdin.',
    );
    process.exit(1);
  }

  if (config.getListExtensions()) {
    console.log('Installed extensions:');
    for (const extension of extensions) {
      console.log(`- ${extension.config.name}`);
    }
    process.exit(0);
  }

  // Set a default auth type if one isn't set.
  if (!settings.merged.selectedAuthType) {
    if (process.env['CLOUD_SHELL'] === 'true') {
      settings.setValue(
        SettingScope.User,
        'selectedAuthType',
        AuthType.CLOUD_SHELL,
      );
    }
  }

  setMaxSizedBoxDebugging(config.getDebugMode());

  await config.initialize(); // This initializes toolRegistry and promptRegistry

  // Initialize geminiClient if an auth type is already selected.
  // If no auth type is selected, useAuthCommand in App.tsx will handle it.
  if (settings.merged.selectedAuthType) {
    try {
      await config.refreshAuth(settings.merged.selectedAuthType);
    } catch (err) {
      console.error('Error during initial authentication:', err);
      // Do not exit here, let App.tsx handle the auth dialog
    }
  }

  if (config.getIdeMode()) {
    await config.getIdeClient().connect();
    logIdeConnection(config, new IdeConnectionEvent(IdeConnectionType.START));
  }

  // Load custom themes from settings
  themeManager.loadCustomThemes(settings.merged.customThemes);

  if (settings.merged.theme) {
    if (!themeManager.setActiveTheme(settings.merged.theme)) {
      // If the theme is not found during initial load, log a warning and continue.
      // The useThemeCommand hook in App.tsx will handle opening the dialog.
      console.warn(`Warning: Theme "${settings.merged.theme}" not found.`);
    }
  }

  // hop into sandbox if we are outside and sandboxing is enabled
  if (!process.env['SANDBOX']) {
    const memoryArgs = settings.merged.autoConfigureMaxOldSpaceSize
      ? getNodeMemoryArgs(config)
      : [];
    const sandboxConfig = config.getSandbox();
    if (sandboxConfig) {
      if (
        settings.merged.selectedAuthType &&
        !settings.merged.useExternalAuth
      ) {
        // Validate authentication here because the sandbox will interfere with the Oauth2 web redirect.
        try {
          const err = validateAuthMethod(settings.merged.selectedAuthType);
          if (err) {
            throw new Error(err);
          }
          await config.refreshAuth(settings.merged.selectedAuthType);
        } catch (err) {
          console.error('Error authenticating:', err);
          process.exit(1);
        }
      }
      await start_sandbox(sandboxConfig, memoryArgs, config);
      process.exit(0);
    } else {
      // Not in a sandbox and not entering one, so relaunch with additional
      // arguments to control memory usage if needed.
      if (memoryArgs.length > 0) {
        await relaunchWithAdditionalArgs(memoryArgs);
        process.exit(0);
      }
    }
  }

  if (
    settings.merged.selectedAuthType === AuthType.LOGIN_WITH_GOOGLE &&
    config.isBrowserLaunchSuppressed()
  ) {
    // Do oauth before app renders to make copying the link possible.
    await getOauthClient(settings.merged.selectedAuthType, config);
  }

  if (config.getExperimentalZedIntegration()) {
    return runZedIntegration(config, settings, extensions, argv);
  }

  let input = config.getQuestion();
  const startupWarnings = [
    ...(await getStartupWarnings()),
    ...(await getUserStartupWarnings(workspaceRoot)),
  ];

  if (argv.chatList) {
    // We need to pass a CommandContext-like object to getSavedChatTags.
    // For simplicity, we're creating a minimal one with just the config service.
    // A more robust solution might involve refactoring getSavedChatTags to accept
    // a more generic config object, or creating a proper context builder.
    const chatDetails = await getSavedChatTags(
      { services: { config } } as any,
      false,
    );
    if (chatDetails.length === 0) {
      console.log('No saved conversation checkpoints found.');
    } else {
      const maxNameLength = Math.max(
        ...chatDetails.map((chat) => chat.name.length),
      );

      let message = 'List of saved conversations:\n\n';
      for (const chat of chatDetails) {
        const paddedName = chat.name.padEnd(maxNameLength, ' ');
        const isoString = chat.mtime.toISOString();
        const match = isoString.match(
          /(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/,
        );
        const formattedDate = match
          ? `${match[1]} ${match[2]}`
          : 'Invalid Date';
        message += `  - \u001b[36m${paddedName}\u001b[0m  \u001b[90m(saved on ${formattedDate})\u001b[0m\n`;
      }
      message += `\n\u001b[90mNote: Newest last, oldest first\u001b[0m`;
      console.log(message);
    }
    process.exit(0);
  }


  // Render UI, passing necessary config values. Check that there is no command line question.
  if (config.isInteractive()) {
    const version = await getCliVersion();
    // Detect and enable Kitty keyboard protocol once at startup
    await detectAndEnableKittyProtocol();
    setWindowTitle(basename(workspaceRoot), settings);
    const instance = render(
      <React.StrictMode>
        <SettingsContext.Provider value={settings}>
          <AppWrapper
            config={config}
            settings={settings}
            startupWarnings={startupWarnings}
            version={version}
            noSelfIntroduce={argv.noSelfIntroduce}
            workspaceRoot={workspaceRoot}
          />
        </SettingsContext.Provider>
      </React.StrictMode>,
      { exitOnCtrlC: false },
    );

    checkForUpdates()
      .then((info) => {
        handleAutoUpdate(info, settings, config.getProjectRoot());
      })
      .catch((err) => {
        // Silently ignore update check errors.
        if (config.getDebugMode()) {
          console.error('Update check failed:', err);
        }
      });

    registerCleanup(() => instance.unmount());
    return;
  }
  // If not a TTY, read from stdin
  // This is for cases where the user pipes input directly into the command
  if (!process.stdin.isTTY) {
    const stdinData = await readStdin();
    if (stdinData) {
      input = `${stdinData}\n\n${input}`;
    }
  }
  if (!input) {
    console.error('No input provided via stdin.');
    process.exit(1);
  }

  const prompt_id = Math.random().toString(16).slice(2);
  logUserPrompt(config, {
    'event.name': 'user_prompt',
    'event.timestamp': new Date().toISOString(),
    prompt: input,
    prompt_id,
    auth_type: config.getContentGeneratorConfig()?.authType,
    prompt_length: input.length,
  });

  const nonInteractiveConfig = await validateNonInteractiveAuth(
    settings.merged.selectedAuthType,
    settings.merged.useExternalAuth,
    config,
  );

  await runNonInteractive(nonInteractiveConfig, input, prompt_id);
  process.exit(0);
}

function setWindowTitle(title: string, settings: LoadedSettings) {
  if (!settings.merged.hideWindowTitle) {
    const windowTitle = (
      process.env['CLI_TITLE'] || `Gemini - ${title}`
    ).replace(
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1F\x7F]/g,
      '',
    );
    process.stdout.write(`\x1b]2;${windowTitle}\x07`);

    process.on('exit', () => {
      process.stdout.write(`\x1b]2;\x07`);
    });
  }
}
