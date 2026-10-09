export type LanguageDefinition = {
  code: string;
  name: string;
  legacyValues?: readonly string[];
};
export type LanguageOption = { value: string; label: string };

export const LANGUAGE_CATALOG: readonly LanguageDefinition[] = [
  { code: "en", name: "英语", legacyValues: ["英语"] },
  { code: "ja", name: "日语", legacyValues: ["日语"] },
  { code: "fr", name: "法语", legacyValues: ["法语"] },
];
export const DEFAULT_ACTIVE_LANGUAGE_CODES = ["en", "ja"] as const;

/** Normalize identity for comparisons, without rewriting historical fields. */
export function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const legacy = LANGUAGE_CATALOG.find((item) =>
    item.legacyValues?.includes(value),
  );
  if (legacy) return legacy.code;
  if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value)) return null;
  try {
    return new Intl.Locale(value).toString();
  } catch {
    return null;
  }
}

export function validateLanguageCatalog(
  catalog: readonly LanguageDefinition[],
): LanguageDefinition[] {
  if (!Array.isArray(catalog) || catalog.length > 100)
    throw Error("Invalid language catalog");
  const codes = new Set<string>(),
    aliases = new Set<string>();
  return catalog.map((item: LanguageDefinition) => {
    const code = normalizeLanguage(item?.code);
    if (
      !code ||
      typeof item.code !== "string" ||
      !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(item.code) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 100 ||
      codes.has(code) ||
      (item.legacyValues !== undefined &&
        (!Array.isArray(item.legacyValues) ||
          item.legacyValues.some(
            (alias: string) =>
              typeof alias !== "string" || !alias.trim() || alias.length > 100,
          )))
    )
      throw Error("Invalid or duplicate language definition");
    codes.add(code);
    const legacyValues = item.legacyValues?.map((alias: string) => {
      if (aliases.has(alias)) throw Error("Duplicate language alias");
      const identity = normalizeLanguage(alias);
      if (identity && identity !== code)
        throw Error("Language alias changes an existing identity");
      aliases.add(alias);
      return alias;
    });
    return {
      code,
      name: item.name.trim(),
      ...(legacyValues ? { legacyValues } : {}),
    };
  });
}

export function languageCatalog(
  custom: readonly LanguageDefinition[] = [],
): LanguageDefinition[] {
  return validateLanguageCatalog([...LANGUAGE_CATALOG, ...custom]);
}

export function validateActiveLanguageCodes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100)
    throw Error("Invalid active language codes");
  const codes = value.map((item) => {
    const code = normalizeLanguage(item);
    if (!code) throw Error("Invalid active language code");
    return code;
  });
  return [...new Set(codes)];
}

export function languageLabel(
  value: unknown,
  catalog: readonly LanguageDefinition[] = LANGUAGE_CATALOG,
): string {
  const code = normalizeLanguage(value);
  return (
    catalog.find(
      (item) =>
        item.code === code ||
        (typeof value === "string" && item.legacyValues?.includes(value)),
    )?.name ?? String(value ?? "")
  );
}

/** Labels are presentation, never identity; distinguish homonyms in legacy views. */
export function languageDisplayLabels(
  codes: readonly string[],
  catalog: readonly LanguageDefinition[] = LANGUAGE_CATALOG,
): Map<string, string> {
  const unique = [...new Set(codes)].sort();
  const labels = unique.map((code) => languageLabel(code, catalog));
  const used = new Set<string>();
  return new Map(
    unique.map((code, index) => {
      let label =
        labels.filter((value) => value === labels[index]).length > 1
          ? `${labels[index]} (${code})`
          : labels[index];
      // A custom name may itself equal another language's disambiguated label.
      while (used.has(label)) label += ` [${code}]`;
      used.add(label);
      return [code, label];
    }),
  );
}

/** Historical values remain selectable when editing, even after stopping study. */
export function languageOptions(
  catalog: readonly LanguageDefinition[] = LANGUAGE_CATALOG,
  activeCodes?: readonly string[],
  historicalValues: readonly string[] = [],
): LanguageOption[] {
  const active =
    activeCodes === undefined
      ? null
      : new Set(validateActiveLanguageCodes(activeCodes));
  const options = catalog
    .filter((item) => !active || active.has(item.code))
    .map((item) => ({ value: item.code, label: item.name }));
  for (const value of historicalValues)
    if (!options.some((option) => option.value === value))
      options.push({ value, label: languageLabel(value, catalog) });
  return options;
}
