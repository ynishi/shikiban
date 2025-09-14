/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GenerateContentResponse, Content } from '@google/genai';
import { MessageType } from '../types.js';
import { CommandKind, SlashCommand } from './types.js';

// Simplified local implementation to avoid brittle deep imports
function getLocalResponseText(
  response: GenerateContentResponse,
): string | undefined {
  if (!response.candidates || response.candidates.length === 0) {
    return undefined;
  }
  const candidate = response.candidates[0];
  if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
    return undefined;
  }
  return candidate.content.parts.map((part) => part.text).join('');
}

export const talkCommand: SlashCommand = {
  name: 'talk',
  altNames: ['t'],
  description: 'Expands a short prompt into a full one and submits it.',
  kind: CommandKind.BUILT_IN,
  async action(context, args) {
    let expandedContent = args;

    // Define the default meta prompt
    const defaultMetaPrompt = `You are a helpful assistant that expands shorthand requests into clear, actionable prompts. Do not add any conversational fluff or markdown. Just provide the expanded prompt. Expand the following user request: "{ARGS}"`;

    // Check for a custom meta prompt in settings, safely accessing it.
    const customMetaPrompt = (context.services.settings.merged as any)
      ?.talkCommand?.metaPrompt;

    // Use the custom prompt if it exists, otherwise use the default. Replace {ARGS} placeholder.
    const metaPrompt = (customMetaPrompt || defaultMetaPrompt).replace(
      '{ARGS}',
      args,
    );

    try {
      const geminiClient = context.services.config?.getGeminiClient();
      if (geminiClient) {
        const contents: Content[] = [
          { role: 'user', parts: [{ text: metaPrompt }] },
        ];
        const abortController = new AbortController();

        const result = await geminiClient.generateContent(
          contents,
          {},
          abortController.signal,
        );

        const newContent = getLocalResponseText(result);
        if (newContent) {
          expandedContent = newContent.trim();
        }
      }
    } catch (e) {
      context.ui.setDebugMessage(`Error during /talk expansion: ${e}`);
    }

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `[Talk] Prompt: "${expandedContent}"`,
      },
      Date.now(),
    );

    return {
      type: 'submit_prompt',
      content: expandedContent,
    };
  },
};
