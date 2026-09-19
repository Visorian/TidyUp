import type { CandidateClassification, Settings } from '../shared/types';

export interface ActiveRule {
  readonly text: string;
  readonly categoryId: string | null;
}

export function activeRules(settings: Settings): readonly ActiveRule[] {
  return [
    ...settings.rules.map((text) => ({ text, categoryId: null })),
    ...settings.categories
      .filter((category) => category.enabled)
      .flatMap((category) => category.rules.map((text) => ({ text, categoryId: category.id }))),
  ];
}

export function matchingCategoryIds(
  settings: Settings,
  result: CandidateClassification,
): readonly string[] {
  return [
    ...new Set(
      activeRules(settings).flatMap((rule, index) =>
        rule.categoryId !== null && (result.ruleProbabilities[index] ?? 0) >= settings.threshold
          ? [rule.categoryId]
          : [],
      ),
    ),
  ];
}

export function countHiddenCategories(
  matches: readonly (readonly string[])[],
): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();
  for (const categories of matches) {
    for (const id of categories) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}
