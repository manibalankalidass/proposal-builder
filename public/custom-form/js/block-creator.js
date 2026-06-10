/**
 * @fileoverview Block creator for custom form editor
 * Generates DOM elements matching the TextBlocks.js pattern from /var/www/html/cse3/
 */

class BlockCreator {
  constructor() {
    // this.utils = new Utils();
  }

  /**
   * Creates a unique hash for element IDs
   */
  generateHash() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return Math.random().toString(16).slice(2) + '-' + Math.random().toString(16).slice(2);
  }

  /**
   * Base wrapper element (cs_block_s)
   * @param {string} blockType - The block type (data attribute value, e.g., 'Title')
   * @param {string} additionalClasses - Extra CSS classes
   * @returns {HTMLElement}
   */
  getCsBlockSmall(blockType, additionalClasses = '') {
    const element = document.createElement('div');
    const classList = `cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block ${additionalClasses}`;

    element.setAttribute('class', classList);
    element.setAttribute('data', blockType);
    element.setAttribute('custom-name', blockType);
    element.setAttribute('id', 'block_' + this.generateHash());
    if (blockType == 'Title' || blockType == 'Textarea') {
      element.style.setProperty('padding-left', '10px');
    }

    return element;
  }

  /**
   * Wraps content in a cs_block_s wrapper
   * @param {HTMLElement|HTMLElement[]} contentElement
   * @param {string} blockType
   * @param {string} additionalClasses
   * @returns {HTMLElement}
   */
  addElementToCSBlock(contentElement, blockType, additionalClasses = '') {
    const block = this.getCsBlockSmall(blockType, additionalClasses);

    if (Array.isArray(contentElement)) {
      block.append(...contentElement);
    } else {
      block.append(contentElement);
    }

    return block;
  }

  /**
   * Creates an editable heading/title element
   * @param {Object} options
   * @returns {HTMLElement}
   */
  createEditableHeading(options = {}) {
    const {
      text = 'Heading 2',
      className = 'add-heading-two',
      fontSize = '32px',
      // fontWeight = 100,
      placeholder = null
    } = options;

    const wrapper = document.createElement('div');
    wrapper.className = `edit_me ${className}`;
    wrapper.id = `dynamic_${this.generateHash()}`;
    wrapper.setAttribute('placeholder', placeholder);
    wrapper.setAttribute('default-style-id', '');
    wrapper.style.fontSize = fontSize;
    // wrapper.style.fontWeight = fontWeight;
    wrapper.style.borderColor = 'rgb(89, 91, 101)';

    return wrapper;
  }

  /**
   * Creates a body text paragraph element
   * @param {Object} options
   * @returns {HTMLElement}
   */
  createBodyParagraph(options = {}) {
    const {
      text = '',
      fontSize = '14px',
      // fontWeight = 400,
      placeholder = 'Enter text here...'
    } = options;

    const wrapper = document.createElement('div');
    wrapper.className = 'edit_me fr-element fr-view resize';
    wrapper.id = `dynamic_${this.generateHash()}`;
    wrapper.setAttribute('placeholder', placeholder);
    wrapper.style.fontSize = fontSize;
    // wrapper.style.fontWeight = fontWeight;
    if (text) {
      wrapper.innerHTML = text;
    }

    return wrapper;
  }

  /**
   * Creates a complete Title block (heading)
   * @param {Object} options
   * @returns {HTMLElement}
   */
  createTitleBlock(options = {}) {
    const {
      text = 'Heading 2',
      className = 'add-heading-two',
      fontSize = '32px',
      // fontWeight = 100,
      position = { left: '96px', top: '75px' },
      width = 'auto',
      maxWidth = '692px'
    } = options;

    const content = this.createEditableHeading({
      text,
      className,
      fontSize,
      // fontWeight,
      placeholder: text
    });

    const block = this.addElementToCSBlock(content, 'Title');

    // Apply positioning and sizing
    block.style.position = 'absolute';
    block.style.left = position.left;
    block.style.top = position.top;
    if (width !== 'auto') {
      block.style.width = width;
    }
    block.style.maxWidth = maxWidth;

    return block;
  }

  /**
   * Creates a complete Body Text block (textarea/paragraph)
   * @param {Object} options
   * @returns {HTMLElement}
   */
  createBodyTextBlock(options = {}) {
    const {
      text = '',
      fontSize = '14px',
      // fontWeight = 400,
      position = { left: '96px', top: '140px' },
      width = 'auto',
      maxWidth = '692px'
    } = options;

    const content = this.createBodyParagraph({
      text,
      fontSize,
      // fontWeight,
      placeholder: 'Enter text here...'
    });

    const block = this.addElementToCSBlock(content, 'Textarea');

    // Apply positioning and sizing
    block.style.position = 'absolute';
    block.style.left = position.left;
    block.style.top = position.top;
    if (width !== 'auto') {
      block.style.width = width;
    }
    block.style.maxWidth = maxWidth;

    return block;
  }

  createTableBase({ headerBg = '#F8F9F9', headerColor = '#000', wrapperClass = 'edit_me fr-element fr-view' } = {}) {
    const editWrapper = document.createElement('div');
    editWrapper.className = wrapperClass;
    editWrapper.id = `dynamic_${this.generateHash()}`;

    const tableContainer = document.createElement('div');
    tableContainer.className = 'fr-element fr-view froala-table normal-table-width editor-table-container';

    const table = document.createElement('table');

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    Object.assign(headerRow.style, {
      color: headerColor,
    });

    ['', '', '', ''].forEach(() => {
      const th = document.createElement('th');
      th.textContent = '';
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    const rows = [
      ['', '', '', ''],
      ['', '', '', ''],
      ['', '', '', '']
    ];

    rows.forEach((rowData) => {
      const tr = document.createElement('tr');
      rowData.forEach(() => {
        const td = document.createElement('td');
        td.textContent = '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    tableContainer.appendChild(table);
    editWrapper.appendChild(tableContainer);

    return editWrapper;
  }

  createWhiteHeaderTableBlock() {
    const table = this.createTableBase({ headerBg: '#F8F9F9', headerColor: '#000' });
    return this.addElementToCSBlock(table, 'Table');
  }

  createBlueHeaderTableBlock() {
    const table = this.createTableBase({ headerBg: '#3883C1', headerColor: '#FFF' });
    return this.addElementToCSBlock(table, 'Table');
  }

  createLightBlueHeaderTableBlock() {
    const table = this.createTableBase({ headerBg: '#6493B5', headerColor: '#FFF' });
    return this.addElementToCSBlock(table, 'Table');
  }

  createGrayHeaderTableBlock() {
    const table = this.createTableBase({ headerBg: '#6B7A85', headerColor: '#FFF' });
    return this.addElementToCSBlock(table, 'Table');
  }

  createSectionContainerBlock(options = {}) {
    const {
      title = 'Section heading goes here',
      body = 'Drop more blocks around this area to visually frame content groups.',
      titleFontSize = '24px',
      bodyFontSize = '14px',
      width = 'auto',
      maxWidth = '760px'
    } = options;

    const content = document.createElement('div');
    content.className = 'section-container-content';
    content.id = `dynamic_${this.generateHash()}`;


    const block = this.addElementToCSBlock(content, 'Section Container');
    block.style.width = width !== 'auto' ? width : '';
    block.style.maxWidth = maxWidth;
    block.style.position = 'absolute';
    return block;
  }

  /**
   * Creates both a title and body text block together
   * @param {Object} options
   * @returns {Object} { titleBlock, bodyBlock }
   */
  createTitleAndBodyBlock(options = {}) {
    const {
      titleText = 'Heading 2',
      titleClass = 'add-heading-two',
      titleFontSize = '32px',
      bodyText = 'Body text goes here',
      bodyFontSize = '14px',
      titlePosition = { left: '96px', top: '75px' },
      bodyPosition = { left: '96px', top: '140px' },
      spacing = 65 // gap between title and body
    } = options;

    const titleBlock = this.createTitleBlock({
      text: titleText,
      className: titleClass,
      fontSize: titleFontSize,
      // fontWeight: 700,
      position: titlePosition,
      maxWidth: '692px'
    });

    const bodyBlock = this.createBodyTextBlock({
      text: bodyText,
      fontSize: bodyFontSize,
      // fontWeight: 400,
      position: {
        left: bodyPosition.left,
        top: bodyPosition.top
      },
      maxWidth: '692px'
    });

    return { titleBlock, bodyBlock };
  }

  /* ===============================
     IMAGE / VIDEO
  =============================== */

  createImageWrapper(dynamicClass) {
    const el = document.createElement('div');
    el.className = `${dynamicClass} image-container`;
    el.id = `image_${this.generateHash()}`;
    return el;
  }

  createImageButton(type = '') {
    const btn = document.createElement('div');
    btn.className = 'img-btn resize';
    btn.id = type === 'image' ? `image_1` : `video_1`;

    const icongroup = document.createElement('div');
    icongroup.className = 'icon-group';

    const iconLayer = document.createElement('div');
    iconLayer.className = 'icon-layer';
    const icon = document.createElement('i');
    if (type === 'image') {
      icon.className = 'fa-regular fa-image plus-img-icon';
    } else {
      icon.className = 'fa-brands fa-youtube plus-img-icon';
    }
    iconLayer.appendChild(icon);

    const iconTitle = document.createElement('div');
    iconTitle.className = 'img-btn-txt';
    iconTitle.textContent = type === 'image' ? 'Click to select image' : 'Click to select video';

    icongroup.append(iconLayer, iconTitle);
    btn.appendChild(icongroup);

    return btn;
  }

  createSquareImageBlock() {
    const imageWrapper = this.createImageWrapper('square-image');
    const imageButton = this.createImageButton('image');
    imageWrapper.appendChild(imageButton);
    const block = this.addElementToCSBlock(imageWrapper, 'Image', 'cs-image-block');
    imageWrapper.style.setProperty('height', '100px', 'important');
    imageWrapper.style.setProperty('aspect-ratio', 'auto', 'important');
    return block;
  }

  createVideoBlock() {
    const iframe = this.createImageButton('video');
    const block = this.addElementToCSBlock(iframe, 'Video', 'cs-video-block');
    iframe.style.setProperty('height', '100px', 'important');
    return block;
  }
}

// Export or attach to window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlockCreator;
} else {
  window.BlockCreator = BlockCreator;
}
