# Claude Code Tool (`claude_code`)

The `claude_code` tool executes a prompt using the Claude Code CLI to perform complex code analysis, generation, and manipulation.

## Parameters

### `prompt` (string, required)

The `prompt` argument is a string that describes the specific task or instruction you want the Claude Code CLI to execute. This is how you communicate the objective that the Claude Code CLI should achieve, leveraging its internal tools (e.g., Bash, Read, Write, etc.).

**Nature of Content:**

*   **Instructions and Tasks:** The prompt should contain concrete commands for the Claude Code CLI, such as "Fix the bug in this file," "Refactor this module," or "Generate tests for this feature."
*   **Context Provision:** If necessary, include additional context required for the task (e.g., "This code is part of the authentication logic," "This function processes user input").
*   **File Path References:** If you want operations to be performed on specific files or directories, refer to their file paths within the `prompt` (e.g., "Optimize the `calculateSum` function in `src/utils/helper.ts`").

**Important Notes (to avoid misunderstanding):**

*   **Not Direct File Content:** You do not directly paste file content into the prompt argument. The Claude Code CLI will, based on the instructions given in the prompt, read relevant files itself using its Read tool or Bash tool (e.g., `cat` command) if necessary.
*   **Instruction for Claude Code CLI:** It functions purely as an "instruction manual" for Claude Code CLI, which is another AI agent.

**Good `prompt` examples:**

*   "Fix the memory leak in 'src/data_processor.ts' related to the 'cache' object. Focus on lines 120-150."
*   "Refactor the 'UserAuthService' class in 'packages/cli/src/services/auth.ts' to use functional components instead of classes, following the guidelines in GEMINI.md."
*   "Generate comprehensive unit tests for the 'parseInput' function in 'src/parser/input.ts'. Ensure edge cases like empty strings and invalid characters are covered."

**Bad `prompt` examples (cases attempting to pass file content directly to `prompt`):**

*   "Here is the file content: `function processData(...) { ... }`. Fix the bug."
    *   **Reason:** The Claude Code CLI will not recognize this string as file content; it will interpret it as merely part of a long instruction. If file content needs to be read, you should specify the file path in the prompt and let the Claude Code CLI read it itself.

### `timeout` (number, optional)

Optional timeout in milliseconds (default: 1200000ms, 20 minutes).
