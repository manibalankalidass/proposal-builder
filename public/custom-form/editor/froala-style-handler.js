/**
 * @fileoverview Froala Editor Style Commands Handler
 *
 * Provides a clean API to apply block styles through Froala editor commands
 * when a block is in editing mode. This ensures proper undo/redo integration
 * and consistency with Froala's internal state management.
 *
 * Exposes:
 *   window.FroalaStyleHandler.applyColor(hexColor)
 *   window.FroalaStyleHandler.applyBackgroundColor(hexColor)
 *   window.FroalaStyleHandler.applyFontSize(sizeWithUnit)
 *   window.FroalaStyleHandler.applyFontWeight(weightValue)
 *   window.FroalaStyleHandler.applyTextAlign(alignValue)
 *   window.FroalaStyleHandler.applyBold()
 *   window.FroalaStyleHandler.applyItalic()
 *   window.FroalaStyleHandler.applyUnderline()
 *   window.FroalaStyleHandler.removeFormat()
 *   window.FroalaStyleHandler.hasActiveEditor()
 *   window.FroalaStyleHandler.getActiveEditor()
 */

(function () {
  // Get the currently editing block's Froala editor instance
  // Uses EditorManager.getFroalaEditor() which is the authoritative source
  const getActiveFroalaEditor = () => {
    const manager = window.EditorManager;
    if (!manager || !manager.getFroalaEditor) return null;
    return manager.getFroalaEditor();
  };

  const applyStyleCommand = (commandName, ...args) => {
    const editor = getActiveFroalaEditor();
    if (!editor || !editor.commands) {
      console.warn(`FroalaStyleHandler: No active editor for command ${commandName}`);
      return false;
    }

    try {
      editor.commands.exec(commandName, args);
      return true;
    } catch (e) {
      console.error(`FroalaStyleHandler: Error executing ${commandName}:`, e);
      return false;
    }
  };

  window.FroalaStyleHandler = {
    /**
     * Apply text color via Froala color command
     * @param {string} hexColor - hex color code like '#FF0000'
     */
    applyColor(hexColor) {
      return applyStyleCommand('textColor', hexColor);
    },

    /**
     * Apply background color via Froala backgroundColor command
     * @param {string} hexColor - hex color code like '#FFFF00'
     */
    applyBackgroundColor(hexColor) {
      return applyStyleCommand('backgroundColor', hexColor);
    },

    /**
     * Apply font size via Froala fontSize command
     * @param {string} sizeWithUnit - like '16px' or '1.2rem'
     */
    applyFontSize(sizeWithUnit) {
      return applyStyleCommand('fontSize', sizeWithUnit);
    },

    /**
     * Apply font weight via Froala command
     * @param {string|number} weight - '400', '500', '600', '700' or 'normal', 'bold'
     */
    applyFontWeight(weight) {
      // Map numeric weights to Froala paragraph style names if needed
      const styleMap = {
        '300': 'font-weight-light',
        '400': 'normal',
        '500': 'font-weight-medium',
        '600': 'font-weight-semi-bold',
        '700': 'font-weight-bold',
        '800': 'bold'
      };

      const styleValue = styleMap[weight] || weight;

      // Apply via bold command for heavy weights
      if (weight === '700' || weight === '800') {
        return applyStyleCommand('bold');
      }

      // For paragraph styles, use paragraphStyle command
      if (styleValue in styleMap) {
        return applyStyleCommand('paragraphStyle', styleValue);
      }

      return false;
    },

    /**
     * Apply text alignment
     * @param {string} align - 'left', 'center', 'right', 'justify'
     */
    applyTextAlign(align) {
      return applyStyleCommand('align', align);
    },

    /**
     * Apply bold formatting
     */
    applyBold() {
      return applyStyleCommand('bold');
    },

    /**
     * Apply italic formatting
     */
    applyItalic() {
      return applyStyleCommand('italic');
    },

    /**
     * Apply underline formatting
     */
    applyUnderline() {
      return applyStyleCommand('underline');
    },

    /**
     * Remove all formatting
     */
    removeFormat() {
      return applyStyleCommand('removeFormat');
    },

    /**
     * Check if there's an active Froala editor
     */
    hasActiveEditor() {
      return !!getActiveFroalaEditor();
    },

    /**
     * Get the active Froala editor instance (for advanced usage)
     */
    getActiveEditor() {
      return getActiveFroalaEditor();
    },

    /**
     * Debug: Print current editor state
     */
    debug() {
      const editor = getActiveFroalaEditor();
      const manager = window.EditorManager;
      console.log('FroalaStyleHandler Debug:', {
        hasEditor: !!editor,
        hasEditorManager: !!manager,
        editingBlock: manager?.getEditing?.(),
        froalaEditor: editor ? 'Active' : 'Inactive'
      });
    }
  };

  console.log('froala-style-handler: initialized');
})();
