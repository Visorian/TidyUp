const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const panels = [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')];

function activate(section: string): void {
  const selected = tabs.find((tab) => tab.dataset['section'] === section) ?? tabs[0];
  if (selected === undefined) return;
  history.replaceState(null, '', `#${selected.dataset['section'] ?? 'rules'}`);
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of panels) panel.hidden = panel.id !== selected.getAttribute('aria-controls');
}

export function initializeNavigation(): void {
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => {
      activate(tab.dataset['section'] ?? 'rules');
    });
    tab.addEventListener(
      'keydown',
      (event: Readonly<Pick<KeyboardEvent, 'key' | 'preventDefault'>>) => {
        const positions: Readonly<Record<string, number>> = {
          ArrowRight: (index + 1) % tabs.length,
          ArrowLeft: (index + tabs.length - 1) % tabs.length,
          Home: 0,
          End: tabs.length - 1,
        };
        const position = positions[event.key];
        if (position === undefined) return;
        event.preventDefault();
        const next = tabs[position];
        if (next === undefined) return;
        activate(next.dataset['section'] ?? 'rules');
        next.focus();
      },
    );
  }

  document.addEventListener(
    'invalid',
    (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      const panel = event.target.closest('[role="tabpanel"]');
      const tab = tabs.find((item) => item.getAttribute('aria-controls') === panel?.id);
      if (tab !== undefined) activate(tab.dataset['section'] ?? 'rules');
    },
    true,
  );

  activate(location.hash.slice(1));
}
