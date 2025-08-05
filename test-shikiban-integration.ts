/**
 * Test script for Shikiban integration
 * 
 * Usage:
 * 1. Set environment variables:
 *    export SHIKIBAN_SERVER_URL=http://localhost:8080
 *    export SHIKIBAN_API_KEY=your-api-key
 * 
 * 2. Build the core package:
 *    cd packages/core
 *    npm run build
 * 
 * 3. Run the test:
 *    cd ../..
 *    npx tsx test-shikiban-integration.ts
 */

import { ShikibanSessionManager } from './packages/core/dist/tools/shikiban-tool.js';

async function testShikibanIntegration() {
  console.log('Testing Shikiban integration...\n');

  const manager = ShikibanSessionManager.getInstance();

  // Test session creation
  console.log('1. Creating session...');
  const sessionId = await manager.ensureSession();
  
  if (sessionId) {
    console.log(`   ✓ Session created: ${sessionId}`);
  } else {
    console.log('   ✗ Failed to create session (check environment variables)');
    return;
  }

  // Test turn logging
  console.log('\n2. Logging a test turn...');
  try {
    await manager.logTurn({
      role: 'user',
      content: 'Test message from Shikiban integration',
      timestamp: new Date().toISOString(),
      metadata: {
        test: true,
        source: 'test-script'
      }
    });
    console.log('   ✓ Turn logged successfully');
  } catch (error) {
    console.log('   ✗ Failed to log turn:', error);
  }

  console.log('\nTest complete!');
}

testShikibanIntegration().catch(console.error);