// Entry point: registers the <proposal-studio> custom element (idempotently)
// and re-exports the class for programmatic use.
import { ProposalStudioElement } from './element.js';

export const TAG_NAME = 'proposal-studio';

/**
 * Define the custom element. Safe to call multiple times — the second call is
 * a no-op. Returns the element constructor.
 * @param {string} [tagName] override the element tag (default 'proposal-studio')
 */
export function defineProposalStudio(tagName = TAG_NAME) {
  if (
    typeof customElements !== 'undefined' &&
    !customElements.get(tagName)
  ) {
    customElements.define(tagName, ProposalStudioElement);
  }
  return ProposalStudioElement;
}

// Auto-register on import so `import 'proposal-studio'` is enough.
if (typeof customElements !== 'undefined') {
  defineProposalStudio();
}

export { ProposalStudioElement };
export default ProposalStudioElement;
