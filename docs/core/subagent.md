# SubAgent Feature Overview

We investigated the newly added "SubAgent" feature in Shikiban, focusing on `packages/core/src/core/subagent.ts` and `packages/core/src/core/subagent.test.ts`.

## 1. SubAgent Definition and Purpose

A SubAgent is a goal-oriented AI agent designed to execute specific subtasks non-interactively and return their results to a parent agent.
It serves as the foundation for a hierarchical agent architecture, where the main `GeminiAgent` (CLI) can decompose complex tasks and delegate parts of them to SubAgents, enabling more efficient and autonomous processing.

## 2. Key Characteristics

*   **Non-Interactive:** It does not request input or confirmation from the user. Tools that a SubAgent can use are limited to those that do not require user confirmation.
*   **Goal-Oriented:** It aims to achieve predefined goals and generate specific output variables (configured via `OutputConfig`).
*   **Constrained Execution:** It operates under constraints such as maximum execution time (`max_time_minutes`) and maximum conversational turns (`max_turns`) to prevent infinite loops or excessive resource consumption.
*   **Tool Utilization:** It uses tools provided by the `ToolRegistry` to perform its tasks. It also has an internal tool, `self.emitvalue`, to communicate results back to the parent agent.

## 3. Execution Model and Asynchronicity

From the perspective of the main CLI, the execution of a SubAgent is **blocking (synchronous)**, similar to the `claude_code` tool. The main CLI will not accept the next command until the SubAgent completes its internal multi-turn process.

However, via the `ACP` (Agent Communication Protocol), the main `GeminiAgent` can **asynchronously report the progress** of long-running tasks like SubAgents to the GUI client. This means that while the user cannot simultaneously enter new commands into the CLI, they can receive richer feedback through the GUI.

## 4. Autonomy and Human Consultation

A SubAgent operates with a high degree of autonomy within its defined goals and constraints.
However, direct consultation or interaction with a human is **explicitly prohibited**. If a SubAgent encounters a situation requiring human intervention, it will terminate due to an error or limit, and its parent, the main `GeminiAgent`, will interpret the situation and, if necessary, provide information to the user or request confirmation.

## 5. Documentation Status

Currently, no direct documentation for SubAgent was found in the `docs` directory. This suggests that the feature might still be under development or is considered an internal implementation detail rather than a user-facing feature.
