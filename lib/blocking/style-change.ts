export interface StyleChange {
  readonly element: HTMLElement;
  readonly property: string;
  readonly value: string;
  readonly priority: string;
  readonly applied: string;
  readonly appliedPriority: string;
}

export function changeStyle(element: HTMLElement, property: string, applied: string): StyleChange {
  const change = {
    element,
    property,
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  };
  element.style.setProperty(property, applied, 'important');
  return {
    ...change,
    applied: element.style.getPropertyValue(property),
    appliedPriority: element.style.getPropertyPriority(property),
  };
}

export function restoreStyle(change: StyleChange): void {
  const { element, property, applied, value, priority } = change;
  if (
    element.style.getPropertyValue(property) !== applied ||
    element.style.getPropertyPriority(property) !== change.appliedPriority
  )
    return;
  if (value === '') element.style.removeProperty(property);
  else element.style.setProperty(property, value, priority);
}
