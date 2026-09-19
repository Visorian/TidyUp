import { LIMITS } from './defaults';

export const STARTER_RULES: readonly string[] = [
  'Hide paid advertisements, including banner, sidebar, and inline display ads labeled Advertisement, Anzeige, Werbung, or Sponsored. Keep editorial articles and ordinary product reviews visible.',
  'Hide advertising page skins and page-wide promotional backgrounds surrounding the main content. Keep the page content and ordinary decorative backgrounds visible.',
  'Hide cookie and tracking consent overlays, including prompts that ask visitors to accept tracking or buy a subscription, such as Agree or Subscribe to Pur. Keep login, checkout, and other essential dialogs visible.',
];

export function addStarterRules(rules: readonly string[]): readonly string[] {
  const missing = STARTER_RULES.filter((rule) => !rules.includes(rule));
  return [...rules, ...missing.slice(0, Math.max(0, LIMITS.rules - rules.length))];
}
