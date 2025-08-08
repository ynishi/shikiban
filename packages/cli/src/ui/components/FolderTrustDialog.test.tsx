/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { vi } from 'vitest';
import { FolderTrustDialog, FolderTrustChoice } from './FolderTrustDialog.js';

describe('FolderTrustDialog', () => {
  it('should render the dialog with title and description', () => {
    const { lastFrame } = render(<FolderTrustDialog onSelect={vi.fn()} />);

    expect(lastFrame()).toContain('Do you trust this folder?');
    expect(lastFrame()).toContain(
      'Trusting a folder allows Gemini to execute commands it suggests.',
    );
  });

  it('should call onSelect with DO_NOT_TRUST when escape is pressed', () => {
    const onSelect = vi.fn();
    const { stdin } = render(<FolderTrustDialog onSelect={onSelect} />);

    stdin.write('\u001B'); // Simulate escape key

    expect(onSelect).toHaveBeenCalledWith(FolderTrustChoice.DO_NOT_TRUST);
  });
});
