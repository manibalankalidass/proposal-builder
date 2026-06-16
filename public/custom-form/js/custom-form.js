const dragStoreKey = '__BROCHURE_FLOW_DRAG__';
const dropSurface = document.querySelector('.custom-form-design');
const emptyState = null; // No empty state in new structure
const blockCreator = new BlockCreator(); // Initialize BlockCreator

const blockPresets = {
  'hero-section': {
    label: 'Hero Section',
    width: 640,
    html: `
      <div class="block-card block-card--hero">
        <span class="canvas-block__tag">Hero</span>
        <h2>Build brochure sections visually</h2>
        <p>Combine content blocks, reposition them freely, and prepare a polished export layout without leaving the canvas.</p>
        <div class="block-actions">
          <span class="block-pill block-pill--primary">Primary CTA</span>
          <span class="block-pill">Secondary CTA</span>
        </div>
      </div>
    `
  },
  'multi-column': {
    label: 'Multi-Column',
    width: 620,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Columns</span>
        <div class="block-columns">
          <div class="block-column">
            <strong>Left Column</strong>
            <p class="block-paragraph">Use this space for supporting brochure copy or highlights.</p>
          </div>
          <div class="block-column">
            <strong>Right Column</strong>
            <p class="block-paragraph">Drop other elements nearby and arrange the layout visually.</p>
          </div>
        </div>
      </div>
    `
  },
  'image-text': {
    label: 'Image + Text',
    width: 620,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Media</span>
        <div class="block-media">
          <div class="block-image"></div>
          <div class="block-copy">
            <h3>Image with supporting content</h3>
            <p class="block-paragraph">Pair visuals with concise descriptive text for product, service, or campaign sections.</p>
          </div>
        </div>
      </div>
    `
  },
  'pricing-block': {
    label: 'Pricing Block',
    width: 650,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Pricing</span>
        <div class="block-pricing">
          <div class="block-price-card">
            <h3>Starter</h3>
            <strong>$19</strong>
            <p class="block-paragraph">Simple intro package.</p>
          </div>
          <div class="block-price-card">
            <h3>Growth</h3>
            <strong>$49</strong>
            <p class="block-paragraph">Popular brochure option.</p>
          </div>
          <div class="block-price-card">
            <h3>Scale</h3>
            <strong>$99</strong>
            <p class="block-paragraph">Advanced presentation tier.</p>
          </div>
        </div>
      </div>
    `
  },
  footer: {
    label: 'Footer',
    width: 640,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Footer</span>
        <div class="block-footer">
          <strong>BrochureFlow</strong>
          <div class="block-footer__links">
            <span>About</span>
            <span>Contact</span>
            <span>Support</span>
          </div>
        </div>
      </div>
    `
  },
  heading: {
    label: 'Heading',
    width: 420,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Heading</span>
        <h2 class="block-heading">Section heading goes here</h2>
      </div>
    `
  },
  'body-text': {
    label: 'Body Text',
    width: 420,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Paragraph</span>
        <p class="block-paragraph">Use this body text block for descriptive copy, feature explanations, or brochure summaries.</p>
      </div>
    `
  },
  'label-tag': {
    label: 'Label / Tag',
    width: 220,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Label</span>
        <span class="block-label">Featured</span>
      </div>
    `
  },
  image: {
    label: 'Image',
    width: 320,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Image</span>
        <div class="block-image"></div>
      </div>
    `
  },
  button: {
    label: 'Button',
    width: 220,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Button</span>
        <span class="block-button">Call to Action</span>
      </div>
    `
  },
  divider: {
    label: 'Divider',
    width: 620,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Divider</span>
        <div class="block-divider"></div>
      </div>
    `
  },
  spacer: {
    label: 'Spacer',
    width: 420,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Spacer</span>
        <div class="block-spacer"></div>
      </div>
    `
  },
  'section-container': {
    label: 'Section Container',
    width: 640,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Container</span>
        <div class="block-container">
          <strong>Reusable section container</strong>
          <p class="block-paragraph">Drop more blocks around this area to visually frame content groups.</p>
        </div>
      </div>
    `
  },
  'table-repeater': {
    label: 'Table Repeater',
    width: 620,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Table Repeater</span>
        <div class="block-table">
          <div class="block-table__row">
            <span>Item Name</span>
            <span>Qty</span>
            <span>Price</span>
          </div>
          <div class="block-table__row">
            <span>Dynamic Row</span>
            <span>1</span>
            <span>$24</span>
          </div>
        </div>
      </div>
    `
  },
  'data-field': {
    label: 'Data Field',
    width: 300,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Data Field</span>
        <div class="block-input">{{ customer.name }}</div>
      </div>
    `
  },
  'list-repeater': {
    label: 'List Repeater',
    width: 340,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">List Repeater</span>
        <ul class="block-list">
          <li>Dynamic list item one</li>
          <li>Dynamic list item two</li>
          <li>Dynamic list item three</li>
        </ul>
      </div>
    `
  },
  rectangle: {
    label: 'Rectangle',
    width: 320,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Rectangle</span>
        <div class="block-shape block-shape--rectangle"></div>
      </div>
    `
  },
  circle: {
    label: 'Circle',
    width: 220,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Circle</span>
        <div class="block-shape block-shape--circle"></div>
      </div>
    `
  },
  'icon-badge': {
    label: 'Icon Badge',
    width: 160,
    html: `
      <div class="block-card">
        <span class="canvas-block__tag">Icon Badge</span>
        <div class="block-icon-badge">★</div>
      </div>
    `
  }
};

let selectedBlock = null;
let activeMove = null;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getParentPayload = () => {
  try {
    return window.parent?.[dragStoreKey] ?? null;
  } catch (error) {
    return null;
  }
};

const parsePayload = (value) => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const getDragPayload = (event) => {
  const directPayload =
    parsePayload(event.dataTransfer?.getData('application/x-brochure-block')) ||
    parsePayload(event.dataTransfer?.getData('text/plain'));

  if (directPayload?.blockType) {
    console.log('custom-form: direct payload', directPayload);
    return directPayload;
  }

  const fallbackPayload = getParentPayload();
  console.log('custom-form: fallback payload', fallbackPayload);
  return fallbackPayload?.blockType ? fallbackPayload : null;
};

const getParentBindingData = () => {
  try {
    // First, try to use the getter function if available
    const getter = window.parent?.__BROCHURE_FLOW_GET_BINDING_DATA__;
    if (typeof getter === 'function') {
      const data = getter();
      console.log('custom-form: Got binding data from getter:', data);
      return data;
    }

    // Fallback to direct property access
    const data = window.parent?.__BROCHURE_FLOW_BINDING_DATA__;
    if (data) {
      console.log('custom-form: Got binding data from property:', data);
      return data;
    }

    console.warn('custom-form: Binding data not found on parent window');
    console.log('custom-form: Parent window keys:', Object.keys(window.parent || {}));
    return null;
  } catch (error) {
    console.error('custom-form: Failed to get binding data:', error);
    return null;
  }
};

// Walk the binding data and collect array paths. When topLevelOnly is true we
// stop the moment we find an array — nested arrays inside it stay hidden and
// only surface later when the user drops a child block inside the configured
// section (scoped arrays via computeScopedArrays).
const buildBindingArrays = (data, prefix = '', topLevelOnly = false) => {
  const arrays = [];

  if (Array.isArray(data)) {
    const preview = data.length && data[0] && typeof data[0] === 'object'
      ? Object.keys(data[0]).slice(0, 3).join(', ')
      : String(data[0] ?? '');

    if (prefix) {
      arrays.push({
        path: prefix,
        count: data.length,
        preview,
        scope: 'root'
      });
    }

    if (topLevelOnly) return arrays;

    if (data.length && data[0] && typeof data[0] === 'object') {
      arrays.push(...buildBindingArrays(data[0], prefix, topLevelOnly));
    }
    return arrays;
  }

  if (data && typeof data === 'object') {
    Object.keys(data).forEach((key) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      arrays.push(...buildBindingArrays(data[key], nextPrefix, topLevelOnly));
    });
  }

  return arrays;
};

let sectionBindingModal = null;
let sectionBindingTarget = null;
let sectionBindingSelection = null;
let sectionBindingAlias = 'section';
let sectionBindingSelectCallback = null;

const populateSectionBindingList = (modal, items) => {
  const listElement = modal.querySelector('.section-binding-list');
  if (!listElement) {
    return;
  }

  listElement.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'section-binding-empty';
    empty.textContent = 'No arrays could be detected from the current JSON binding source.';
    listElement.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'section-binding-array-item';
    button.dataset.path = item.path;
    button.innerHTML = `
      <div class="section-binding-array-item__row">
        <span class="section-binding-array-item__path">${item.path}</span>
        <span class="section-binding-array-item__count">${item.count} items</span>
      </div>
      <div class="section-binding-array-item__preview">${item.preview}</div>
    `;
    button.addEventListener('click', () => {
      sectionBindingSelectCallback?.(item);
    });
    listElement.appendChild(button);
  });
};

const hideSectionBindingModal = () => {
  if (!sectionBindingModal) {
    return;
  }
  sectionBindingModal.hidden = true;
  sectionBindingTarget = null;
  sectionBindingSelection = null;
};

const createSectionBindingModal = () => {
  if (sectionBindingModal) {
    return sectionBindingModal;
  }

  const modal = document.createElement('div');
  modal.className = 'section-binding-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="section-binding-backdrop"></div>
    <div class="section-binding-card">
      <header class="section-binding-header">
        <div>
          <div class="section-binding-title">Bind Section Loop</div>
          <div class="section-binding-subtitle">Choose which JSON array this section should repeat over</div>
        </div>
        <button type="button" class="section-binding-close" aria-label="Close">×</button>
      </header>
      <div class="section-binding-grid">
        <div class="section-binding-list-card">
          <div class="section-binding-list-title">Detected arrays <span class="section-binding-badge"></span></div>
          <div class="section-binding-list"></div>
        </div>
        <div class="section-binding-config-card">
          <div class="section-binding-field-label">Selected array path</div>
          <div class="section-binding-field section-binding-field--readonly" data-selected-path>← Select an array on the left</div>
          <label class="section-binding-field-label">Loop variable name (alias)</label>
          <input type="text" class="section-binding-input" value="section" />
          <div class="section-binding-generated-code">
            <div class="section-binding-code-title">Generated Twig</div>
            <pre class="section-binding-code">Select an array to see generated code</pre>
          </div>
        </div>
      </div>
      <div class="section-binding-footer">
        <button type="button" class="section-binding-skip">Skip — I’ll configure later</button>
        <button type="button" class="section-binding-apply" disabled>Apply Binding</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const listElement = modal.querySelector('.section-binding-list');
  const selectedPathElement = modal.querySelector('[data-selected-path]');
  const aliasInput = modal.querySelector('.section-binding-input');
  const codeElement = modal.querySelector('.section-binding-code');
  const badgeElement = modal.querySelector('.section-binding-badge');
  const applyButton = modal.querySelector('.section-binding-apply');
  const closeButton = modal.querySelector('.section-binding-close');
  const skipButton = modal.querySelector('.section-binding-skip');
  const backdrop = modal.querySelector('.section-binding-backdrop');

  const renderCodePreview = () => {
    if (!sectionBindingSelection) {
      codeElement.textContent = 'Select an array to see generated code';
      return;
    }

    codeElement.textContent = `\{% for ${sectionBindingAlias} in ${sectionBindingSelection.path} %}\n  {{ ${sectionBindingAlias}.field }}\n\{% endfor %}`;
  };

  const updateSelection = (item) => {
    sectionBindingSelection = item;
    selectedPathElement.textContent = item.path;
    applyButton.disabled = false;
    renderCodePreview();
    sectionBindingModal.querySelectorAll('.section-binding-array-item').forEach((button) => {
      button.classList.toggle('section-binding-array-item--selected', button.dataset.path === item.path);
    });
  };

  sectionBindingSelectCallback = updateSelection;

  aliasInput.addEventListener('input', () => {
    sectionBindingAlias = aliasInput.value.trim() || 'section';
    renderCodePreview();
  });

  applyButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!sectionBindingTarget || !sectionBindingSelection) {
      return;
    }

    sectionBindingTarget.dataset.repeatPath = sectionBindingSelection.path;
    sectionBindingTarget.dataset.repeatAlias = sectionBindingAlias;
    sectionBindingTarget.dataset.repeatLabel = sectionBindingSelection.path;

    let info = sectionBindingTarget.querySelector('.section-binding-info');
    if (!info) {
      info = document.createElement('div');
      info.className = 'section-binding-info';
      sectionBindingTarget.appendChild(info);
    }
    info.textContent = `Repeats ${sectionBindingSelection.path}`;
    handleClose();
  });

  const handleClose = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    console.log('custom-form: Modal close triggered');
    hideSectionBindingModal();
  };

  closeButton.addEventListener('click', handleClose, true);
  skipButton.addEventListener('click', handleClose, true);
  backdrop.addEventListener('click', handleClose, true);

  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      handleClose(event);
    }
  });

  sectionBindingModal = modal;
  return sectionBindingModal;
};

// Find every block in the SAME scope as the freshly-dropped block that already
// has a repeat binding. Root drop → search whole doc. Inside a section → search
// within that section only. We use this to dim already-bound paths in the modal
// so the user can't bind two siblings to the same array.
const collectSiblingBoundPaths = (block) => {
  const paths = new Set();
  if (!block) return paths;

  let searchRoot = null;
  let cur = block.parentElement || null;
  while (cur) {
    if (cur.dataset?.repeatPath) { searchRoot = cur; break; }
    if (cur.classList?.contains('cs_margin') || cur.tagName === 'BODY') {
      searchRoot = cur;
      break;
    }
    cur = cur.parentElement;
  }
  if (!searchRoot) searchRoot = document.querySelector('.cs_margin') || document.body;

  searchRoot.querySelectorAll('[data-repeat-path]').forEach((el) => {
    if (el === block) return;
    const path = el.dataset.repeatPath;
    if (path) paths.add(path);
  });
  return paths;
};

const showSectionBindingModal = (block) => {
  // Modal UI lives in the parent Angular app so it can cover the full page
  // with a backdrop. We just send a message identifying which block needs a
  // binding, plus the list of detectable arrays for the user to pick from.
  if (!block.id) {
    block.id = 'block_' + Math.random().toString(36).substr(2, 9);
  }

  const bindingData = getParentBindingData();

  // Tree-aware modal:
  //   - Block has ancestor repeater → arrays = full nested tree under the
  //     innermost ancestor's iteration (each row carries the for-loop chain
  //     needed to reach it).
  //   - Root canvas drop → arrays = full nested tree from root (top-level
  //     arrays + every nested array inside them).
  let scopedArrays = [];
  let ancestorAlias = '';
  if (window.FlowCanvas?.computeScopedArrays) {
    const scoped = window.FlowCanvas.computeScopedArrays(block, bindingData);
    if (scoped) {
      scopedArrays = scoped.arrays || [];
      ancestorAlias = scoped.alias || '';
    }
  }

  let arrays;
  if (ancestorAlias) {
    arrays = scopedArrays;
  } else if (window.FlowCanvas?.buildRootArrayTree) {
    arrays = window.FlowCanvas.buildRootArrayTree(bindingData);
  } else {
    arrays = bindingData ? buildBindingArrays(bindingData, '', true) : [];
  }

  const disabledPaths = [];

  const blockType = block.dataset.blockType ||
    block.getAttribute('data') ||
    'block';

  // No arrays available → modal skip pannidu, block mattum drop aagattum.
  if (!arrays.length) {
    console.log('custom-form: no arrays available for binding, skipping modal');
    return;
  }

  try {
    window.parent?.postMessage({
      source: 'custom-form-twig',
      type: 'binding-modal:open',
      data: {
        blockId: block.id,
        blockType,
        arrays,
        ancestorAlias,
        disabledPaths
      }
    }, '*');
  } catch (e) { console.warn('Failed to open parent binding modal', e); }
};

const updateModalWithArrays = (modal, bindingData) => {
  const arrays = bindingData ? buildBindingArrays(bindingData) : [];

  console.log('updateModalWithArrays: arrays =', arrays, 'count =', arrays.length);

  const badge = modal.querySelector('.section-binding-badge');
  badge.textContent = `${arrays.length} found`;
  const aliasInput = modal.querySelector('.section-binding-input');
  const selectedPathElement = modal.querySelector('[data-selected-path]');
  const codeElement = modal.querySelector('.section-binding-code');
  const applyButton = modal.querySelector('.section-binding-apply');

  aliasInput.value = 'section';
  selectedPathElement.textContent = '← Select an array on the left';
  codeElement.textContent = 'Select an array to see generated code';
  applyButton.disabled = true;
  populateSectionBindingList(modal, arrays);
};

const setEmptyStateVisibility = () => {
  if (!emptyState || !dropSurface) {
    return;
  }

  emptyState.hidden = dropSurface.querySelectorAll('.canvas-block').length > 0;
};

const clearSelection = () => {
  if (selectedBlock) {
    selectedBlock.classList.remove('canvas-block--selected');
    selectedBlock = null;
  }
};

const selectBlock = (block) => {
  if (selectedBlock === block) {
    return;
  }

  clearSelection();
  selectedBlock = block;
  selectedBlock.classList.add('canvas-block--selected');
};

const constrainBlockToSurface = (block, intendedLeft, intendedTop) => {
  const width = block.offsetWidth;
  const height = block.offsetHeight;
  const maxLeft = Math.max(0, dropSurface.clientWidth - width);
  const maxTop = Math.max(0, dropSurface.clientHeight - height);

  // For BlockCreator blocks, ensure they have position: absolute
  if (block.classList.contains('cs_block_s')) {
    block.style.position = 'absolute';
  }

  block.style.left = `${clamp(intendedLeft, 0, maxLeft)}px`;
  block.style.top = `${clamp(intendedTop, 0, maxTop)}px`;
};

const createBlockElement = (payload) => {
  // Use BlockCreator for Title and Textarea blocks
  if (payload.blockType === 'heading' || payload.blockType === 'heading-two') {
    return blockCreator.createTitleBlock({
      text: 'New Heading',
      className: 'add-heading-two',
      fontSize: '14px'
    });
  }

  if (payload.blockType === 'body-text') {
    return blockCreator.createBodyTextBlock({
      text: 'Enter your text here',
      fontSize: '14px'
    });
  }

  const preset = blockPresets[payload.blockType] || blockPresets['body-text'];
  const contentWidth = Math.min(preset.width, dropSurface.clientWidth - 32);

  // For section/table blocks, use the cs_block_s editor-aware wrapper.
  const useCsBlock = payload.blockType === 'section-container' || payload.blockType === 'table-repeater';

  if (payload.blockType === 'table-repeater') {
    const tableBlock = blockCreator.createWhiteHeaderTableBlock();
    tableBlock.dataset.blockType = payload.blockType;
    tableBlock.style.width = `${contentWidth}px`;
    return tableBlock;
  }

  if (payload.blockType === 'section-container') {
    const sectionBlock = blockCreator.createSectionContainerBlock();
    sectionBlock.dataset.blockType = payload.blockType;
    sectionBlock.style.width = `${contentWidth}px`;
    return sectionBlock;
  }

  if (payload.blockType === 'image') {
    const imageBlock = blockCreator.createSquareImageBlock();
    imageBlock.dataset.blockType = payload.blockType;
    return imageBlock;
  }

  if (payload.blockType === 'video') {
    const videoBlock = blockCreator.createVideoBlock();
    videoBlock.dataset.blockType = payload.blockType;
    return videoBlock;
  }

  if (useCsBlock) {
    const block = blockCreator.getCsBlockSmall(payload.blockType);
    block.setAttribute('custom-name', preset.label || payload.blockType);
    block.dataset.blockType = payload.blockType;
    block.innerHTML = `<div class="canvas-block__content">${preset.html}</div>`;
    block.style.width = `${contentWidth}px`;
    return block;
  }

  const block = document.createElement('article');
  block.className = 'canvas-block';
  block.dataset.blockType = payload.blockType;
  block.innerHTML = `
    <div class="canvas-block__inner">
      <button class="canvas-block__remove" type="button" aria-label="Remove block">×</button>
      <div class="canvas-block__content">${preset.html}</div>
    </div>
  `;
  block.style.width = `${contentWidth}px`;

  return block;
};

const addBlockAtPosition = (payload, clientX, clientY, targetElement) => {
  const block = createBlockElement(payload);

  // Find if we are dropping inside a section container
  const containerContent = targetElement ? targetElement.closest('.section-container-content') : null;
  const targetParent = containerContent || dropSurface;
  const surfaceRect = targetParent.getBoundingClientRect();

  targetParent.appendChild(block);

  // Calculate position relative to drop surface
  const left = clientX - surfaceRect.left - (block.offsetWidth / 2);
  const top = clientY - surfaceRect.top - 36;

  constrainBlockToSurface(block, left, top);

  // Legacy canvas-block selection only — cs_block_s blocks are handled by inline-editor.js
  if (block.classList.contains('canvas-block') && !block.classList.contains('cs_block_s')) {
    selectBlock(block);
  }

  setEmptyStateVisibility();

  if (payload.blockType === 'section-container') {
    showSectionBindingModal(block);
  }

  return block;
};

const beginMove = (event, block) => {
  const blockRect = block.getBoundingClientRect();

  activeMove = {
    block,
    offsetX: event.clientX - blockRect.left,
    offsetY: event.clientY - blockRect.top
  };

  selectBlock(block);
  block.setPointerCapture?.(event.pointerId);
};

const handlePointerMove = (event) => {
  if (!activeMove) {
    return;
  }

  const surfaceRect = dropSurface.getBoundingClientRect();
  const left = event.clientX - surfaceRect.left - activeMove.offsetX;
  const top = event.clientY - surfaceRect.top - activeMove.offsetY;

  constrainBlockToSurface(activeMove.block, left, top);
};

const finishMove = (event) => {
  if (!activeMove) {
    return;
  }

  activeMove.block.releasePointerCapture?.(event.pointerId);
  activeMove = null;
};

const setupCanvasEvents = () => {
  console.log('custom-form: setting up events on', dropSurface);
  dropSurface.addEventListener('click', (event) => {
    if (!event.target.closest('.canvas-block, .cs_block_s')) {
      clearSelection();
    }
  });

  dropSurface.addEventListener('dragenter', (event) => {
    console.log('custom-form: dragenter', event);
    if (getDragPayload(event)) {
      event.preventDefault();
      dropSurface.classList.add('drop-surface--active');
    }
  });

  dropSurface.addEventListener('dragover', (event) => {
    console.log('custom-form: dragover', event);
    if (getDragPayload(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      dropSurface.classList.add('drop-surface--active');
    }
  });

  dropSurface.addEventListener('dragleave', (event) => {
    console.log('custom-form: dragleave', event);
    if (!dropSurface.contains(event.relatedTarget)) {
      dropSurface.classList.remove('drop-surface--active');
    }
  });

  dropSurface.addEventListener('drop', (event) => {
    console.log('custom-form: drop event', event);
    const payload = getDragPayload(event);

    if (!payload) {
      console.log('custom-form: no payload');
      return;
    }

    // Page Break is fully handled by flow-canvas.js (splits the page);
    // we must not also drop a legacy overlay block for it.
    if (payload.blockType === 'page-break') {
      event.preventDefault();
      dropSurface.classList.remove('drop-surface--active');
      return;
    }

    console.log('custom-form: drop payload', payload);
    event.preventDefault();
    dropSurface.classList.remove('drop-surface--active');
    addBlockAtPosition(payload, event.clientX, event.clientY, event.target);
  });

  dropSurface.addEventListener('pointerdown', (event) => {
    const removeButton = event.target.closest('.canvas-block__remove');

    if (removeButton) {
      const block = removeButton.closest('.canvas-block, .cs_block_s');
      block?.remove();
      if (selectedBlock === block) {
        selectedBlock = null;
      }
      setEmptyStateVisibility();
      return;
    }

    if (event.target.closest('[contenteditable="true"], .fr-element, .inline-editing, [data-cs-chrome]')) {
      return;
    }

    // cs_block_s blocks are moved via the badge handle (owned by inline-editor.js).
    // Only the legacy .canvas-block flow uses whole-block drag here.
    const block = event.target.closest('.canvas-block');

    if (!block || block.classList.contains('cs_block_s') || event.button !== 0) {
      return;
    }

    event.preventDefault();
    beginMove(event, block);
  });

  dropSurface.addEventListener('pointermove', handlePointerMove);
  dropSurface.addEventListener('pointerup', finishMove);
  dropSurface.addEventListener('pointercancel', finishMove);
};

document.documentElement.dataset.previewReady = 'true';
// Old absolute drag-and-drop is disabled when flow-canvas.js is loaded.
// Flow canvas owns drop handling; we keep this file loaded only for the
// section-binding modal (showSectionBindingModal) which other code may invoke.
const FLOW_CANVAS_OWNS_DRAG = true;
if (!FLOW_CANVAS_OWNS_DRAG) {
  setupCanvasEvents();
}
setEmptyStateVisibility();

// Expose the modal opener so flow-canvas.js (and other modules) can trigger it.
window.showSectionBindingModal = showSectionBindingModal;

// Listen for messages from parent to open binding modal for a specific block
window.addEventListener('message', (event) => {
  if (event.data?.target !== 'custom-form-twig' || event.data?.type !== 'open-binding-modal-for-block') {
    return;
  }
  const blockId = event.data?.blockId;
  if (!blockId) return;
  const block = document.getElementById(blockId);
  if (block) {
    showSectionBindingModal(block);
  }
});
