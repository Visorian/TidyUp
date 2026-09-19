const PRIVATE_ELEMENTS =
  'form,input,textarea,select,option,script,style,template,noscript,details:not([open]),[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="searchbox"]';

export const INERT_ELEMENTS = 'script,style,template,noscript';

export function composedParent(element: Element): Element | null {
  if (element.assignedSlot !== null) return element.assignedSlot;
  if (element.parentElement !== null) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function isSafeCandidateBoundary(element: Element): boolean {
  if (hasPrivateAncestor(element)) return false;
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = element;
  for (let visited = 0; node !== null && visited < 80; visited += 1) {
    if (
      node instanceof Element &&
      ((isPrivateElement(node) && !node.matches(INERT_ELEMENTS)) ||
        node.shadowRoot !== null ||
        node instanceof HTMLSlotElement)
    )
      return false;
    node = walker.nextNode();
  }
  return node === null;
}

export function isPrivateElement(element: Element): boolean {
  return element.matches(PRIVATE_ELEMENTS);
}

export function hasPrivateAncestor(element: Element): boolean {
  let current: Element | null = element;
  for (let depth = 0; current !== null && depth < 64; depth += 1) {
    if (isPrivateElement(current)) return true;
    current = composedParent(current);
  }
  return current !== null;
}

export function isVisible(element: Element): boolean {
  if (!element.isConnected) return false;
  const view = element.ownerDocument.defaultView;
  if (view === null) return false;
  let current: Element | null = element;
  for (let depth = 0; current !== null && depth < 64; depth += 1) {
    if (isHidden(current)) return false;
    current = composedParent(current);
  }
  if (current !== null) return false;
  const bounds = element.getBoundingClientRect();
  return bounds.width > 1 && bounds.height > 1;
}

export function isHidden(element: Element): boolean {
  // Light DOM that is not assigned to a slot does not render below a shadow host.
  if (
    element.assignedSlot === null &&
    element.parentElement !== null &&
    element.parentElement.shadowRoot !== null
  )
    return true;
  if (
    element.parentElement instanceof HTMLSlotElement &&
    element.parentElement.assignedNodes().length > 0
  )
    return true;
  if (
    element.hasAttribute('hidden') ||
    element.hasAttribute('inert') ||
    element.getAttribute('aria-hidden') === 'true'
  )
    return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return (
    style === undefined ||
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse' ||
    style.opacity === '0' ||
    style.contentVisibility === 'hidden'
  );
}
