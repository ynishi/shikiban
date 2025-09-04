import maiYui from './mai-yui.js';
import alexJordan from './alex-jordan.js';

// Define a type for a persona configuration for better type safety.
// This is based on the structure of the objects in the individual files.
export interface Persona {
  name: string;
  emoji: string;
  title: string;
  role: string;
  description: string;
  style: string;
  responsibilities: string;
}

export interface PersonaPairConfig {
  personaA: Persona;
  personaB: Persona;
}

// Create a map of available persona configurations.
// The key is the identifier we'll use for the --persona flag.
export const personaRegistry: Record<string, PersonaPairConfig> = {
  'mai-yui': maiYui,
  'alex-jordan': alexJordan,
};

// Optional: export a function to get a persona config by name.
export function getPersonaConfig(name: string): PersonaPairConfig | undefined {
  return personaRegistry[name];
}
