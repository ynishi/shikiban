# Shikiban Server Integration

This document describes the integration between the Shikiban CLI and the Shikiban Server for session history tracking.

## Overview

The Shikiban CLI now supports sending session history to a Shikiban Server instance. This allows for centralized storage and analysis of CLI sessions.

## Configuration

To enable Shikiban Server integration, set the following environment variables:

```bash
export SHIKIBAN_SERVER_URL=http://localhost:8080  # Your Shikiban Server URL
export SHIKIBAN_API_KEY=your-api-key-here         # Your API key for authentication
```

## How It Works

1. **Session Creation**: When a user starts a new CLI session, the system automatically creates a new session on the Shikiban Server.

2. **Turn Logging**: Each user message (turn) is automatically sent to the Shikiban Server with:
   - Role (currently only "user" messages are logged)
   - Content (the user's message)
   - Timestamp
   - Metadata (including the local session ID)

3. **Error Handling**: If the Shikiban Server is not configured or unavailable:
   - The CLI continues to work normally
   - Session history is still saved locally
   - Warning messages are logged to the console

## Implementation Details

### New Components

1. **ShikibanTool** (`packages/core/src/tools/shikiban-tool.ts`):
   - A tool that handles communication with the Shikiban Server
   - Supports `create_session` and `create_turn` actions
   - Extends the standard BaseTool interface

2. **ShikibanSessionManager**:
   - A singleton manager that handles session lifecycle
   - Ensures a session exists before logging turns
   - Provides error handling and retry logic

3. **Logger Integration** (`packages/core/src/core/logger.ts`):
   - The existing Logger class now integrates with ShikibanSessionManager
   - Automatically sends user messages to Shikiban Server when configured

### API Endpoints Used

- `POST /api/v1/sessions` - Creates a new session
- `POST /api/v1/sessions/{sessionId}/turns` - Adds a turn to a session

All requests include the `X-Shikiban-API-Key` header for authentication.

## Testing

A test script is provided at `test-shikiban-integration.ts`. To run it:

```bash
# Build the core package
cd packages/core
npm run build

# Set environment variables
export SHIKIBAN_SERVER_URL=http://localhost:8080
export SHIKIBAN_API_KEY=your-api-key

# Run the test
cd ../..
node test-shikiban-integration.js
```

## Future Enhancements

- Log AI responses in addition to user messages
- Include tool usage information in turn metadata
- Support for session restoration from Shikiban Server
- Batch turn logging for improved performance
- Support for custom metadata fields