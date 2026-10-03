import React from "react";
import type { Module } from "../src/types.js";
import {
  LANGUAGE_CATALOG,
  languageLabel,
  languageOptions,
  normalizeLanguage,
  type LanguageDefinition,
  type LanguageOption,
} from "../src/languages.js";
import type { PersonalProfile } from "./PersonalizationTypes.js";

export function configuredLanguageOptions(
  module: Module | undefined,
  catalog: readonly LanguageDefinition[] = LANGUAGE_CATALOG,
  activeCodes?: readonly string[],
  historicalValues: readonly string[] = [],
): LanguageOption[] {
  if ((module?.schemaVersion ?? 0) >= 3)
    return languageOptions(catalog, activeCodes, historicalValues);
  const legacy =
    module?.entityTypes
      .flatMap((type) => type.fields)
      .find((field) => field.key === "language" && field.options)?.options ??
    [];
  const active = activeCodes
    ? new Set(activeCodes.map(normalizeLanguage))
    : null;
  // Schema 2 keeps the stored spelling while respecting the user's study choices.
  const options = legacy
    .filter((value) => !active || active.has(normalizeLanguage(value)))
    .map((value) => ({ value, label: languageLabel(value, catalog) }));
  for (const item of languageOptions(catalog, activeCodes, historicalValues))
    if (
      !options.some(
        (option) =>
          normalizeLanguage(option.value) === normalizeLanguage(item.value),
      )
    )
      options.push(item);
  for (const value of historicalValues)
    if (!options.some((option) => option.value === value))
      options.push({ value, label: languageLabel(value, catalog) });
  return options;
}

export function languageNeedsUpgrade(value: string, module?: Module) {
  const code = normalizeLanguage(value);
  return (
    !!code &&
    (module?.schemaVersion ?? 0) < 3 &&
    !LANGUAGE_CATALOG.some((language) => language.code === code)
  );
}

export function LanguageSelect({
  module,
  catalog,
  profile,
  value,
  onChange,
  label,
  required,
}: {
  module?: Module;
  catalog?: readonly LanguageDefinition[];
  profile?: PersonalProfile | null;
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
}) {
  const options = configuredLanguageOptions(
    module,
    catalog,
    profile?.languagePreferences.activeCodes,
    value ? [value] : [],
  );
  return (
    <select
      aria-label={label}
      required={required}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">请选择语言</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
