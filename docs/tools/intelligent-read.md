# Intelligent Read Tool

## Overview
The `intelligent-read` tool provides a more flexible and intelligent way to read file content compared to the standard `read_file` tool. It aims to enhance the AI's ability to locate and read files by accepting partial paths, relative paths, or just file names, and intelligently resolving them to an absolute path.

## Purpose
To allow the AI to read file content without requiring a precise absolute path, reducing the need for explicit path resolution steps by the AI. This tool is designed to be AI-friendly, prioritizing common project structures.

## Behavior and Logic

When the `intelligent-read` tool is invoked with a file path hint, it performs the following steps to identify and read the file(s):

1.  **Input**: The tool accepts a `path_hint` (string) which can be:
    *   An absolute path (e.g., `/Users/user/project/src/file.ts`)
    *   A relative path from the project's absolute root directory (e.g., `src/file.ts`)
    *   A relative path from the current working directory (e.g., `../file.ts`)
    *   A partial file name (e.g., `file.ts`, `gemini.tsx`)

2.  **Path Resolution Priority**: The tool attempts to resolve the `path_hint` to an absolute file path using the following priority:
    *   **Project Root Relative**: First, it checks if the `path_hint` exists as a relative path when joined with the project's absolute root directory: `/Users/yutakanishimura/projects/gemini-cli/`.
    *   **Current Working Directory Relative**: If not found, it then checks if the `path_hint` exists as a relative path when joined with the current working directory: `/Users/yutakanishimura/projects/gemini-cli/`.
    *   **Global Glob Search**: If still not found, or if the `path_hint` is clearly a partial name (e.g., `gemini.tsx`), it performs a global search across the entire project, starting from the project's absolute root directory, using a glob pattern (e.g., `**/<path_hint>`).

3.  **Result Handling**:

    *   **Single File Found**:
        *   If exactly one file is identified through any of the above resolution steps, the tool reads the **entire content** of that file using the `read_file` tool.
        *   The content of the file is **not** directly displayed to the user. The tool's output will indicate success and any relevant metadata from the `read_file` operation.

    *   **Multiple Files Found (during Global Glob Search)**:
        *   If the global glob search yields multiple matching files, the tool prioritizes them by modification time (newest first, as returned by `glob`).
        *   It then reads the **first 20 lines** of the **top 10** most recently modified files using the `read_file` tool (with `limit=20`).
        *   The output to the user will be formatted as follows, clearly indicating the file path for each snippet:
            ```
            複数のファイルが見つかりました。上位10件のファイルの先頭20行を表示します:

            --- /path/to/file1.ts ---
            1行目
            2行目
            ...
            20行目

            --- /path/to/file2.ts ---
            1行目
            2行目
            ...
            20行目
            ...
            ```

    *   **No File Found**:
        *   If no file can be identified after all resolution attempts, the tool will inform the user that the file could not be found.

## Internal Implementation Notes
This tool will internally leverage existing tools such as `glob` and `read_file` to achieve its functionality. It will encapsulate the complex path resolution and multi-file handling logic, presenting a simplified interface for the AI.
