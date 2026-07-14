/**
 * @fileoverview SINGLE SOURCE OF TRUTH for every block type.
 *
 * Add / edit / remove a block in ONE place here and it automatically flows to:
 *   - the sidebar palette        (src/app/app.ts  → librarySections)
 *   - the inline "+" insert menu  (flow/inline-insert.js → INLINE_LIBRARY)
 *   - the style-properties panel  (src/app/app.ts  → blockStyleConfig)
 *   - repeater / flexible rules    (flow-canvas.js, row-col-builder.js)
 *   - repeater alias defaults      (src/app/app.ts → defaultAliasFor)
 *
 * The actual DOM construction for each type still lives in flow/block-factory.js
 * (keyed by `type`), because that needs imperative builder code — but every
 * `type` listed here must have a matching builder there.
 *
 * Loaded as a plain script in BOTH runtime contexts (each gets its own copy of
 * the same data):
 *   - the iframe canvas  → public/custom-form/custom-form.html
 *   - the Angular parent → src/index.html
 *
 * Per-block fields
 * ----------------
 *   type               kebab-case id used everywhere (dataset.blockType, payloads)
 *   label              human label shown in palettes
 *   icon               glyph shown in palettes
 *   category           palette grouping title (null = never shown in palettes)
 *   inSidebar          show in the left sidebar palette
 *   inInlineMenu       show in the inline "+" insert menu
 *   isRepeater         opens the binding modal; iterates over bound data
 *   restrictInFlexible cannot be dropped inside a flexible container
 *   alias              default loop alias for repeaters (for {% for alias in ... %})
 *   styleProps         style controls shown in the right properties panel
 *   legacyKeys         old label-based blockType keys that still map to this block
 */
(function () {
  // ---- shared style-prop presets (keep these matching app.ts history) -------
  const STD_TEXT = ['backgroundColor', 'textColor', 'fontSize', 'fontWeight', 'borderStyle', 'borderColor', 'borderWidth', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'opacity', 'boxShadow', 'width', 'height'];
  const BOX_RADIUS = ['backgroundColor', 'borderStyle', 'borderColor', 'borderWidth', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'opacity', 'boxShadow', 'width', 'height'];
  const BOX_NO_RADIUS = ['backgroundColor', 'borderStyle', 'borderColor', 'borderWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'opacity', 'boxShadow', 'width', 'height'];
  const TABLE = ['backgroundColor', 'borderStyle', 'borderColor', 'borderWidth', 'tableBorder', 'tableBorderColor', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'opacity', 'boxShadow', 'width', 'height'];
  const TABLE_RADIUS = ['backgroundColor', 'borderStyle', 'borderColor', 'borderWidth', 'borderRadius', 'tableBorder', 'tableBorderColor', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'opacity', 'boxShadow', 'width', 'height'];
  const SPACER = ['backgroundColor', 'width', 'height', 'opacity'];
  const VIDEO = ['width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'boxShadow'];
  const ICON = ['textColor', 'fontSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'opacity', 'width', 'height'];

  // ---- the block catalog ----------------------------------------------------
  const BLOCKS = [
    // ---- Basic Elements ----
    { type: 'heading', label: 'Heading', icon: 'H', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: STD_TEXT, legacyKeys: ['Title'] },
    { type: 'body-text', label: 'Body Text', icon: '¶', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: STD_TEXT, legacyKeys: ['Textarea'] },
    { type: 'aiden', label: 'AI Writer', icon: '✦', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: STD_TEXT },
    { type: 'voice-text', label: 'Voice Text', icon: '🎙', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: STD_TEXT, feature: 'voiceText' },
    // { type: 'label-tag', label: 'Label / Tag', icon: 'A', category: 'Basic Elements', inSidebar: true, inInlineMenu: false, styleProps: STD_TEXT },
    { type: 'image', label: 'Image', icon: '▨', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: BOX_RADIUS, legacyKeys: ['Image'] },
    { type: 'video', label: 'Video', icon: '▶', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: VIDEO, legacyKeys: ['Video'] },
    { type: 'pen-shape', label: 'Pen Shape', icon: '✒', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'opacity', 'width', 'height'] },
    // { type: 'button', label: 'Button', icon: '⬡', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: STD_TEXT, legacyKeys: ['Button'] },
    { type: 'divider', label: 'Divider', icon: '─', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: BOX_NO_RADIUS },
    { type: 'spacer', label: 'Spacer', icon: '⋮', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: SPACER, legacyKeys: ['Spacer'] },
    { type: 'table', label: 'Table', icon: '▦', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: TABLE_RADIUS },
    { type: 'flexible', label: 'Flexible', icon: '⬡', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: BOX_RADIUS },
    { type: 'page-break', label: 'Page Break', icon: '⤵', category: 'Basic Elements', inSidebar: true, inInlineMenu: true, styleProps: [] },

    // ---- Data Elements ----
    { type: 'section-container', label: 'Section Container', icon: '⬢', category: 'Data Elements', inSidebar: true, inInlineMenu: true, isRepeater: true, restrictInFlexible: true, alias: 'section', styleProps: BOX_RADIUS, legacyKeys: ['Section Container'] },
    { type: 'table-repeater', label: 'Table Repeater', icon: '⊟', category: 'Data Elements', inSidebar: true, inInlineMenu: true, isRepeater: true, restrictInFlexible: false, alias: 'row', styleProps: TABLE, legacyKeys: [{ key: 'Table', styleProps: TABLE_RADIUS }] },
    // { type: 'data-field', label: 'Data Field', icon: '{{}}', category: 'Data Elements', inSidebar: true, inInlineMenu: true, styleProps: STD_TEXT, legacyKeys: ['Data Field'] },
    // { type: 'list-repeater', label: 'List Repeater', icon: '≡', category: 'Data Elements', inSidebar: true, inInlineMenu: true, isRepeater: true, restrictInFlexible: true, alias: 'item', styleProps: BOX_NO_RADIUS, legacyKeys: ['List Repeater'] },
    // { type: 'sync-list', label: 'List', icon: '▥', category: 'Data Elements', inSidebar: true, inInlineMenu: true, restrictInFlexible: true, styleProps: BOX_RADIUS },

    // ---- Builder-only (created programmatically, never shown in palettes) ----
    { type: 'heading-two', label: 'Heading', icon: 'H', category: null, inSidebar: false, inInlineMenu: false, styleProps: STD_TEXT },
    { type: 'fa-icon', label: 'Icon', icon: '★', category: null, inSidebar: false, inInlineMenu: false, styleProps: ICON },
  ];

  // A block whose `feature` flag is switched off is hidden from every palette.
  const featureOn = (b) => {
    if (!b.feature) return true;
    const flags = (typeof window !== 'undefined' && window.EditorFeatures) ? window.EditorFeatures
      : (typeof globalThis !== 'undefined' ? globalThis.EditorFeatures : null);
    return !flags || flags[b.feature] !== false;
  };

  // ---- helper accessors -----------------------------------------------------
  const byType = (type) => BLOCKS.find((b) => b.type === type) || null;

  // Group blocks (filtered by a boolean flag, e.g. 'inSidebar' / 'inInlineMenu')
  // into palette sections, preserving first-seen category order.
  const sections = (flag) => {
    const order = [];
    const map = new Map();
    BLOCKS.forEach((b) => {
      if (!b[flag] || !b.category || !featureOn(b)) return;
      if (!map.has(b.category)) {
        map.set(b.category, []);
        order.push(b.category);
      }
      map.get(b.category).push({ type: b.type, label: b.label, icon: b.icon });
    });
    return order.map((title) => ({ title, items: map.get(title) }));
  };

  const repeaterTypes = () => BLOCKS.filter((b) => b.isRepeater).map((b) => b.type);
  const restrictedInFlexibleTypes = () => BLOCKS.filter((b) => b.restrictInFlexible).map((b) => b.type);

  const aliasFor = (type) => {
    const b = byType(type);
    return (b && b.alias) || 'item';
  };

  // Build the { blockType: [styleProps] } map, including legacy label keys.
  // A legacy key may be a plain string (reuses the block's styleProps) or an
  // object { key, styleProps } when the old key needs a different prop set.
  const styleConfig = () => {
    const cfg = {};
    BLOCKS.forEach((b) => {
      cfg[b.type] = b.styleProps;
      (b.legacyKeys || []).forEach((k) => {
        if (typeof k === 'string') cfg[k] = b.styleProps;
        else if (k && k.key) cfg[k.key] = k.styleProps || b.styleProps;
      });
    });
    return cfg;
  };

  const api = {
    blocks: BLOCKS,
    byType,
    sections,
    repeaterTypes,
    restrictedInFlexibleTypes,
    aliasFor,
    styleConfig,
  };

  // Expose on whichever global object is available (window in both contexts).
  if (typeof window !== 'undefined') window.FormBlockRegistry = api;
  if (typeof globalThis !== 'undefined') globalThis.FormBlockRegistry = api;
})();
