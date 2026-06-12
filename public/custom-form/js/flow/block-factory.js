/**
 * @fileoverview Block factory for flow canvas.
 *
 * Delegates to BlockCreator (block-creator.js) where possible, otherwise
 * constructs lightweight blocks for the simpler types (Divider, Spacer,
 * Button, Label/Tag, Data Field, List Repeater).
 *
 * Exposes:  window.FlowCanvas.createBlock(blockType) → HTMLElement | null
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  const blockCreator = (typeof BlockCreator !== 'undefined') ? new BlockCreator() : null;

  // ---------------------------------------------------------------------------
  // Lightweight block builders for types that BlockCreator doesn't handle.
  // Each returns a `.cs_block_s` element so it integrates with inline-editor.js
  // selection / editing chrome.
  // ---------------------------------------------------------------------------

  const makeCsBlock = (label, blockType, extraClass = '') => {
    if (!blockCreator) {
      const el = document.createElement('div');
      el.className = `cs_block_s ${extraClass}`.trim();
      el.setAttribute('data', label);
      el.setAttribute('custom-name', label);
      el.dataset.blockType = blockType;
      return el;
    }
    const el = blockCreator.getCsBlockSmall(label, extraClass);
    el.setAttribute('custom-name', label);
    el.dataset.blockType = blockType;
    return el;
  };

  const hash = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Math.random().toString(16).slice(2);
  };

  const createLabelTagBlock = () => {
    const block = makeCsBlock('Label', 'label-tag', 'cs-label-block');
    const inner = document.createElement('div');
    inner.className = 'edit_me cs-label-tag';
    inner.id = `dynamic_${hash()}`;
    inner.setAttribute('placeholder', 'Featured');
    inner.style.fontSize = '12px';
    inner.style.fontWeight = '600';
    inner.style.display = 'inline-block';
    inner.style.padding = '4px 10px';
    inner.style.borderRadius = '999px';
    inner.style.background = '#eef0ff';
    inner.style.color = '#5c5cff';
    inner.textContent = 'Featured';
    block.appendChild(inner);
    return block;
  };

  const createButtonBlock = () => {
    const block = makeCsBlock('Button', 'button', 'cs-button-block');
    const inner = document.createElement('div');
    inner.className = 'edit_me cs-button';
    inner.id = `dynamic_${hash()}`;
    inner.setAttribute('placeholder', 'Call to Action');
    inner.style.display = 'inline-block';
    inner.style.padding = '10px 20px';
    inner.style.background = '#5c5cff';
    inner.style.color = '#fff';
    inner.style.borderRadius = '6px';
    inner.style.fontWeight = '600';
    inner.style.fontSize = '14px';
    inner.style.textAlign = 'center';
    inner.style.cursor = 'pointer';
    inner.textContent = 'Call to Action';
    block.appendChild(inner);
    return block;
  };

  const createDividerBlock = () => {
    const block = makeCsBlock('Divider', 'divider', 'cs-divider-block');
    const line = document.createElement('div');
    line.className = 'cs-divider-line';
    line.style.height = '1px';
    line.style.background = '#cfd4f6';
    line.style.width = '100%';
    // line.style.margin = '14px 0';
    block.appendChild(line);
    return block;
  };

  const createSpacerBlock = () => {
    const block = makeCsBlock('Spacer', 'spacer', 'cs-spacer-block');
    const space = document.createElement('div');
    space.className = 'cs-spacer';
    space.style.height = '32px';
    space.style.width = '100%';
    space.style.background = 'transparent';
    block.appendChild(space);
    return block;
  };

  const createDataFieldBlock = () => {
    const block = makeCsBlock('Data Field', 'data-field', 'cs-data-field-block');
    const inner = document.createElement('div');
    inner.className = 'edit_me cs-data-field';
    inner.id = `dynamic_${hash()}`;
    inner.setAttribute('placeholder', '{{ binding.path }}');
    inner.style.padding = '8px 12px';
    inner.style.border = '1px dashed #cfd4f6';
    inner.style.borderRadius = '4px';
    inner.style.fontFamily = 'monospace';
    inner.style.fontSize = '14px';
    inner.style.color = '#5c5cff';
    inner.textContent = '{{ binding.path }}';
    block.appendChild(inner);
    return block;
  };

  const createPageBreakBlock = () => {
    // Page Break is a visual marker. The drop handler in flow-canvas.js
    // recognises this block type and immediately splits the page; the
    // block itself is removed during the split. We still build a styled
    // element so the user sees what they're dragging.
    const block = makeCsBlock('Page Break', 'page-break', 'cs-page-break-block');
    const inner = document.createElement('div');
    inner.className = 'cs-page-break';
    inner.style.display = 'flex';
    inner.style.alignItems = 'center';
    inner.style.gap = '8px';
    inner.style.padding = '8px 12px';
    inner.style.border = '1px dashed #f97316';
    inner.style.background = '#fff7ed';
    inner.style.color = '#c2410c';
    inner.style.fontSize = '12px';
    inner.style.fontWeight = '600';
    inner.style.textTransform = 'uppercase';
    inner.style.letterSpacing = '0.06em';
    inner.style.borderRadius = '4px';
    inner.textContent = '— Page Break —';
    block.appendChild(inner);
    return block;
  };

  const createListRepeaterBlock = () => {
    const block = makeCsBlock('List Repeater', 'list-repeater', 'cs-list-repeater-block');
    block.dataset.repeatPath = '';
    block.dataset.repeatAlias = 'item';
    const list = document.createElement('ul');
    list.className = 'edit_me cs-list-repeater';
    list.id = `dynamic_${hash()}`;
    list.style.margin = '0';
    list.style.padding = '0 0 0 20px';
    list.style.fontSize = '14px';
    list.style.lineHeight = '1.6';
    ['Dynamic list item one', 'Dynamic list item two', 'Dynamic list item three'].forEach(text => {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    block.appendChild(list);
    return block;
  };

  const createFlexibleBlock = () => {
    const block = makeCsBlock('Flexible', 'flexible', 'cs-flexible-block');
    block.dataset.blockType = 'flexible';
    block.style.position = 'relative';
    const content = document.createElement('div');
    content.className = 'cs-flexible-content';
    content.id = `dynamic_${hash()}`;
    content.style.position = 'relative';
    content.style.width = '100%';
    content.style.minHeight = `${window.CanvasConfig?.flexible?.defaultHeight ?? 80}px`;
    block.appendChild(content);
    return block;
  };

  const createFAIconBlock = (iconName = 'star', iconClass = 'fas fa-star') => {
    const block = makeCsBlock('Icon', 'fa-icon', 'cs-fa-icon-block');
    const container = document.createElement('div');
    container.className = 'cs-fa-icon-container';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.width = '100%';
    container.style.minHeight = '60px';
    container.style.fontSize = '40px';
    container.style.color = '#5c5cff';

    const icon = document.createElement('i');
    icon.className = iconClass;
    icon.id = `dynamic_${hash()}`;
    container.appendChild(icon);
    block.appendChild(container);

    block.dataset.iconName = iconName;
    block.dataset.iconClass = iconClass;
    return block;
  };



  // ---------------------------------------------------------------------------
  // Builder registry — one entry per block `type`. To add a block, register it
  // in block-registry.js (metadata) AND add a builder here (DOM construction).
  // Each builder returns a `.cs_block_s` element.
  // ---------------------------------------------------------------------------
  const BUILDERS = {
    // Delegated to BlockCreator
    'heading':     () => blockCreator.createTitleBlock({ text: 'New Heading', className: 'add-heading-two', fontSize: '14px' }),
    'heading-two': () => blockCreator.createTitleBlock({ text: 'New Heading', className: 'add-heading-two', fontSize: '14px' }),
    'body-text':   () => blockCreator.createBodyTextBlock({ fontSize: '14px' }),
    'section-container': () => blockCreator.createSectionContainerBlock(),
    'table-repeater':    () => blockCreator.createWhiteHeaderTableBlock(),
    'image':       () => blockCreator.createSquareImageBlock(),
    'video':       () => blockCreator.createVideoBlock(),

    // Lightweight builders defined above
    'label-tag':   createLabelTagBlock,
    'button':      createButtonBlock,
    'divider':     createDividerBlock,
    'spacer':      createSpacerBlock,
    'data-field':  createDataFieldBlock,
    'list-repeater': createListRepeaterBlock,
    'flexible':    createFlexibleBlock,
    'fa-icon':     () => createFAIconBlock(),
    'page-break':  createPageBreakBlock,
    'pen-shape':   () => window.PenShape?.createBlock() || null,
    'table':       () => window.TableBlock?.createBlock() || null,
    'sync-list':   () => window.SyncList?.createBlock() || null,
  };
  // Expose so other modules / future plugins can register builders.
  window.FlowCanvas.BLOCK_BUILDERS = BUILDERS;

  // ---------------------------------------------------------------------------
  // Main factory
  // ---------------------------------------------------------------------------

  window.FlowCanvas.createBlock = function (blockType) {
    if (!blockCreator) {
      console.warn('flow-canvas/block-factory: BlockCreator not loaded');
      return null;
    }

    // Dynamic dispatch for predefined templates
    const templateMatch = blockType.match(/^predefine-template-(\d+)$/);
    if (templateMatch) {
      const n = Number(templateMatch[1]);
      return window.FlowCanvas.TEMPLATE_HTML && window.FlowCanvas.TEMPLATE_HTML[n] !== undefined ? window.FlowCanvas.TEMPLATE_HTML[n] : null;
    }

    const builder = BUILDERS[blockType];
    if (builder) return builder();

    // Unknown type — warn if the registry knows about it (missing builder),
    // then fall back to a generic placeholder block.
    if (window.FormBlockRegistry?.byType(blockType)) {
      console.warn(`flow-canvas/block-factory: no builder for registered type "${blockType}"`);
    }
    const el = blockCreator.getCsBlockSmall(blockType);
    el.dataset.blockType = blockType;
    el.innerHTML = `<div class="canvas-block__content"><span class="canvas-block__tag">${blockType}</span></div>`;
    return el;
  };
})();
