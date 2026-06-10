/**
 * @fileoverview Complete style management for blocks
 *
 * Handles:
 *   - Reading inline styles from blocks
 *   - Applying styles to blocks
 *   - Syncing styles between DOM and style panel
 *   - Special handling for text color, font size, border, padding, margin, etc.
 *
 * Exposes:
 *   window.StyleManager.readBlockStyles(block)     — extract all inline styles from block
 *   window.StyleManager.applyStyle(block, prop, value) — apply single style to block
 *   window.StyleManager.applyStyles(block, stylesObj) — apply multiple styles at once
 *   window.StyleManager.clearStyle(block, prop)    — remove specific style
 *   window.StyleManager.clearAllStyles(block)      — remove all inline styles
 */
(function () {
  window.StyleManager = window.StyleManager || {};

  // Convert RGB to Hex
  const rgbToHex = (rgb) => {
    if (!rgb) return '';

    // Check if already hex
    if (rgb.startsWith('#')) return rgb;

    // Parse rgb(r, g, b) format
    const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!match) return rgb;

    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);

    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };

  // CSS property to camelCase property name
  const cssPropToCamelCase = (cssProp) => {
    return cssProp.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
  };

  // camelCase property to CSS property name
  const camelCaseToCssProp = (camelCase) => {
    return camelCase.replace(/([A-Z])/g, (g) => `-${g.toLowerCase()}`);
  };

  /**
   * Read all inline styles from a block and return structured object
   */
  const readBlockStyles = (block) => {
    if (!block) return {};

    const blockStyle = block.style;
    const inner = block.querySelector('.edit_me, .section-container-content, .cs-flexible-content, .image-container');
    const innerStyle = inner ? inner.style : {};

    return {
      // Background & Color
      backgroundColor: rgbToHex(blockStyle.backgroundColor) || '',
      textColor: rgbToHex(innerStyle.color || blockStyle.color) || '',

      // Typography
      fontSize: innerStyle.fontSize || '',
      fontWeight: innerStyle.fontWeight || '',

      // Border
      borderStyle: blockStyle.borderStyle || '',
      borderColor: rgbToHex(blockStyle.borderColor) || '',
      borderWidth: blockStyle.borderWidth || '',
      borderRadius: blockStyle.borderRadius || '',

      // Spacing - Padding
      paddingTop: blockStyle.paddingTop || '',
      paddingRight: blockStyle.paddingRight || '',
      paddingBottom: blockStyle.paddingBottom || '',
      paddingLeft: blockStyle.paddingLeft || '',

      // Spacing - Margin
      marginTop: blockStyle.marginTop || '',
      marginRight: blockStyle.marginRight || '',
      marginBottom: blockStyle.marginBottom || '',
      marginLeft: blockStyle.marginLeft || '',

      // Visual Effects
      opacity: blockStyle.opacity || '',
      boxShadow: blockStyle.boxShadow || '',

      // Size
      width: blockStyle.width || '',
      height: blockStyle.height || '',
    };
  };

  /**
   * Apply a single style property to a block
   * @param {HTMLElement} block - the block element
   * @param {string} prop - property name (camelCase, e.g., 'backgroundColor')
   * @param {string} value - CSS value (e.g., '#ff0000', '16px')
   */
  const applyStyle = (block, prop, value) => {
    if (!block) return;

    const inner = block.querySelector('.edit_me, .section-container-content, .cs-flexible-content, .image-container');

    // Clear style if value is empty
    if (value === '' || value === null || value === undefined) {
      const cssProp = camelCaseToCssProp(prop);
      block.style.removeProperty(cssProp);
      if (inner) inner.style.removeProperty(cssProp);
      return;
    }

    // Apply to inner element for text properties
    if (prop === 'textColor' && inner) {
      inner.style.color = value;
      block.style.color = value; // fallback
    } else if (prop === 'fontSize' && inner) {
      inner.style.fontSize = value;
    } else if (prop === 'fontWeight' && inner) {
      inner.style.fontWeight = value;
    } else {
      // Apply to block for other properties
      const cssProp = camelCaseToCssProp(prop);
      block.style.setProperty(cssProp, value, 'important');
    }
  };

  /**
   * Apply multiple styles to a block at once
   * @param {HTMLElement} block - the block element
   * @param {Object} stylesObj - object with property names and values
   */
  const applyStyles = (block, stylesObj) => {
    if (!block || typeof stylesObj !== 'object') return;

    Object.entries(stylesObj).forEach(([prop, value]) => {
      applyStyle(block, prop, value);
    });
  };

  /**
   * Remove a specific style property from a block
   */
  const clearStyle = (block, prop) => {
    applyStyle(block, prop, '');
  };

  /**
   * Remove all inline styles from a block
   */
  const clearAllStyles = (block) => {
    if (!block) return;

    const allStyles = readBlockStyles(block);
    Object.keys(allStyles).forEach((prop) => {
      clearStyle(block, prop);
    });

    // Also clear the inner element if it exists
    const inner = block.querySelector('.edit_me, .section-container-content, .cs-flexible-content, .image-container');
    if (inner) {
      inner.style.cssText = '';
    }
  };

  /**
   * Get computed style value (from inline + CSS rules)
   */
  const getComputedStyleValue = (block, prop) => {
    if (!block) return '';

    const cssProp = camelCaseToCssProp(prop);
    const computed = window.getComputedStyle(block);
    return computed.getPropertyValue(cssProp) || '';
  };

  /**
   * Sync styles between block and style panel
   * This should be called after any style change to ensure consistency
   */
  const syncStyles = (block) => {
    if (!block) return;

    // Mark the block to indicate styles are synced
    block.dataset.styleSynced = new Date().getTime().toString();

    // Broadcast to parent if in iframe context
    if (window.parent !== window && typeof window.broadcastSelection === 'function') {
      window.broadcastSelection();
    }
  };

  /**
   * Validate CSS value before applying
   */
  const isValidCssValue = (prop, value) => {
    // Basic validation - could be enhanced
    if (!value) return true;

    const testEl = document.createElement('div');
    const cssProp = camelCaseToCssProp(prop);

    try {
      testEl.style.setProperty(cssProp, value);
      return testEl.style.getPropertyValue(cssProp) === value;
    } catch (e) {
      return false;
    }
  };

  // Export all functions
  Object.assign(window.StyleManager, {
    readBlockStyles,
    applyStyle,
    applyStyles,
    clearStyle,
    clearAllStyles,
    getComputedStyleValue,
    syncStyles,
    isValidCssValue,
    rgbToHex, // Export for use elsewhere
  });
})();
