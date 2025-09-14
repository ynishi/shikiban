/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  executeToolCall,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  ToolErrorType,
  AuthType,
  FlashFallbackEvent,
  logFlashFallback,
  DEFAULT_GEMINI_FLASH_MODEL,
  isProQuotaExceededError,
  isGenericQuotaExceededError,
  UserTierId,
  parseAndFormatApiError,
} from '@google/gemini-cli-core';
import { Content, Part, FunctionCall } from '@google/genai';

import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
): Promise<void> {
  const consolePatcher = new ConsolePatcher({
    stderr: true,
    debugMode: config.getDebugMode(),
  });

  let modelSwitchedAndNeedsRetry = false;

  const nonInteractiveFlashFallbackHandler = async (
    currentModel: string,
    fallbackModel: string,
    error?: unknown,
  ): Promise<boolean> => {
    let message: string;

    if (
      config.getContentGeneratorConfig().authType ===
      AuthType.LOGIN_WITH_GOOGLE
    ) {
      const isPaidTier = false;

      if (error && isProQuotaExceededError(error)) {
        message = `⚡ You have reached your daily ${currentModel} quota limit. Automatically switching from ${currentModel} to ${fallbackModel} for the remainder of this session.`;
      } else if (error && isGenericQuotaExceededError(error)) {
        message = `⚡ You have reached your daily quota limit. Automatically switching from ${currentModel} to ${fallbackModel} for the remainder of this session.`;
      } else {
        message = `⚡ Automatically switching from ${currentModel} to ${fallbackModel} for faster responses for the remainder of this session. Possible reasons for this are that you have received multiple consecutive capacity errors or you have reached your daily ${currentModel} quota limit.`;
      }

      console.error(message);
      modelSwitchedAndNeedsRetry = true;
    }

    config.setModel(fallbackModel);
    config.setFallbackMode(true);
    logFlashFallback(
      config,
      new FlashFallbackEvent(config.getContentGeneratorConfig().authType!),
    );
    return false;
  };

  config.setFlashFallbackHandler(nonInteractiveFlashFallbackHandler);

  try {
    consolePatcher.patch();
    // Handle EPIPE errors when the output is piped to a command that closes early.
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Exit gracefully if the pipe is closed.
        process.exit(0);
      }
    });

    const geminiClient = config.getGeminiClient();

    const abortController = new AbortController();
    let currentMessages: Content[] = [
      { role: 'user', parts: [{ text: input }] },
    ];
    let turnCount = 0;
    while (true) {
      turnCount++;

      if (modelSwitchedAndNeedsRetry) {
        console.error('モデルが切り替わりました。プロンプトを再送信します...');
        modelSwitchedAndNeedsRetry = false;
        config.setQuotaErrorOccurred(false);
        currentMessages = [{ role: 'user', parts: [{ text: input }] }];
        turnCount = 1;
      }

      if (
        config.getMaxSessionTurns() >= 0 &&
        turnCount > config.getMaxSessionTurns()
      ) {
        console.error(
          '\n Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
        );
        return;
      }
      const functionCalls: FunctionCall[] = [];

      const responseStream = geminiClient.sendMessageStream(
        currentMessages[0]?.parts || [],
        abortController.signal,
        prompt_id,
      );

      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        if (event.type === GeminiEventType.Content) {
          process.stdout.write(event.value);
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          const toolCallRequest = event.value;
          const fc: FunctionCall = {
            name: toolCallRequest.name,
            args: toolCallRequest.args,
            id: toolCallRequest.callId,
          };
          functionCalls.push(fc);
        }
      }

      if (functionCalls.length > 0) {
        const toolResponseParts: Part[] = [];

        for (const fc of functionCalls) {
          const callId = fc.id ?? `${fc.name}-${Date.now()}`;
          const requestInfo: ToolCallRequestInfo = {
            callId,
            name: fc.name as string,
            args: (fc.args ?? {}) as Record<string, unknown>,
            isClientInitiated: false,
            prompt_id,
          };

          const toolResponse = await executeToolCall(
            config,
            requestInfo,
            abortController.signal,
          );

          if (toolResponse.error) {
            console.error(
              `Error executing tool ${fc.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
            );
          }

          if (toolResponse.responseParts) {
            const parts = Array.isArray(toolResponse.responseParts)
              ? toolResponse.responseParts
              : [toolResponse.responseParts];
            for (const part of parts) {
              if (typeof part === 'string') {
                toolResponseParts.push({ text: part });
              } else if (part) {
                toolResponseParts.push(part);
              }
            }
          }
        }
        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        process.stdout.write('\n'); // Ensure a final newline
        return;
      }
    }
  } catch (error) {
    console.error(
      parseAndFormatApiError(
        error,
        config.getContentGeneratorConfig()?.authType,
      ),
    );
    process.exit(1);
  } finally {
    consolePatcher.cleanup();
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }
  }
}
