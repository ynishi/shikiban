/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GenerateContentResponse, Part, FunctionCall } from '@google/genai';

export function getResponseText(
  response: GenerateContentResponse,
): string | undefined {
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    return undefined;
  }
  const textSegments = parts
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string');

  if (textSegments.length === 0) {
    return undefined;
  }
  return textSegments.join('');
}

export function getResponseTextFromParts(parts: Part[]): string | undefined {
  if (!parts) {
    return undefined;
  }
  const textSegments = parts
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string');

  if (textSegments.length === 0) {
    return undefined;
  }
  return textSegments.join('');
}

export function getFunctionCalls(
  response: GenerateContentResponse,
): FunctionCall[] | undefined {
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    return undefined;
  }
  const functionCallParts = parts
    .filter((part) => !!part.functionCall)
    .map((part) => part.functionCall as FunctionCall);
  return functionCallParts.length > 0 ? functionCallParts : undefined;
}

export function getFunctionCallsFromParts(
  parts: Part[],
): FunctionCall[] | undefined {
  if (!parts) {
    return undefined;
  }
  const functionCallParts = parts
    .filter((part) => !!part.functionCall)
    .map((part) => part.functionCall as FunctionCall);
  return functionCallParts.length > 0 ? functionCallParts : undefined;
}

export function getFunctionCallsAsJson(
  response: GenerateContentResponse,
): string | undefined {
  const functionCalls = getFunctionCalls(response);
  if (!functionCalls) {
    return undefined;
  }
  return JSON.stringify(functionCalls, null, 2);
}

export function getFunctionCallsFromPartsAsJson(
  parts: Part[],
): string | undefined {
  const functionCalls = getFunctionCallsFromParts(parts);
  if (!functionCalls) {
    return undefined;
  }
  return JSON.stringify(functionCalls, null, 2);
}

export function getStructuredResponse(
  response: GenerateContentResponse,
): string | undefined {
  const textContent = getResponseText(response);
  const functionCallsJson = getFunctionCallsAsJson(response);

  if (textContent && functionCallsJson) {
    return `${textContent}\n${functionCallsJson}`;
  }
  if (textContent) {
    return textContent;
  }
  if (functionCallsJson) {
    return functionCallsJson;
  }
  return undefined;
}
export function extractTextAndErrorFromResponse(  response: GenerateContentResponse,): { text: string | undefined; errorText: string | undefined } {  const fullText = getResponseText(response);  if (!fullText) {    return { text: undefined, errorText: undefined };  }  const errorMatch = fullText.match(/<ERROR>(.*?)<\/ERROR>/s);  const errorText = errorMatch ? errorMatch[1].trim() : undefined;  const textWithoutError = fullText.replace(/<ERROR>.*?<\/ERROR>/s, '').trim();  return {    text: textWithoutError === '' ? undefined : textWithoutError,    errorText,  };}


export function getStructuredResponseFromParts(  parts: Part[],): string | undefined {  const textContent = getResponseTextFromParts(parts);  const functionCallsJson = getFunctionCallsFromPartsAsJson(parts);  if (textContent && functionCallsJson) {    return `${textContent}
${functionCallsJson}`;  }  if (textContent) {    return textContent;  }  if (functionCallsJson) {    return functionCallsJson;  }  return undefined;}
