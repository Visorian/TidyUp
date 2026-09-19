import { LIMITS } from '../../lib/config/defaults';
import { addStarterCategories, STARTER_CATEGORIES } from '../../lib/config/starter-rules';
import type { RuleCategory, Settings } from '../../lib/shared/types';
import { element } from '../../lib/ui/messages';

type RuleSettings = Pick<Settings, 'rules' | 'categories'>;
const list = element('#rules', HTMLUListElement);
const groups = element('#categories', HTMLDivElement);
const input = element('#new-rule', HTMLTextAreaElement);
const categoryInput = element('#new-category', HTMLInputElement);
const notice = element('#rule-notice', HTMLParagraphElement);
const drafts = new Map<string, string>();
const expanded = new Set<string>();
let rules: readonly string[] = [];
let categories: readonly RuleCategory[] = [];

function ruleCount(): number {
  return rules.length + categories.reduce((count, category) => count + category.rules.length, 0);
}

function groupRules(id: string | null): readonly string[] {
  return id === null ? rules : (categories.find((category) => category.id === id)?.rules ?? []);
}

function updateCategory(id: string, values: Partial<RuleCategory>): void {
  categories = categories.map((category) =>
    category.id === id ? { ...category, ...values } : category,
  );
}

function updateRules(id: string | null, values: readonly string[]): void {
  if (id === null) rules = values;
  else updateCategory(id, { rules: values });
}

function ruleRow(rule: string, index: number, id: string | null, group: string): HTMLLIElement {
  const row = document.createElement('li');
  const label = document.createElement('label');
  label.textContent = `Rule ${index + 1}`;
  const text = document.createElement('textarea');
  text.rows = 3;
  text.maxLength = LIMITS.ruleLength;
  text.required = true;
  text.value = rule;
  text.setAttribute('aria-label', `${group}, rule ${index + 1}`);
  text.addEventListener('input', () => {
    updateRules(
      id,
      groupRules(id).map((value, position) => (position === index ? text.value : value)),
    );
  });
  label.append(text);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-button danger';
  remove.textContent = 'Remove rule';
  remove.setAttribute('aria-label', `Remove ${group} rule ${index + 1}`);
  remove.addEventListener('click', () => {
    updateRules(
      id,
      groupRules(id).filter((_, position) => position !== index),
    );
    render();
    notice.textContent = 'Rule removed. Save settings to apply.';
  });
  row.append(label, remove);
  return row;
}

function addRule(value: string, id: string | null): boolean {
  const rule = value.trim();
  if (rule === '' || rule.length > LIMITS.ruleLength || ruleCount() >= LIMITS.rules) {
    notice.textContent = `Enter a rule of up to ${LIMITS.ruleLength} characters. You can have ${LIMITS.rules} rules in total.`;
    return false;
  }
  if (groupRules(id).some((existing) => existing.trim() === rule)) {
    notice.textContent = 'This rule is already in this list.';
    return false;
  }
  updateRules(id, [...groupRules(id), rule]);
  notice.textContent = 'Rule added. Save settings to apply.';
  return true;
}

function categoryFields(
  category: RuleCategory,
  title: HTMLElement,
  hint: HTMLElement,
): HTMLElement {
  const fields = document.createElement('div');
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Category name';
  const name = document.createElement('input');
  name.type = 'text';
  name.maxLength = 60;
  name.required = true;
  name.value = category.name;
  name.addEventListener('input', () => {
    updateCategory(category.id, { name: name.value });
    title.textContent = name.value;
  });
  nameLabel.append(name);
  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'switch-row category-enabled';
  const enabledText = document.createElement('span');
  enabledText.textContent = 'Enable category';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.role = 'switch';
  enabled.checked = category.enabled;
  enabled.addEventListener('change', () => {
    updateCategory(category.id, { enabled: enabled.checked });
    hint.textContent = categoryHint(groupRules(category.id).length, enabled.checked);
  });
  enabledLabel.append(enabledText, enabled);
  fields.append(nameLabel, enabledLabel);
  return fields;
}

function categoryActions(category: RuleCategory): HTMLElement {
  const content = document.createElement('div');
  const draftLabel = document.createElement('label');
  draftLabel.textContent = 'New rule';
  const draft = document.createElement('textarea');
  draft.rows = 2;
  draft.maxLength = LIMITS.ruleLength;
  draft.value = drafts.get(category.id) ?? '';
  draft.placeholder = 'Describe what this category should hide.';
  draft.addEventListener('input', () => {
    drafts.set(category.id, draft.value);
  });
  draftLabel.append(draft);
  const actions = document.createElement('div');
  actions.className = 'rule-actions';
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Add rule';
  add.addEventListener('click', () => {
    if (!addRule(draft.value, category.id)) return;
    drafts.delete(category.id);
    render();
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-button danger';
  remove.textContent = 'Remove category';
  remove.addEventListener('click', () => {
    categories = categories.filter((item) => item.id !== category.id);
    drafts.delete(category.id);
    expanded.delete(category.id);
    render();
    notice.textContent = 'Category and its rules removed. Save settings to apply.';
  });
  actions.append(add, remove);
  content.append(draftLabel, actions);
  return content;
}

function categoryHint(count: number, enabled: boolean): string {
  return `${count} ${count === 1 ? 'rule' : 'rules'} · ${enabled ? 'On' : 'Off'}`;
}

function categoryEditor(category: RuleCategory): HTMLDetailsElement {
  const editor = document.createElement('details');
  editor.className = 'category-editor';
  editor.addEventListener(
    'invalid',
    () => {
      editor.open = true;
    },
    true,
  );
  editor.open = expanded.has(category.id);
  editor.addEventListener('toggle', () => {
    if (editor.open) expanded.add(category.id);
    else expanded.delete(category.id);
  });
  const summary = document.createElement('summary');
  const title = document.createElement('strong');
  title.textContent = category.name;
  const hint = document.createElement('span');
  hint.textContent = categoryHint(category.rules.length, category.enabled);
  summary.append(title, hint);
  const content = document.createElement('div');
  content.className = 'category-content';
  const categoryRules = document.createElement('ul');
  categoryRules.className = 'rule-list';
  category.rules.forEach((rule, index) => {
    categoryRules.append(ruleRow(rule, index, category.id, category.name));
  });
  content.append(categoryFields(category, title, hint), categoryRules, categoryActions(category));
  editor.append(summary, content);
  return editor;
}

function render(): void {
  list.replaceChildren();
  groups.replaceChildren();
  element('#rules-empty', HTMLParagraphElement).hidden = ruleCount() > 0 || categories.length > 0;
  for (const category of categories) groups.append(categoryEditor(category));
  for (const [index, rule] of rules.entries())
    list.append(ruleRow(rule, index, null, 'Custom rules'));
}

export function setRules(value: RuleSettings): void {
  rules = value.rules;
  categories = value.categories;
  input.value = '';
  categoryInput.value = '';
  drafts.clear();
  notice.textContent = '';
  render();
}

export function readRules(): RuleSettings {
  if (input.value.trim() !== '' || [...drafts.values()].some((value) => value.trim() !== ''))
    throw new Error('Add your new rule before saving, or clear its text.');
  if (categoryInput.value.trim() !== '')
    throw new Error('Create your new category before saving, or clear its name.');
  if (
    rules.some((rule) => rule.trim() === '') ||
    categories.some(
      (category) =>
        category.name.trim() === '' || category.rules.some((rule) => rule.trim() === ''),
    )
  )
    throw new Error('Give every category a name and every rule a description.');
  return {
    rules: rules.map((rule) => rule.trim()),
    categories: categories.map((category) => ({
      ...category,
      name: category.name.trim(),
      rules: category.rules.map((rule) => rule.trim()),
    })),
  };
}

element('#add-rule', HTMLButtonElement).addEventListener('click', () => {
  if (!addRule(input.value, null)) return;
  input.value = '';
  render();
  input.focus();
});

element('#add-category', HTMLButtonElement).addEventListener('click', () => {
  const name = categoryInput.value.trim();
  if (name === '' || name.length > 60 || categories.length >= 20) {
    notice.textContent =
      'Enter a category name of up to 60 characters. You can have up to 20 categories.';
    categoryInput.focus();
    return;
  }
  const category: RuleCategory = { id: crypto.randomUUID(), name, enabled: true, rules: [] };
  categories = [...categories, category];
  expanded.add(category.id);
  categoryInput.value = '';
  render();
  notice.textContent = 'Category created. Add rules, then save settings to apply.';
});

element('#add-starter-rules', HTMLButtonElement).addEventListener('click', () => {
  const next = addStarterCategories({ rules, categories });
  const added = next.categories.length - categories.length;
  const moved = rules.length - next.rules.length;
  rules = next.rules;
  categories = next.categories;
  render();
  const remaining = STARTER_CATEGORIES.filter(
    (starter) => !categories.some((category) => category.id === starter.id),
  ).length;
  if (remaining > 0) {
    notice.textContent = `Added ${added} categories. Remove rules or categories to make room for the remaining ${remaining}, then try again. Save settings to apply.`;
  } else if (added > 0 || moved > 0) {
    notice.textContent =
      'Starter categories added. Review their rules, then save settings to apply.';
  } else {
    notice.textContent = 'Starter categories are already present. Your edits are kept.';
  }
});
