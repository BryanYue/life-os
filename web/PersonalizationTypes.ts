import type { LanguageDefinition } from "../src/languages.js";

export type PersonalProfile = {
  profileVersion: 1;
  revision: number;
  modules: Record<string, boolean>;
  languagePreferences: {
    activeCodes: string[];
    customLanguages?: LanguageDefinition[];
  };
  navigation: {
    order: string[];
    labels: Record<string, string>;
    moduleCategories: Record<string, string>;
  };
  templatePreferences: { enabledIds: string[] };
  history: { includeDisabled: boolean };
};

export type CategoryRegistry = {
  categories: { id: string; label: string; moduleIds: string[] }[];
  unassignedModuleIds: string[];
};

export type LanguageUpgrade = {
  module: string;
  name: string;
  fromSchema: number;
  toSchema: number;
  compatible: boolean;
  reason?: string;
};

export type LanguageSettings = {
  catalog: LanguageDefinition[];
  pending: LanguageUpgrade[];
};

export type ProfilePatch = {
  languagePreferences?: Partial<PersonalProfile["languagePreferences"]>;
  navigation?: Partial<PersonalProfile["navigation"]>;
  templatePreferences?: Partial<PersonalProfile["templatePreferences"]>;
  history?: Partial<PersonalProfile["history"]>;
};
