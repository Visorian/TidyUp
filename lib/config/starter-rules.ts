import { LIMITS } from './defaults';
import type { RuleCategory, Settings } from '../shared/types';

export const STARTER_CATEGORIES: readonly RuleCategory[] = [
  {
    id: 'ads',
    name: 'Ads',
    enabled: true,
    rules: [
      'Hide paid advertisements, including banner, sidebar, and inline display ads labeled Advertisement, Anzeige, Werbung, or Sponsored. Keep editorial articles and ordinary product reviews visible.',
      'Hide advertising page skins and page-wide promotional backgrounds surrounding the main content. Keep the page content and ordinary decorative backgrounds visible.',
    ],
  },
  {
    id: 'cookie-consent',
    name: 'Cookie consent',
    enabled: true,
    rules: [
      'Hide cookie and tracking consent overlays, including prompts that ask visitors to accept tracking or buy a subscription, such as Agree or Subscribe to Pur. Keep login, checkout, and other essential dialogs visible.',
    ],
  },
  {
    id: 'subscription-prompts',
    name: 'Subscription prompts',
    enabled: true,
    rules: [
      'Hide promotional newsletter signups and subscription offers in banners, popups, and overlays. Keep article content, login forms, checkout, and paywalls that restrict access to content visible.',
    ],
  },
];

type RuleSettings = Pick<Settings, 'rules' | 'categories'>;

export function addStarterCategories(settings: RuleSettings): RuleSettings {
  let rules = [...settings.rules];
  const categories = [...settings.categories];
  for (const starter of STARTER_CATEGORIES) {
    const existing = categories.find((category) => category.id === starter.id);
    if (existing !== undefined) {
      rules = rules.filter(
        (rule) => !starter.rules.includes(rule) || !existing.rules.includes(rule),
      );
      continue;
    }
    const remaining = rules.filter((rule) => !starter.rules.includes(rule));
    const total = categories.reduce((count, category) => count + category.rules.length, 0);
    if (
      categories.length >= LIMITS.rules ||
      remaining.length + total + starter.rules.length > LIMITS.rules
    )
      continue;
    rules = remaining;
    categories.push({ ...starter, rules: [...starter.rules] });
  }
  return { rules, categories };
}
