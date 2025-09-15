/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, execSync } from 'child_process';

// Note: This is a fire-and-forget function. It should not block the main flow.
export function runWorkflowObserver() {
  console.log('Running workflow observer...');
  // We spawn the observer as a detached process to avoid blocking the main CLI flow.
  const subprocess = spawn(process.execPath, [__filename, 'child'], {
    detached: true,
    stdio: 'ignore',
  });
  subprocess.unref();
}

async function observerMain() {
  console.log('💖 Chat Fairy checking your work...');

  const gitContext = getGitContext();
  if (!gitContext) {
    console.log('💖 Looks clean! Nothing to suggest right now.');
    return;
  }

  const prompt = createPrompt(gitContext.status, gitContext.diff);

  try {
    const suggestion = await getAISuggestions(prompt);

    if (suggestion.should_suggest_commit) {
      // A more visible and friendly output format
      console.log("\n\n========================================================");
      console.log("💖 A little fairy whispers in your ear... 💖");
      console.log("========================================================");
      console.log(`✨ Reason: \"${suggestion.suggestion_reason}\"`);
      console.log(`✨ Suggestion: Now might be a good time to commit your changes!`);
      console.log(`✨ Next Step: \"${suggestion.next_step_suggestion}\"`);
      console.log("========================================================\n");
    } else {
      console.log('💖 Looks like you are in the middle of something! Keep up the great work!');
    }
  } catch (error) {
    console.error('Chat Fairy encountered an error:', (error as Error).message);
  }
}


// Child process logic
if (process.argv[2] === 'child') {
  observerMain();
}


function getGitContext(): { status: string; diff: string } | null {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' });
    if (!status.trim()) {
      return null;
    }
    const diff = execSync('git diff HEAD --stat', { encoding: 'utf-8' });
    return { status, diff };
  } catch (error) {
    // Not a git repo or git is not installed, just ignore.
    return null;
  }
}

function createPrompt(status: string, diff: string): string {
  return `
You are a senior engineer acting as a pair programming assistant.
A coding session has just finished, and the repository is in the following state.

# Modified Files (from git status):
\`\`\`
${status}
\`\`\`

# Change Summary (from git diff --stat):
\`\`\`
${diff}
\`\`\`

# Task
Based on these changes, should a "git commit" be suggested now?
Also, suggest a logical next step for the developer.
Respond with ONLY a JSON object in the following format, with no other text or explanations.

{
  "should_suggest_commit": boolean,
  "suggestion_reason": "A brief reason for your decision.",
  "next_step_suggestion": "A concise suggestion for the next action (e.g., 'Run tests to verify changes.')."
}
`;
}

async function getAISuggestions(prompt: string): Promise<any> {
  // TODO: Implement AI suggestion logic
  // This is a placeholder that should integrate with your AI service
  return {
    should_suggest_commit: false,
    suggestion_reason: "Feature not yet implemented",
    next_step_suggestion: "Continue development"
  };
} 