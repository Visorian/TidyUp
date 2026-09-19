import { element } from '../../lib/ui/messages';

const list = element('#rules', HTMLUListElement);
const input = element('#new-rule', HTMLTextAreaElement);
const notice = element('#rule-notice', HTMLParagraphElement);
let rules: readonly string[] = [];

function ruleRow(rule: string, index: number): HTMLLIElement {
  const row = document.createElement('li');
  const text = document.createElement('span');
  text.textContent = rule;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-label', `Remove rule ${index + 1}`);
  remove.addEventListener('click', () => {
    rules = rules.filter((_, position) => position !== index);
    render();
    notice.textContent = 'Rule removed. Save settings to apply.';
    input.focus();
  });
  row.append(text, remove);
  return row;
}

function render(): void {
  list.replaceChildren();
  element('#rules-empty', HTMLParagraphElement).hidden = rules.length > 0;
  for (const [index, rule] of rules.entries()) list.append(ruleRow(rule, index));
}

export function setRules(value: readonly string[]): void {
  rules = [...value];
  input.value = '';
  notice.textContent = '';
  render();
}

export function readRules(): readonly string[] {
  if (input.value.trim() !== '')
    throw new Error('Add your new rule before saving, or clear its text.');
  return rules;
}

element('#add-rule', HTMLButtonElement).addEventListener('click', () => {
  const rule = input.value.trim();
  if (rule === '' || rule.length > 500 || rules.length >= 20) {
    notice.textContent = 'Enter a rule of up to 500 characters. You can add up to 20 rules.';
    input.focus();
    return;
  }
  if (rules.includes(rule)) {
    notice.textContent = 'This rule is already in the list.';
    return;
  }
  rules = [...rules, rule];
  input.value = '';
  render();
  notice.textContent = 'Rule added. Save settings to apply.';
  input.focus();
});
