/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { countOccurrences } from '../utils/editCorrector.js';

/**
 * Manages all numerical metrics and logic related to text replacements.
 * This class encapsulates the total occurrences, expected replacements,
 * target index, and the actual number of replacements to be performed.
 */
export class ReplacementMetrics {
  readonly totalMatchesInFile: number;
  readonly expectedReplacementsParam: number | undefined;
  readonly targetOccurrenceIndexParam: number | undefined;
  readonly actualReplacementsCount: number;
  readonly isValidTargetIndex: boolean;
  readonly isMultipleMatchesForSingleExpected: boolean;

  constructor(
    fileContent: string,
    oldString: string,
    expectedReplacements?: number,
    targetOccurrenceIndex?: number,
  ) {
    this.totalMatchesInFile = countOccurrences(fileContent, oldString);
    this.expectedReplacementsParam = expectedReplacements;
    this.targetOccurrenceIndexParam = targetOccurrenceIndex;

    // Determine if the targetOccurrenceIndex is valid
    this.isValidTargetIndex =
      targetOccurrenceIndex === undefined ||
      (targetOccurrenceIndex >= 0 &&
        targetOccurrenceIndex < this.totalMatchesInFile);

    // Calculate the actual number of replacements that will be performed
    if (targetOccurrenceIndex !== undefined && this.isValidTargetIndex) {
      this.actualReplacementsCount = 1; // If a specific index is targeted and valid, only 1 replacement is made.
    } else if (expectedReplacements !== undefined) {
      this.actualReplacementsCount = expectedReplacements; // If expected_replacements is specified, use that.
    } else {
      this.actualReplacementsCount = this.totalMatchesInFile; // Default: replace all occurrences found.
    }

    // Flag for the specific error case: expected 1 replacement but found multiple
    this.isMultipleMatchesForSingleExpected =
      (expectedReplacements === undefined || expectedReplacements === 1) &&
      this.totalMatchesInFile > 1 &&
      targetOccurrenceIndex === undefined;
  }

  /**
   * Generates the error message for the case where expected_replacements is 1
   * but multiple matches are found, providing solution hints.
   */
  getErrorMessageForMultipleMatches(): string {
    return `Multiple matches found. The specified \`old_string\` matched ${this.totalMatchesInFile} locations in the file, but \`expected_replacements\` is set to 1.\nSolution Hints:\n- If you intend to replace only a single occurrence, make the \`old_string\` more specific (e.g., include surrounding lines) to uniquely identify it.\n- If you intend to replace all matching occurrences, set the \`expected_replacements\` parameter to the number of matches (${this.totalMatchesInFile}).\n- If you wish to replace with some tolerance for minor formatting differences, consider using the \`intelligent_replace\` tool.\n- To replace a specific occurrence, use the \`target_occurrence_index\` parameter (0-based).`;
  }

  /**
   * Generates the error message for when target_occurrence_index is out of bounds.
   */
  getErrorMessageForTargetIndexOutOfBounds(): string {
    return `Target occurrence index ${this.targetOccurrenceIndexParam} is out of bounds. Found ${this.totalMatchesInFile} occurrences.`;
  }

  /**
   * Generates the error message for when actual replacements do not match expected replacements.
   */
  getErrorMessageForMismatch(): string {
    const occurrenceTerm =
      this.expectedReplacementsParam === 1 ? 'occurrence' : 'occurrences';
    return `Failed to edit, expected ${this.expectedReplacementsParam} ${occurrenceTerm} but found ${this.actualReplacementsCount}.`;
  }
}
