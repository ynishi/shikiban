/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

export interface Persona {
  id: string;
  name: string;
  file: string;
  source: 'Project' | 'Global';
  type: 'Manifest' | 'Auto-Detected';
  // Allow any other properties from the JSON file
  [key: string]: any;
}

interface Manifest {
  personas: Array<{
    id: string;
    name: string;
    file: string;
  }>;
}

const MANIFEST_FILE = 'manifest.json';

async function findPersonasInDir(dir: string, source: 'Project' | 'Global'): Promise<Map<string, Persona>> {
  const personas = new Map<string, Persona>();
  const manifestPath = path.join(dir, MANIFEST_FILE);

  // 1. Read from manifest first
  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent) as Manifest;
    for (const entry of manifest.personas) {
      personas.set(entry.id, {
        ...entry,
        source,
        type: 'Manifest',
      });
    }
  } catch (error) {
    // Manifest not found or invalid, proceed to auto-detection.
  }

  // 2. Auto-detect other JSON files
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith('.json') && file !== MANIFEST_FILE) {
        const id = path.basename(file, '.json');
        // Only add if not already defined in manifest (manifest takes precedence)
        if (!personas.has(id)) {
          personas.set(id, {
            id,
            name: id, // Use ID as name by default for auto-detected files
            file,
            source,
            type: 'Auto-Detected',
          });
        }
      }
    }
  } catch (error) {
    // Directory might not exist, which is fine.
  }

  return personas;
}

export async function loadAllPersonas(): Promise<Persona[]> {
  const projectPersonaDir = path.join(process.cwd(), 'personas');
  const globalPersonaDir = path.join(homedir(), '.gemini', 'personas');

  const projectPersonas = await findPersonasInDir(projectPersonaDir, 'Project');
  const globalPersonas = await findPersonasInDir(globalPersonaDir, 'Global');

  // Merge maps. Project personas overwrite global ones with the same ID.
  const allPersonas = new Map([...globalPersonas, ...projectPersonas]);

  return Array.from(allPersonas.values());
}

export async function getPersonaById(id: string): Promise<any | null> {
  const personas = await loadAllPersonas();
  const personaInfo = personas.find(p => p.id === id);

  if (!personaInfo) {
    return null;
  }

  const personaDir = personaInfo.source === 'Project'
    ? path.join(process.cwd(), 'personas')
    : path.join(homedir(), '.gemini', 'personas');
  
  const filePath = path.join(personaDir, personaInfo.file);

  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error(`Error loading persona file for ID "${id}" at ${filePath}:`, error);
    return null;
  }
}
