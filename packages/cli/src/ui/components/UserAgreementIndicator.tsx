/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';

interface UserAgreementIndicatorProps {
  message: string;
}

export const UserAgreementIndicator: React.FC<UserAgreementIndicatorProps> = ({
  message,
}) => (
  <Box flexDirection="column" marginTop={1} marginBottom={1}>
    <Box borderStyle="round" borderColor={Colors.AccentYellow} paddingX={1}>
      <Text color={Colors.AccentYellow} bold>
        🛑 Awaiting your agreement - {message}
      </Text>
    </Box>
    <Box marginTop={1} paddingX={1}>
      <Text color={Colors.Gray} dimColor>
        → Please respond to continue (Ctrl+Y to toggle YOLO mode)
      </Text>
    </Box>
  </Box>
);
