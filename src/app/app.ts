import { AfterViewInit, ChangeDetectorRef, Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CanvasComponent } from './canvas/canvas';
import { IconPickerComponent } from './icon-picker.component';
import { ConditionEditorComponent } from './condition-editor.component';
import { ImageCropperComponent } from './image-cropper.component';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { buildExportFile, downloadJson, sanitizeFilename, parseImportFile, readFileText, type ExportFile } from './template-io';

type ToolbarAction = {
  label: string;
  icon: string;
  variant?: 'ghost' | 'outline' | 'primary';
};

type DragPayload = {
  blockType: string;
  label: string;
  // Reusable-component drags carry the saved cs_block_s HTML; the canvas builds
  // the block from this instead of the block factory.
  kind?: string;
  componentHtml?: string;
};

type LibrarySection = {
  title: string;
  items: ReadonlyArray<{
    type: string;
    label: string;
    icon: string;
  }>;
};

// Shape of the shared block registry exposed on window by block-registry.js
// (loaded in index.html before Angular bootstraps).
type BlockRegistryApi = {
  sections: (flag: 'inSidebar' | 'inInlineMenu') => LibrarySection[];
  styleConfig: () => Record<string, string[]>;
  aliasFor: (type: string) => string;
  repeaterTypes: () => string[];
  restrictedInFlexibleTypes: () => string[];
};

const blockRegistry = (): BlockRegistryApi | null =>
  (globalThis as any).FormBlockRegistry ?? null;

type PredefineTemplate = {
  label: string;
  imageUrl?: string;
  templateId: string;
};

type DesignBackup = {
  id: string;
  timestamp: number;
  html: string;
  thumbnail: string;
  label: string;
};

// A user-saved canvas — either as a reusable Template or a personal Design.
type SavedItem = {
  id: string;
  name: string;
  timestamp: number;
  html: string;
  thumbnail: string;
};

// A reusable component — a single block or a container/group, saved for reuse.
type SavedComponent = {
  id: string;
  name: string;
  kind: 'single' | 'group';
  html: string;
  thumbnail: string;
  timestamp: number;
};

type HistoryControl = {
  action: 'undo' | 'redo';
  icon: string;
  label: string;
};

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, CanvasComponent, IconPickerComponent, ConditionEditorComponent, ImageCropperComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  // The block palette / style config are built from window.FormBlockRegistry,
  // which only exists in the browser. Skip hydration for the whole editor so the
  // server (no registry) and client (full registry) can't mismatch. Must live on
  // the component host — NG0504 forbids it on plain template elements.
  host: { ngSkipHydration: 'true' }
})
export class App implements AfterViewInit {
  protected readonly brandName = 'PDF Builder';
  protected readonly documentTitle = 'My Brochure';
  protected readonly leftTabs = ['Components', 'Templates', 'History', 'Saved templates', 'My Components'];
  protected activeLeftTab = 'Components';
  // protected readonly leftTabs = ['Components', 'Layers', 'Pages'];
  protected readonly rightTabs = ['Properties', 'Data Binding', 'Style', 'Brand']; //Layers <------- add this for layer
  protected activeRightTab = 'Properties';
  protected mobileLeftOpen = false;
  protected mobileRightOpen = false;
  protected activeBlock: any = null;

  // -------- Layers panel (Cover Page Photoshop-style layer tree) --------
  // Flattened (depth-tagged) rows of the active cover page's layer tree, top
  // layer first. Built from the iframe's `layers:tree` broadcast.
  protected layerTreeNodes: any[] = [];
  protected layerRows: Array<{ id: string; label: string; type: string; depth: number; selected: boolean; hidden: boolean; locked: boolean; thumb: string | null; hasChildren: boolean; collapsed: boolean }> = [];
  protected layersPageId: string | null = null;
  protected activeLayerId: string | null = null;
  protected collapsedLayerIds = new Set<string>();
  protected layerDragId: string | null = null;
  protected layerDropTargetId: string | null = null;
  protected layerDropPosition: 'before' | 'after' | null = null;
  protected editingLayerId: string | null = null;
  protected blockStyleValues: Record<string, string> = {};
  // The clicked table cell + its row, surfaced when a Table block is selected
  // so each can carry its own show-condition (data-twig-if).
  protected activeTableTarget: {
    cellId: string;
    cellTag: string;
    cellCondition: string;
    rowId: string;
    rowCondition: string;
  } | null = null;

  // =========================================================================
  // History/Backup State
  // ===================================.=====================================
  private readonly BACKUP_INTERVAL_MS = 50 * 60 * 1000;
  private readonly BACKUP_STORAGE_KEY = 'brochureflow:design-backups:v1';
  private readonly MAX_BACKUPS = 20;
  protected backupList: DesignBackup[] = [];
  protected selectedBackupId: string | null = null;
  private backupIntervalId: any = null;

  // Saved templates (manual "Save as"). Persisted to localStorage.
  private readonly SAVED_TEMPLATES_KEY = 'brochureflow:saved-templates:v1';
  protected savedTemplates: SavedItem[] = [];
  protected saveAsOpen = false;
  protected saveAsName = '';

  // Read-only design preview (all pages, scaled down, rendered in an iframe
  // with the editor's own stylesheets so it looks exactly like the design).
  protected previewOpen = false;
  protected previewZoom = 0.5;
  protected previewSrcdoc: SafeHtml | null = null;

  // Reusable component library.
  private readonly COMPONENTS_KEY = 'brochureflow:components:v1';
  protected savedComponents: SavedComponent[] = [];
  protected componentModalOpen = false;

  // -------- Brand Kit (global palette + fonts) --------
  // A saved brand: 5 palette colours + heading/body fonts. Surfaced as quick
  // swatches in the Style panel (concrete colours, export-safe) and an "Apply
  // fonts" sweep. Persisted to localStorage.
  private readonly BRAND_KIT_KEY = 'brochureflow:brand-kit:v1';
  protected brandKit: { colors: string[]; headingFont: string; bodyFont: string } = {
    colors: ['#248567', '#1b2030', '#e0852f', '#1f2937', '#f4f5fb'],
    headingFont: "'Poppins', sans-serif",
    bodyFont: "'Poppins', sans-serif",
  };
  protected readonly brandColorLabels = ['Primary', 'Dark', 'Accent', 'Text', 'Light'];
  protected readonly brandFontOptions: { value: string; label: string }[] = [
    { value: "'Poppins', sans-serif", label: 'Poppins' },
    { value: "'Inter', sans-serif", label: 'Inter' },
    { value: "'Roboto', sans-serif", label: 'Roboto' },
    { value: "'Montserrat', sans-serif", label: 'Montserrat' },
    { value: "'Lato', sans-serif", label: 'Lato' },
    { value: "'Open Sans', sans-serif", label: 'Open Sans' },
    { value: "'Raleway', sans-serif", label: 'Raleway' },
    { value: "'Nunito', sans-serif", label: 'Nunito' },
    { value: "'Sora', sans-serif", label: 'Sora' },
    { value: "'Playfair Display', serif", label: 'Playfair Display' },
    { value: 'Georgia, serif', label: 'Georgia' },
    { value: 'Arial, sans-serif', label: 'Arial' },
  ];
  protected readonly brandPresets: { name: string; colors: string[]; headingFont: string; bodyFont: string }[] = [
    { name: 'Emerald', colors: ['#248567', '#0f2e25', '#e0852f', '#1f2937', '#f3faf7'], headingFont: "'Poppins', sans-serif", bodyFont: "'Poppins', sans-serif" },
    { name: 'Indigo', colors: ['#5c5cff', '#1b2030', '#f59e0b', '#1f2937', '#eef0ff'], headingFont: "'Montserrat', sans-serif", bodyFont: "'Inter', sans-serif" },
    { name: 'Ocean', colors: ['#0ea5e9', '#0f172a', '#f43f5e', '#0f172a', '#f1f5f9'], headingFont: "'Sora', sans-serif", bodyFont: "'Open Sans', sans-serif" },
    { name: 'Classic', colors: ['#8a6d3b', '#3b2f2f', '#b91c1c', '#222222', '#faf7f0'], headingFont: "'Playfair Display', serif", bodyFont: "'Lato', sans-serif" },
  ];
  protected componentName = '';
  private pendingComponent: { html: string; kind: 'single' | 'group'; thumbnail: string } | null = null;

  // Per-block style controls — derived from the shared block registry. Edit a
  // block's `styleProps` there and the right-hand properties panel updates.
  protected readonly blockStyleConfig: Record<string, string[]> =
    blockRegistry()?.styleConfig() ?? {};

  // Image-frame shapes for the picker shown only when an image block is
  // selected (activeBlock.isImage). `key` matches the .image-container.<key>
  // class in editor.css; `clip` is the CSS clip-path used for the little
  // preview swatch so the panel mirrors the actual frame.
  protected readonly imageFrames: ReadonlyArray<{ key: string; label: string; round?: string; clip?: string }> = [
    { key: 'square-image', label: 'Square', round: '0' },
    { key: 'rounded-square-image', label: 'Round', round: '8px' },
    { key: 'circle-image', label: 'Ellipse', round: '50%' },
    { key: 'polygon', label: 'Polygon', clip: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)' },
    { key: 'star', label: 'Star', clip: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' },
  ];

  // PDF page settings — shown in the Properties panel when no block is
  // selected. Values are sent to /api/save-twig-puppeteer. The same
  // pageSize value drives the editor canvas (.cs_margin) live via
  // window.setCanvasPageSize().
  protected readonly pageSizes = [
    'A4',
    'A4-Landscape',
    'Letter',
    'Letter-Landscape',
  ] as const;
  protected readonly pageSizeLabels: Record<string, string> = {
    'A4': 'A4 Portrait',
    'A4-Landscape': 'A4 Landscape',
    'Letter': 'Letter Portrait',
    'Letter-Landscape': 'Letter Landscape',
  };
  protected pdfSettings = {
    pageSize: 'A4' as typeof this.pageSizes[number],
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    enableHeaderFooter: true,
    enableInlineInsert: true,
    inlineTextToolbar: true, // ON → rich-text toolbar floats above the block; OFF → docks to canvas top
    enableComments: true,    // collab: show comment button + pins
    enablePresence: true,    // collab: live cursors + avatars
    pageBackgroundImage: '',
  };
  protected readonly frameUrl: SafeResourceUrl;
  // When the app is embedded by the proposal-studio npm package, the canvas
  // engine HTML is injected as a global string before bootstrap so the iframe
  // is fully self-contained (no /custom-form/* asset path needed). Falls back
  // to frameUrl when the global is absent (normal dev app behaviour).
  protected readonly frameSrcdoc: SafeHtml | null = null;
  protected iframeHeight = 1123;
  // Page counter for the status-bar footer + Delete-page button. Driven by
  // 'page:count' / 'page:active' messages from the editor iframe.
  protected pageCount = 1;
  protected currentPage = 1;
  protected latestTwigCode: string = '';
  protected availableFields: { key: string; kind: string; expr: string }[] = [];
  // Loop-alias relative paths (e.g. 'item.price') for the active scope, fed as
  // priority suggestions to the condition editors. Kept as a stable array so
  // the editor only reconfigures when the scope actually changes.
  protected conditionScopedPaths: string[] = [];
  protected availableFieldsRepeatPath: string = '';
  protected availableFieldsAlias: string = '';
  protected availableFieldsLoopDepth: number = 0;
  protected fieldCopyFeedback: string | null = null;

  // -------- Data Binding panel (right sidebar) --------
  protected dataBindingView: 'tree' | 'json' = 'tree';
  protected dataBindingSearch: string = '';
  protected dataBindingCopyFeedback: string | null = null;
  protected dataBindingExpanded: Record<string, boolean> = {};

  // -------- Binding modal (full-page, parent-rendered) --------
  protected bindingModalOpen = false;
  protected bindingModalBlockId: string = '';
  protected bindingModalBlockType: string = '';
  protected bindingModalArrays: {
    path: string;
    count: number;
    preview: string;
    depth?: number;
    chain?: { path: string; alias: string }[];
    scope?: 'root' | 'ancestor';
    ancestorAlias?: string;
  }[] = [];
  protected bindingModalSelectedPath: string = '';
  protected bindingModalAlias: string = 'item';
  protected bindingModalAncestorAlias: string = '';
  protected bindingModalDisabledPaths: string[] = [];

  constructor(private readonly sanitizer: DomSanitizer, private readonly cdr: ChangeDetectorRef) {
    this.frameUrl = this.sanitizer.bypassSecurityTrustResourceUrl('/custom-form/custom-form.html');
    const injected =
      typeof window !== 'undefined' ? (window as any).__PS_CANVAS_SRCDOC__ : null;
    if (typeof injected === 'string' && injected.length > 0) {
      this.frameSrcdoc = this.sanitizer.bypassSecurityTrustHtml(injected);
    }
  }

  @HostListener('window:message', ['$event'])
  protected onMessage(event: MessageEvent): void {
    const msg = event.data;
    if (!msg || msg.source !== 'custom-form-twig') return;

    if (msg.type === 'header-footer:state') {
      this.pdfSettings.enableHeaderFooter = msg.enabled;
    }
    if (msg.type === 'inline-insert:state') {
      this.pdfSettings.enableInlineInsert = msg.enabled;
    }
    if (msg.type === 'collab:ready') {
      this.sendCollabConfig();
    }
    if (msg.type === 'component:captured') {
      this.onComponentCaptured(msg.data);
    }
    if (msg.type === 'twig:updated') {
      this.latestTwigCode = msg.data.twig;
    }
    if (msg.type === 'page:count' && typeof msg.count === 'number') {
      this.pageCount = Math.max(1, msg.count);
    }
    if (msg.type === 'page:active') {
      if (typeof msg.index === 'number' && msg.index > 0) this.currentPage = msg.index;
      if (typeof msg.total === 'number') this.pageCount = Math.max(1, msg.total);
      // Reflect THIS page's own background image in the panel preview.
      if ('bgImage' in msg) this.pdfSettings.pageBackgroundImage = msg.bgImage || '';
    }
    if (msg.type === 'page:removed') {
      if (typeof msg.count === 'number') this.pageCount = Math.max(1, msg.count);
      if (!msg.ok) {
        const reason = msg.reason === 'last'
          ? 'At least one page is required.'
          : 'No page selected to delete. Scroll to the page you want to remove first.';
        alert(reason);
      }
    }
    if (msg.type === 'selection:changed') {
      this.activeBlock = msg.data;
      this.blockStyleValues = msg.data.styles || {};
      // If this is a table, include tableBorder and tableBorderColor in blockStyleValues
      if ((msg.data.blockType === 'Table' || msg.data.blockType === 'table-repeater')) {
        if (msg.data.tableBorderWidth) {
          this.blockStyleValues['tableBorder'] = msg.data.tableBorderWidth;
        }
        if (msg.data.tableBorderColor) {
          this.blockStyleValues['tableBorderColor'] = msg.data.tableBorderColor;
        }
      }
    }
    if (msg.type === 'selection:cleared') {
      this.activeBlock = null;
      this.blockStyleValues = {};
      this.activeTableTarget = null;
      this.activeLayerId = null;
      // Keep the Layers tab open if the user is working in it.
      if (this.activeRightTab !== 'Layers') this.activeRightTab = 'Properties';
    }
    if (msg.type === 'layers:tree') {
      this.layersPageId = msg.data?.pageId || null;
      this.activeLayerId = msg.data?.selectedId || null;
      this.layerTreeNodes = msg.data?.nodes || [];
      this.rebuildLayerRows();
    }
    if (msg.type === 'table-target:changed') {
      this.activeTableTarget = msg.data;
    }
    if (msg.type === 'table-target:cleared') {
      this.activeTableTarget = null;
    }
    if (msg.type === 'fields:available') {
      this.availableFields = msg.data.fields || [];
      this.conditionScopedPaths = this.availableFields.map((f) => f.expr);
      this.availableFieldsRepeatPath = msg.data.repeatPath || '';
      this.availableFieldsAlias = msg.data.repeatAlias || 'item';
      this.availableFieldsLoopDepth = Array.isArray(msg.data.ancestorChain)
        ? msg.data.ancestorChain.length
        : 0;
    }
    if (msg.type === 'fields:cleared') {
      this.availableFields = [];
      this.conditionScopedPaths = [];
      this.availableFieldsRepeatPath = '';
      this.availableFieldsAlias = '';
      this.availableFieldsLoopDepth = 0;
    }
    if (msg.type === 'binding-modal:open') {
      this.bindingModalBlockId = msg.data.blockId;
      this.bindingModalBlockType = msg.data.blockType || 'block';
      this.bindingModalArrays = msg.data.arrays || [];
      this.bindingModalAncestorAlias = msg.data.ancestorAlias || '';
      this.bindingModalDisabledPaths = msg.data.disabledPaths || [];
      this.bindingModalSelectedPath = '';
      this.bindingModalAlias = this.defaultAliasFor(this.bindingModalBlockType);
      this.bindingModalOpen = true;
    }
    if (msg.type === 'iframe:height' && typeof msg.height === 'number') {
      // Resize the iframe so all stacked pages are visible without an
      // inner scrollbar; the outer .canvas-stage handles scrolling.
      const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
      if (iframe) iframe.style.height = `${msg.height}px`;
    }

    if (msg.type === 'iframe:height') {
      this.iframeHeight = msg.height;
    }

    // Zoom shortcut pressed while focus was inside the editor iframe — the
    // iframe already blocked the browser's native zoom; apply ours here.
    if (msg.type === 'editor:zoom' && (msg.dir === 'in' || msg.dir === 'out' || msg.dir === 'reset')) {
      this.applyZoomDir(msg.dir);
    }
  }

  // Select an ancestor block in the canvas (the "Choose parent <name>" buttons
  // rendered from activeBlock.parents). The iframe resolves the id and selects
  // it, which echoes a fresh selection:changed back to refresh this panel.
  protected selectParent(blockId: string): void {
    if (!blockId) return;
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'block:select',
      blockId,
    }, '*');
  }

  protected hasProp(prop: string): boolean {
    if (!this.activeBlock?.blockType) return false;
    const props = this.blockStyleConfig[this.activeBlock.blockType] || [];
    return props.includes(prop);
  }

  protected getActiveBlockProps(): string[] {
    if (!this.activeBlock?.blockType) return [];
    return this.blockStyleConfig[this.activeBlock.blockType] || [];
  }

  protected onStyleChange(prop: string, value: string): void {
    if (!this.activeBlock?.blockId) return;
    this.blockStyleValues[prop] = value;

    // Handle table border specially
    if (prop === 'tableBorder' || prop === 'tableBorderColor') {
      const borderWidth = prop === 'tableBorder' ? value : (this.activeBlock.tableBorderWidth || '1px');
      const borderColor = prop === 'tableBorderColor' ? value : (this.activeBlock.tableBorderColor || '#000000');
      this.updateTableBorderParams(borderWidth, borderColor);
      return;
    }

    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    if (iframe) {
      iframe.contentWindow?.postMessage({
        target: 'custom-form-twig',
        type: 'set-block-style',
        blockId: this.activeBlock.blockId,
        prop,
        value,
      }, '*');
    }
  }

  // Apply a frame shape to the selected image block. Tells the iframe to swap
  // the .image-container shape class; the image + its zoom/pan stay intact.
  protected onImageFrameChange(shape: string): void {
    if (!this.activeBlock?.blockId) return;
    this.activeBlock.imageFrame = shape; // optimistic highlight; echoed back too
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'set-image-frame',
      blockId: this.activeBlock.blockId,
      shape,
    }, '*');
  }

  private defaultAliasFor(blockType: string): string {
    return blockRegistry()?.aliasFor(blockType) ?? 'item';
  }

  protected onHeaderFooterToggle(enabled: boolean): void {
    this.pdfSettings.enableHeaderFooter = enabled;
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'header-footer:toggle',
      enabled: enabled
    }, '*');
  }

  protected onInlineInsertToggle(enabled: boolean): void {
    this.pdfSettings.enableInlineInsert = enabled;
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'inline-insert:toggle',
      enabled
    }, '*');
  }

  // Rich-text (CustomRichEditor) toolbar placement.
  //   ON  → inline: bar floats above the block being edited (default).
  //   OFF → docked: bar pins to the top of the canvas viewport.
  protected onInlineTextToolbarToggle(enabled: boolean): void {
    this.pdfSettings.inlineTextToolbar = enabled;
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'rich-toolbar:dock',
      docked: !enabled
    }, '*');
  }

  // --- Per-page background image (with crop) -------------------------------
  // The image is applied to the page the user is currently viewing (content OR
  // cover), not globally. Upload → crop modal → apply to the active page.
  protected cropperOpen = false;
  protected cropperSrc = '';
  protected cropperRatio: number | null = null;

  protected onPageBgImageUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      // Open the cropper; the page only changes once the user applies a crop.
      this.cropperSrc = e.target?.result as string;
      this.cropperRatio = this.pageAspect();
      this.cropperOpen = true;
      // FileReader.onload is a raw async callback — in this zoneless app it does
      // NOT trigger change detection, so without this nudge the modal wouldn't
      // appear until the next click. markForCheck schedules a CD tick.
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
    input.value = ''; // allow re-selecting the same file later
  }

  protected onCropApplied(dataUrl: string): void {
    this.cropperOpen = false;
    this.cropperSrc = '';
    this.pdfSettings.pageBackgroundImage = dataUrl; // panel preview
    this.sendPageBgToIframe(dataUrl);               // apply to the active page
  }

  protected onCropCancelled(): void {
    this.cropperOpen = false;
    this.cropperSrc = '';
  }

  protected removePageBgImage(): void {
    this.pdfSettings.pageBackgroundImage = '';
    this.sendPageBgToIframe('');
  }

  // Page width/height ratio for the cropper's "Page" preset.
  private pageAspect(): number {
    const portrait = 794 / 1123, letter = 816 / 1056;
    switch (this.pdfSettings.pageSize) {
      case 'A4-Landscape': return 1 / portrait;
      case 'Letter': return letter;
      case 'Letter-Landscape': return 1 / letter;
      default: return portrait; // A4 portrait
    }
  }

  // Delete the page the user is currently viewing. The iframe resolves which
  // page is active (scroll-tracked) and enforces the guards (page 1 + last page
  // can't be removed), replying via a 'page:removed' message handled in onMessage.
  protected deleteCurrentPage(): void {
    if (this.pageCount <= 1) return;
    if (!confirm(`Delete page ${this.currentPage}? This can’t be undone.`)) return;
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'page:remove-active',
    }, '*');
  }

  // Clear the content of the current page but keep the page itself. The iframe
  // removes the dropped blocks/rows while preserving header/footer + background.
  protected clearCurrentPage(): void {
    if (!confirm(`Clear all content on page ${this.currentPage}? The blocks will be removed but the page stays.`)) return;
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'page:clear-active',
    }, '*');
  }

  private sendPageBgToIframe(imageUrl: string): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'page-bg:set-active', // applies to the active page (content OR cover)
      imageUrl
    }, '*');
  }

  protected openPageShapeDesigner(): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'page-shape:open'
    }, '*');
  }

  protected removePageShape(): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'page-shape:clear'
    }, '*');
  }

  protected bindingModalTitle(): string {
    switch (this.bindingModalBlockType) {
      case 'section-container': return 'Bind Section Loop';
      case 'table-repeater': return 'Bind Table Loop';
      case 'list-repeater': return 'Bind List Loop';
      default: return 'Bind Block Loop';
    }
  }

  protected selectBindingArray(path: string): void {
    if (this.isBindingPathDisabled(path)) return;
    this.bindingModalSelectedPath = path;
  }

  protected isBindingPathDisabled(path: string): boolean {
    return this.bindingModalDisabledPaths.includes(path);
  }

  private selectedArrayItem() {
    return this.bindingModalArrays.find((a) => a.path === this.bindingModalSelectedPath);
  }

  // Build the final chain that gets persisted on the block. The chain
  // describes every {% for %} loop needed to reach the selected array — for a
  // leaf depth-2 row that means 3 nested loops. The user only edits the
  // INNERMOST alias (the leaf); intermediate aliases stay as the heuristic
  // defaults produced by buildFullArrayTree.
  protected buildAppliedChain(): any[] {
    const item = this.selectedArrayItem();
    if (!item) return [];
    const baseChain = item.chain || [{ path: item.path, alias: this.bindingModalAlias || 'item' }];
    // Replace the innermost alias with whatever the user typed. Preserve
    // every other field on each step (e.g. `kind: 'map'`, `keyAlias` for
    // date-keyed map loops) — the twig generator and runtime resolver
    // need them to emit `{% for k, v in ... %}` and to walk the sample
    // data correctly.
    const copy = baseChain.map((s: any) => ({ ...s }));
    if (copy.length) {
      copy[copy.length - 1].alias = (this.bindingModalAlias || 'item').trim() || 'item';
    }
    return copy;
  }

  protected bindingModalGeneratedCode(): string {
    if (!this.bindingModalSelectedPath) return 'Select an array to see generated code';
    const chain = this.buildAppliedChain();
    if (!chain.length) return 'Select an array to see generated code';

    const innerAlias = chain[chain.length - 1].alias;
    let body = `  {{ ${innerAlias}.field }}`;
    // Wrap from innermost outward.
    for (let i = chain.length - 1; i >= 0; i--) {
      const step = chain[i];
      body = `{% for ${step.alias} in ${step.path} %}\n${body}\n{% endfor %}`;
      // Indent the body by two spaces per level for readability.
      if (i > 0) body = body.split('\n').map((l) => '  ' + l).join('\n');
    }
    return body;
  }

  protected applyBinding(): void {
    if (!this.bindingModalSelectedPath || !this.bindingModalBlockId) return;
    const chain = this.buildAppliedChain();
    if (!chain.length) return;
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'binding-modal:apply',
      blockId: this.bindingModalBlockId,
      // Innermost path/alias kept for backwards compatibility with code that
      // only reads data-repeat-path/-alias. The full chain is the source of
      // truth for the twig generator.
      path: chain[chain.length - 1].path,
      alias: chain[chain.length - 1].alias,
      chain
    }, '*');
    this.bindingModalOpen = false;
  }

  protected skipBinding(): void {
    this.bindingModalOpen = false;
  }

  protected copyFieldExpr(expr: string): void {
    // expr already contains {{ }}, so insert it directly without wrapping
    this.insertTextAtCursor(expr);
  }

  private insertTextAtCursor(text: string): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    if (!iframe) return;

    iframe.focus();

    const targetDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!targetDoc) return;

    const selection = targetDoc.getSelection?.();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.insertNode(targetDoc.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    const activeEditable = targetDoc.activeElement as HTMLElement | null;
    if (activeEditable && activeEditable.isContentEditable) {
      activeEditable.focus();
      const newSelection = targetDoc.getSelection?.();
      if (newSelection) {
        const range = targetDoc.createRange();
        range.selectNodeContents(activeEditable);
        range.collapse(false);
        newSelection.removeAllRanges();
        newSelection.addRange(range);

        const rangeForInsert = newSelection.getRangeAt(0);
        rangeForInsert.insertNode(targetDoc.createTextNode(text));
        rangeForInsert.collapse(false);
        newSelection.removeAllRanges();
        newSelection.addRange(rangeForInsert);
      }
    }
  }

  protected handleUtilityAction(label: string): void {
    if (label === 'Add Page') {
      let withHF = this.pdfSettings.enableHeaderFooter;
      if (this.pdfSettings.enableHeaderFooter) {
        withHF = confirm('Add page with header and footer?\n\nOK = with header/footer\nCancel = blank page');
      }
      const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
      iframe?.contentWindow?.postMessage({
        target: 'custom-form-twig',
        type: 'page:add',
        headerFooter: withHF,
      }, '*');
      return;
    }

    if (label === 'Delete Page') {
      this.deleteCurrentPage();
      return;
    }

    if (label === 'Clear Page') {
      this.clearCurrentPage();
      return;
    }

    if (label === 'Add Cover Page') {
      // Cover page is a free-move canvas (no header/footer prompt).
      const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
      iframe?.contentWindow?.postMessage({
        target: 'custom-form-twig',
        type: 'page:add-cover',
      }, '*');
      return;
    }

    if (label === 'Generate Twig Code' || label === 'Export HTML') {
      if (!this.latestTwigCode) {
        alert('No Twig code available. Please add some blocks to the canvas.');
        return;
      }
      const pdfWindow = window.open('', '_blank');
      fetch('/api/save-twig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twigCode: this.latestTwigCode,
          bindingData: this.bindingData,
          pdfSettings: this.pdfSettings
        })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.pdfUrl) {
            if (pdfWindow) {
              pdfWindow.location.href = data.pdfUrl;
            } else {
              window.location.href = data.pdfUrl;
            }
          } else {
            if (pdfWindow) pdfWindow.close();
            alert('Error generating PDF: ' + (data.error || 'unknown error'));
          }
        })
        .catch(err => {
          if (pdfWindow) pdfWindow.close();
          alert('Failed to export: ' + err);
        });
    }

    if (label === 'Generate PDF (Puppeteer)') {
      if (!this.latestTwigCode) {
        alert('No Twig code available. Please add some blocks to the canvas.');
        return;
      }
      const pdfWindow = window.open('', '_blank');
      fetch('/api/save-twig-puppeteer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twigCode: this.latestTwigCode,
          bindingData: this.bindingData,
          pdfSettings: this.pdfSettings
        })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.pdfUrl) {
            if (pdfWindow) {
              pdfWindow.location.href = data.pdfUrl;
            } else {
              window.location.href = data.pdfUrl;
            }
          } else {
            if (pdfWindow) pdfWindow.close();
            alert('Error generating Puppeteer PDF: ' + (data.error || 'unknown error'));
          }
        })
        .catch(err => {
          if (pdfWindow) pdfWindow.close();
          alert('Failed to export: ' + err);
        });
    }
  }

  protected handleToolbarAction(label: string): void {
    if (label === 'Delete' && this.activeBlock) {
      const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          target: 'custom-form-twig',
          type: 'delete-block',
          blockId: this.activeBlock.blockId
        }, '*');
      }
    }
  }

  protected updateCondition(expr: string): void {
    if (!this.activeBlock) return;
    this.activeBlock.twigIf = expr;
    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        target: 'custom-form-twig',
        type: 'set-condition',
        blockId: this.activeBlock.blockId,
        expr: expr
      }, '*');
    }
  }

  // Row/cell show-conditions reuse the same set-condition channel as blocks —
  // the iframe handler looks the element up by id, so a <tr>/<td> id works
  // exactly like a block id.
  private setElementCondition(elementId: string, expr: string): void {
    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'set-condition',
      blockId: elementId,
      expr
    }, '*');
  }

  protected updateRowCondition(expr: string): void {
    if (!this.activeTableTarget?.rowId) return;
    this.activeTableTarget.rowCondition = expr;
    this.setElementCondition(this.activeTableTarget.rowId, expr);
  }

  protected updateCellCondition(expr: string): void {
    if (!this.activeTableTarget?.cellId) return;
    this.activeTableTarget.cellCondition = expr;
    this.setElementCondition(this.activeTableTarget.cellId, expr);
  }

  protected updateTableBorderParams(width: string, color: string): void {
    if (!this.activeBlock) return;
    this.activeBlock.tableBorderWidth = width;
    this.activeBlock.tableBorderColor = color;
    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        target: 'custom-form-twig',
        type: 'set-table-border-params',
        blockId: this.activeBlock.blockId,
        borderWidth: width,
        borderColor: color
      }, '*');
    }
  }

  protected readonly bindingJsonString = `{
  "host": "https://fieldops.techservices.co.uk",
  "mainContent": {
    "accountNo": "ACC-009871",
    "jobNo": "JOB-20260507-043",
    "PONumber": "PO-2026-00341",
    "workaddressDetails": {
      "customerName": "Greenfield Logistics Ltd",
      "addressline1": "Unit 12, Meridian Business Park",
      "addressline2": "Whitmore Road",
      "addressline3": "Longbridge",
      "town": "Birmingham",
      "county": "West Midlands",
      "postcode": "B31 2TW"
    },
    "jobDetails": {
      "description": "<p>Emergency call-out for commercial HVAC system failure affecting warehouse temperature regulation. System reported offline since 06:00. Goods stored on-site are temperature-sensitive and require resolution within SLA window.</p>",
      "engineerNotes": "<p>On arrival, identified compressor fault on Unit 3 (rooftop). Compressor capacitor had failed. Replaced capacitor and tested full system run cycle. Also found refrigerant level low — topped up to manufacturer specification. System restored to full operation by 11:45. Recommended annual service contract to prevent recurrence.</p>",
      "jobCompletedDate": "07/05/2026",
      "jobCompletedTime": "11:50",
      "jobCompletedReason": "All HVAC units returned to full operational status. Customer satisfied. No further action required at this time."
    },
    "jobAssets": [
      "HVAC Unit 1 - Rooftop - Serial: HV-2019-110234",
      "HVAC Unit 2 - Rooftop - Serial: HV-2019-110235",
      "HVAC Unit 3 - Rooftop - Serial: HV-2020-220891",
      "Building Management System - BMS-CTL-004",
      "Warehouse Thermostat Array - Zone B & C"
    ],
    "visitDetails": [
      {
        "engineer": "Daniel Hartley",
        "diaryEventDate": "07/05/2026 08:00 - 12:00",
        "visitDate": "07/05/2026",
        "visitTime": "08:00",
        "duration": "4hrs",
        "visitDescription": "Emergency HVAC fault diagnosis. Customer reported complete cooling failure on warehouse floor overnight. Engineer attended to assess all three rooftop units and identify root cause.",
        "status": "8",
        "statusTime": {
          "Travelling": "07:40",
          "On Site": "08:10",
          "Completed": "11:50",
          "Closed": "12:00"
        },
        "arriveSignature": "https://fieldops.techservices.co.uk/signatures/arrive_sig_DH_20260507.png",
        "arriveCustomername": "Margaret Bryce",
        "arriveOnSiteFeedback": [
          {
            "name": "Is the site safe to enter?",
            "answered": "1",
            "answer": "Yes — PPE required in warehouse zone. Hard hat and hi-vis provided at entrance."
          },
          {
            "name": "Site access photo",
            "answered": "image",
            "answer": [
              {
                "value": "https://fieldops.techservices.co.uk/images/site_access_DH_20260507_001.jpg",
                "width": "1280",
                "height": "960"
              }
            ]
          },
          {
            "name": "Customer pre-visit signature",
            "answered": "signature",
            "answer": "https://fieldops.techservices.co.uk/signatures/pre_visit_sig_MB_20260507.png"
          },
          {
            "name": "Any hazards noted?",
            "answered": "1",
            "answer": "Rooftop access via fixed ladder — requires two-person rule. Forklift traffic active in warehouse. Engineer briefed on site induction."
          },
          {
            "name": "Are goods on site temperature-sensitive?",
            "answered": "1",
            "answer": "Yes — pharmaceutical cold chain products in Zone C. Advised site manager of urgency."
          }
        ],
        "toDosCompleted": [
          {
            "type": "Diagnosis",
            "description": "Full system inspection — Units 1, 2 and 3",
            "quantity": "1"
          },
          {
            "type": "Repair",
            "description": "Compressor capacitor replacement — Unit 3 (Part No. CAP-7742-HV)",
            "quantity": "1"
          },
          {
            "type": "Top-Up",
            "description": "Refrigerant recharge — R410A to 850g specification",
            "quantity": "1"
          },
          {
            "type": "Test",
            "description": "Full system run cycle verification — all zones",
            "quantity": "1"
          }
        ],
        "toDosNotCompleted": [
          {
            "type": "Service",
            "description": "Full annual service and coil clean — deferred to scheduled maintenance visit",
            "quantity": "1"
          }
        ],
        "leaveOnSiteFeedback": [
          {
            "name": "Was the job completed to your satisfaction?",
            "answered": "1",
            "answer": "Yes — system is back online, temperature in warehouse is recovering. Very pleased with the quick response."
          },
          {
            "name": "Leave site photo",
            "answered": "image",
            "answer": [
              {
                "value": "https://fieldops.techservices.co.uk/images/site_leave_DH_20260507_001.jpg",
                "width": "1280",
                "height": "960"
              }
            ]
          },
          {
            "name": "Customer leave signature",
            "answered": "signature",
            "answer": "https://fieldops.techservices.co.uk/signatures/leave_sig_MB_20260507.png"
          },
          {
            "name": "Any follow-up work identified?",
            "answered": "1",
            "answer": "Annual service recommended within 30 days. Site manager will contact office to schedule."
          }
        ],
        "leavesignaturemessage": "I confirm that Daniel Hartley attended site on 07/05/2026 and that all reported faults have been resolved to my satisfaction. I understand that a follow-up service visit is recommended.",
        "customerSignature": "https://fieldops.techservices.co.uk/signatures/customer_sig_MB_20260507.png",
        "engineerSignature": "https://fieldops.techservices.co.uk/signatures/engineer_sig_DH_20260507.png",
        "customername": "Margaret Bryce",
        "engineerFeedback": "<p>Attended site at 08:10 following emergency call for total HVAC failure. Inspected all three rooftop units. Units 1 and 2 running normally with minor dust accumulation on filters — noted for annual service. Unit 3 compressor not starting — diagnosed failed run capacitor (35µF/370V). Replaced with CAP-7742-HV from van stock. On restart, identified low refrigerant — charged with 850g R410A to restore to nameplate spec. Full system run cycle completed successfully. Zone B and C temperatures recovering at time of departure. Advised site manager to monitor and call back if temperatures do not stabilise within 2 hours. Recommended full annual service to prevent further unplanned downtime.</p>",
        "mileStoneData": {
          "showContent": true,
          "name": "Phase 1 — Emergency Fault Response",
          "description": "Emergency attendance to diagnose and resolve HVAC failure. Compressor capacitor replaced and refrigerant recharged. System restored to full operation."
        },
        "labourTimeDetails": {
          "date": {
            "07/05/2026": [
              {
                "engineerName": "Daniel Hartley",
                "typeOfName": "Diagnosis",
                "fromdatetime": "08:10",
                "todatetime": "09:00",
                "totalTimeDifference": "0.83",
                "mileage": 12
              },
              {
                "engineerName": "Daniel Hartley",
                "typeOfName": "Compressor Repair",
                "fromdatetime": "09:00",
                "todatetime": "10:30",
                "totalTimeDifference": "1.50",
                "mileage": 0
              },
              {
                "engineerName": "Daniel Hartley",
                "typeOfName": "Refrigerant Recharge",
                "fromdatetime": "10:30",
                "todatetime": "11:20",
                "totalTimeDifference": "0.83",
                "mileage": 0
              },
              {
                "engineerName": "Daniel Hartley",
                "typeOfName": "System Verification",
                "fromdatetime": "11:20",
                "todatetime": "11:50",
                "totalTimeDifference": "0.50",
                "mileage": 0
              }
            ]
          },
          "totalHours": "3.67",
          "totalMileage": 12
        }
      },
      {
        "engineer": "Priya Nair",
        "diaryEventDate": "08/05/2026 10:00 - 11:30",
        "visitDate": "08/05/2026",
        "visitTime": "10:00",
        "duration": "1.5hrs",
        "visitDescription": "Next-day follow-up visit to verify all HVAC units are maintaining correct temperatures and that the previous day's repair is holding under load.",
        "status": "8",
        "statusTime": {
          "Travelling": "09:45",
          "On Site": "10:05",
          "Completed": "11:30"
        },
        "arriveSignature": "https://fieldops.techservices.co.uk/signatures/arrive_sig_PN_20260508.png",
        "arriveCustomername": "Tom Gallagher",
        "arriveOnSiteFeedback": [
          {
            "name": "Is the site safe to enter?",
            "answered": "1",
            "answer": "Yes — site conditions unchanged from previous day."
          }
        ],
        "toDosCompleted": [
          {
            "type": "Check",
            "description": "Temperature log review — Zones A, B and C",
            "quantity": "1"
          },
          {
            "type": "Check",
            "description": "Unit 3 compressor performance verification under full load",
            "quantity": "1"
          },
          {
            "type": "Check",
            "description": "Refrigerant pressure readings — all three units",
            "quantity": "1"
          }
        ],
        "toDosNotCompleted": [],
        "leaveOnSiteFeedback": [
          {
            "name": "Any further issues reported?",
            "answered": "1",
            "answer": "No further issues. All zones holding temperature correctly. Engineer happy to close the job."
          }
        ],
        "leavesignaturemessage": "I confirm the follow-up inspection on 08/05/2026 has been completed and the HVAC system is operating normally. I am satisfied the repair has been successful.",
        "customerSignature": "https://fieldops.techservices.co.uk/signatures/customer_sig_TG_20260508.png",
        "engineerSignature": "https://fieldops.techservices.co.uk/signatures/engineer_sig_PN_20260508.png",
        "customername": "Tom Gallagher",
        "engineerFeedback": "<p>Attended for follow-up check. Reviewed BMS temperature logs — all three zones maintained target temperature of 12°C overnight and through morning. Unit 3 compressor running within normal parameters. Refrigerant pressures: suction 8.5 bar, discharge 27.2 bar — both within specification. No anomalies found. System confirmed stable. Job can be formally closed. Recommended scheduling annual service before end of June 2026.</p>",
        "mileStoneData": {
          "showContent": true,
          "name": "Phase 2 — Post-Repair Verification",
          "description": "Follow-up inspection confirming sustained system performance and successful repair. Job cleared for closure."
        },
        "labourTimeDetails": {
          "date": {
            "08/05/2026": [
              {
                "engineerName": "Priya Nair",
                "typeOfName": "Temperature Log Review",
                "fromdatetime": "10:05",
                "todatetime": "10:45",
                "totalTimeDifference": "0.67",
                "mileage": 8
              },
              {
                "engineerName": "Priya Nair",
                "typeOfName": "Compressor Performance Check",
                "fromdatetime": "10:45",
                "todatetime": "11:15",
                "totalTimeDifference": "0.50",
                "mileage": 0
              },
              {
                "engineerName": "Priya Nair",
                "typeOfName": "Refrigerant Pressure Verification",
                "fromdatetime": "11:15",
                "todatetime": "11:30",
                "totalTimeDifference": "0.25",
                "mileage": 0
              }
            ]
          },
          "totalHours": "1.42",
          "totalMileage": 8
        }
      }
    ],
    "slaDetails": [
      {
        "slaType": "Emergency Response SLA (4hr)",
        "isSlaBreached": false,
        "slaMetric": 4,
        "totalTime": "2hrs 10mins",
        "jobCreatedDateTime": "Job Created: 07/05/2026 06:00",
        "diaryCreatedDateTime": "Diary Created: 07/05/2026 06:15",
        "engineerArrivedDateTime": "Engineer Arrived: 07:10",
        "jobCompletedDateTime": "Job Completed: 07/05/2026 11:50",
        "expectedCompletionDateTime": "Expected Completion: 07/05/2026 10:00"
      },
      {
        "slaType": "Fix Time SLA (6hr)",
        "isSlaBreached": false,
        "slaMetric": 6,
        "totalTime": "5hrs 50mins",
        "jobCreatedDateTime": "Job Created: 07/05/2026 06:00",
        "diaryCreatedDateTime": "Diary Created: 07/05/2026 06:15",
        "engineerArrivedDateTime": "Engineer Arrived: 07/05/2026 08:10",
        "jobCompletedDateTime": "Job Completed: 07/05/2026 11:50",
        "expectedCompletionDateTime": "Expected Completion: 07/05/2026 12:00"
      },
      {
        "slaType": "Follow-Up Verification SLA (24hr)",
        "isSlaBreached": false,
        "slaMetric": 24,
        "totalTime": "22hrs 00mins",
        "jobCreatedDateTime": "Job Created: 07/05/2026 06:00",
        "diaryCreatedDateTime": "Diary Created: 07/05/2026 06:15",
        "engineerArrivedDateTime": "Engineer Arrived: 08/05/2026 10:05",
        "jobCompletedDateTime": "Job Completed: 08/05/2026 11:30",
        "expectedCompletionDateTime": "Expected Completion: 08/05/2026 06:00"
      }
    ],
    "installedParts": [
      {
        "partname": "Compressor Run Capacitor 35µF/370V (CAP-7742-HV)",
        "quantity": "1"
      },
      {
        "partname": "Refrigerant R410A — 850g Charge",
        "quantity": "1"
      },
      {
        "partname": "Capacitor Mounting Bracket — Heavy Duty",
        "quantity": "1"
      },
      {
        "partname": "Electrical Connector Kit — HVAC Grade",
        "quantity": "2"
      },
      {
        "partname": "Schrader Valve Core (Replacement)",
        "quantity": "2"
      }
    ],
    "attachedFiles": [
      {
        "name": "unit3_rooftop_before_repair.jpg",
        "type": "jpg",
        "location": "https://fieldops.techservices.co.uk/files/unit3_rooftop_before_repair.jpg"
      },
      {
        "name": "unit3_capacitor_replaced.jpg",
        "type": "jpg",
        "location": "https://fieldops.techservices.co.uk/files/unit3_capacitor_replaced.jpg"
      },
      {
        "name": "bms_temperature_log_07052026.pdf",
        "type": "pdf",
        "location": "https://fieldops.techservices.co.uk/files/bms_temperature_log_07052026.pdf"
      },
      {
        "name": "refrigerant_recharge_certificate.pdf",
        "type": "pdf",
        "location": "https://fieldops.techservices.co.uk/files/refrigerant_recharge_cert_07052026.pdf"
      },
      {
        "name": "hvac_system_post_repair_readings.png",
        "type": "png",
        "location": "https://fieldops.techservices.co.uk/files/hvac_post_repair_readings_08052026.png"
      }
    ],
    "labourTimeData": [
      {
        "labourTimeDetails": {
          "date": {
            "07/05/2026": [
              {
                "engineerName": "Daniel Hartley",
                "typeOfName": "Diagnosis",
                "fromdatetime": "08:10",
                "todatetime": "09:00",
                "totalTimeDifference": "0.83",
                "mileage": 12
              },
              {
                "engineerName": "Daniel Hartley",
                "typeOfName": "Compressor Repair",
                "fromdatetime": "09:00",
                "todatetime": "10:30",
                "totalTimeDifference": "1.50",
                "mileage": 0
              },
              {
                "engineerName": "Daniel Hartley",
                "typeOfName": "Refrigerant Recharge",
                "fromdatetime": "10:30",
                "todatetime": "11:20",
                "totalTimeDifference": "0.83",
                "mileage": 0
              },
              {
                "engineerName": "Daniel Hartley",
                "typeOfName": "System Verification",
                "fromdatetime": "11:20",
                "todatetime": "11:50",
                "totalTimeDifference": "0.50",
                "mileage": 0
              }
            ],
            "08/05/2026": [
              {
                "engineerName": "Priya Nair",
                "typeOfName": "Temperature Log Review",
                "fromdatetime": "10:05",
                "todatetime": "10:45",
                "totalTimeDifference": "0.67",
                "mileage": 8
              },
              {
                "engineerName": "Priya Nair",
                "typeOfName": "Compressor Performance Check",
                "fromdatetime": "10:45",
                "todatetime": "11:15",
                "totalTimeDifference": "0.50",
                "mileage": 0
              },
              {
                "engineerName": "Priya Nair",
                "typeOfName": "Refrigerant Pressure Verification",
                "fromdatetime": "11:15",
                "todatetime": "11:30",
                "totalTimeDifference": "0.25",
                "mileage": 0
              }
            ]
          },
          "totalHours": "5.08",
          "totalMileage": 20
        }
      }
    ],
    "settings": {
      "engineername": "1",
      "datetime": "1",
      "customersignature": "1",
      "engineersignature": "1",
      "customername": "1",
      "engineerfeedback": "1",
      "todoscompleted": "1",
      "todosnotcompleted": "1",
      "attachedfiles": "1",
      "showJobCompletedDetails": true,
      "showJobCompletedDateTime": true,
      "showJobCompletedReason": false,
      "showJobNotes": true,
      "showMileStone": true,
      "showEngineerStatusTimesToDisplay": "1",
      "showSLASection": true,
      "showSLADetails": 1,
      "leavesignaturemessage": "1",
      "showLabourTimeApproval": 1,
      "job_report_tableType": 536
    }
  }
}`;
  protected readonly bindingData = JSON.parse(this.bindingJsonString);
  protected readonly availableArrays = this.buildArrayPaths(this.bindingData);
  protected readonly availableVariables = this.buildVariablePaths(this.bindingData);
  // Flat list of just the path strings, fed to the CodeMirror condition editor
  // for autocomplete.
  protected readonly availableVariablePaths = this.availableVariables.map((v) => v.path);

  ngAfterViewInit(): void {
    if (typeof window !== 'undefined') {
      this.registerBindingData();
      this.exposeBindingGetter();
      this.applyCanvasPageSize(this.pdfSettings.pageSize);
      this.loadBackupHistory();
      this.loadSavedItems();
      this.loadBrandKit();
      this.startAutoBackup();

      // Ctrl/Cmd + wheel over the canvas zooms (like design tools).
      const stage = document.querySelector('.canvas-stage');
      if (stage) {
        stage.addEventListener('wheel', (e: Event) => {
          const we = e as WheelEvent;
          if (!we.ctrlKey && !we.metaKey) return;
          we.preventDefault();
          this.setZoom(this.canvasZoom * (we.deltaY < 0 ? 1.1 : 1 / 1.1));
        }, { passive: false });
      }
    }
  }

  /**
   * Switch the editor canvas to the selected paper size. Called from the
   * toolbar dropdown via ngModelChange. Existing block widths are kept
   * intact — only the .cs_margin page boundary resizes.
   */
  protected onPageSizeChange(value: string): void {
    this.pdfSettings.pageSize = value as typeof this.pageSizes[number];
    this.applyCanvasPageSize(value);
  }

  protected onMarginChange(): void {
    this.applyCanvasPageMargins();
  }

  // Width/height for each editor canvas size. Mirrors PageSizes in
  // public/custom-form/js/canvas-config.js so the outer iframe wrapper
  // can resize alongside the inner .cs_margin.
  private readonly canvasSizeDimensions: Record<string, { width: number; height: number }> = {
    'A4': { width: 794, height: 1123 },
    'A4-Landscape': { width: 1123, height: 794 },
    'Letter': { width: 816, height: 1056 },
    'Letter-Landscape': { width: 1056, height: 816 },
  };

  private applyCanvasPageSize(sizeKey: string): void {
    // 1. Resize the iframe wrapper in the parent document so a wider
    //    (landscape) page isn't clipped by canvas.scss's fixed width.
    const dims = this.canvasSizeDimensions[sizeKey] || this.canvasSizeDimensions['A4'];
    document.documentElement.style.setProperty('--editor-canvas-width', `${dims.width}px`);
    document.documentElement.style.setProperty('--editor-canvas-height', `${dims.height}px`);

    // 2. Tell the iframe to re-apply the same size internally so the
    //    .cs_margin inside the iframe matches. flow-canvas.js listens for
    //    'page-size:change' and calls window.setCanvasPageSize.
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    const send = () => {
      iframe?.contentWindow?.postMessage({
        target: 'custom-form-twig',
        type: 'page-size:change',
        sizeKey,
      }, '*');
    };
    if (iframe && iframe.contentDocument?.readyState === 'complete') {
      send();
    } else if (iframe) {
      iframe.addEventListener('load', send, { once: true });
    }
  }

  private applyCanvasPageMargins(): void {
    // Tell the iframe to apply page margins to the .cs_margin element
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    const send = () => {
      iframe?.contentWindow?.postMessage({
        target: 'custom-form-twig',
        type: 'page-margins:change',
        margins: {
          top: this.pdfSettings.marginTop,
          right: this.pdfSettings.marginRight,
          bottom: this.pdfSettings.marginBottom,
          left: this.pdfSettings.marginLeft,
        }
      }, '*');
    };
    if (iframe && iframe.contentDocument?.readyState === 'complete') {
      send();
    } else if (iframe) {
      iframe.addEventListener('load', send, { once: true });
    }
  }

  protected readonly historyControls = ['↩', '↪'];
  protected readonly toolbarActions: ReadonlyArray<ToolbarAction> = [
    { label: 'Group', icon: '⊞' },
    { label: 'Ungroup', icon: '⊟' },
    { label: 'Clone Group', icon: '⧉' },
    { label: 'Repeat Group', icon: '▣' },
    { label: 'Duplicate', icon: '⧉' },
    { label: 'Delete', icon: '✕' }
  ];
  protected readonly quickCanvasActions = ['≪', '◼', '≫'];
  protected readonly utilityActions: ReadonlyArray<ToolbarAction> = [
    // { label: 'New', icon: '✦', variant: 'ghost' },
    // { label: 'Preview', icon: '◉', variant: 'ghost' },
    { label: 'Add Page', icon: '＋', variant: 'ghost' },
    // { label: 'Add Cover Page', icon: '▭', variant: 'ghost' },
    // { label: 'Generate Twig Code', icon: '⬇', variant: 'primary' },
    { label: 'Generate PDF (Puppeteer)', icon: '⤓', variant: 'primary' },
    // { label: 'Load Template', icon: '', variant: 'ghost' },
    // { label: 'Twig', icon: '</>', variant: 'outline' }
  ];

  protected readonly predefineTemplates: ReadonlyArray<PredefineTemplate> = [
    { label: 'Invoice Template', imageUrl: '/custom-form/thumnails/templates1.png', templateId: 'predefine-template-1' },
    { label: 'Report Template', imageUrl: '/custom-form/thumnails/templates2.png', templateId: 'predefine-template-2' },
    { label: 'Letter Template', imageUrl: '/custom-form/thumnails/templates3.png', templateId: 'predefine-template-3' },
    { label: 'Quote Template', imageUrl: '/custom-form/thumnails/templates4.png', templateId: 'predefine-template-4' }

  ];

  // Sidebar palette — derived from the shared block registry. Add a block there
  // with `inSidebar: true` and it appears here automatically.
  protected readonly librarySections: ReadonlyArray<LibrarySection> =
    blockRegistry()?.sections('inSidebar') ?? [];

  protected blockTypeFromLabel(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  protected handleLibraryDragStart(event: DragEvent, label: string, icon?: string, type?: string): void {
    console.log('APP: handleLibraryDragStart called, label:', label, 'icon:', icon);
    const payload: DragPayload = {
      // Prefer the explicit registry type; fall back to deriving it from the
      // label (used by predefined templates that pass a templateId as label).
      blockType: type || this.blockTypeFromLabel(label),
      label
    };
    const serializedPayload = JSON.stringify(payload);
    console.log('APP: payload created:', payload);

    event.dataTransfer?.setData('application/x-brochure-block', serializedPayload);
    event.dataTransfer?.setData('text/plain', serializedPayload);

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';


      // incase dont want to drag icon hide this code start
      // Create a small drag image showing the block's actual icon (transparent)
      const dragImage = document.createElement('div');
      dragImage.style.cssText = `
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        font-weight: 600;
        position: absolute;
        top: -9999px;
        left: -9999px;
      `;
      // Use the actual block icon or fallback to generic icon
      dragImage.textContent = icon || '📦';
      document.body.appendChild(dragImage);

      // Set the drag image to show only the icon
      event.dataTransfer.setDragImage(dragImage, 20, 20);

      // Clean up the temporary element after drag ends
      setTimeout(() => document.body.removeChild(dragImage), 0);
      // incase dont want to drag icon hide this code end

    }

    (window as Window & { __BROCHURE_FLOW_DRAG__?: DragPayload }).__BROCHURE_FLOW_DRAG__ = payload;
  }

  protected handleLibraryDragEnd(): void {
    delete (window as Window & { __BROCHURE_FLOW_DRAG__?: DragPayload }).__BROCHURE_FLOW_DRAG__;
  }

  protected applyDataBinding(): void {
    this.registerBindingData();
  }

  private registerBindingData(): void {
    (window as any).__BROCHURE_FLOW_BINDING_DATA__ = this.bindingData;
    (window as any).__BROCHURE_FLOW_GET_BINDING_DATA__ = () => this.bindingData;
  }

  private exposeBindingGetter(): void {
    (window as any).__BROCHURE_FLOW_GET_BINDING_DATA__ = () => this.bindingData;
  }

  // =========================================================================
  // Backup & History Management
  // =========================================================================

  private loadBackupHistory(): void {
    try {
      const raw = localStorage.getItem(this.BACKUP_STORAGE_KEY);
      this.backupList = raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('Failed to load backup history:', e);
      this.backupList = [];
    }
  }

  private startAutoBackup(): void {
    this.backupIntervalId = setInterval(() => {
      this.createBackup();
    }, this.BACKUP_INTERVAL_MS);
  }

  protected createBackup(): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    if (!iframe || !iframe.contentDocument) return;

    const canvas = iframe.contentDocument.querySelector('.custom-form-design');
    if (!canvas) return;

    const html = canvas.innerHTML;
    const timestamp = Date.now();
    const id = `backup-${timestamp}`;
    const label = new Date(timestamp).toLocaleString();

    // Generate thumbnail by taking a screenshot of the canvas
    const thumbnail = this.generateThumbnail(iframe);

    const backup: DesignBackup = {
      id,
      timestamp,
      html,
      thumbnail,
      label
    };

    this.backupList.unshift(backup);
    if (this.backupList.length > this.MAX_BACKUPS) {
      this.backupList.pop();
    }

    try {
      localStorage.setItem(this.BACKUP_STORAGE_KEY, JSON.stringify(this.backupList));
    } catch (e) {
      console.warn('Failed to save backup:', e);
    }
  }

  private generateThumbnail(iframe: HTMLIFrameElement): string {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return '';

      const canvas = doc.querySelector('.custom-form-design');
      if (!canvas) return '';

      // Create a simple text-based thumbnail from first few blocks
      const blocks = Array.from(canvas.querySelectorAll('.cs_block_s')).slice(0, 3);
      const blockTexts = blocks
        .map(b => (b as HTMLElement).innerText?.slice(0, 20) || '...')
        .filter(t => t.length > 0);

      return blockTexts.length > 0 ? blockTexts.join(' • ') : 'Empty Design';
    } catch (e) {
      return 'Design Snapshot';
    }
  }

  protected restoreBackup(backupId: string): void {
    const backup = this.backupList.find(b => b.id === backupId);
    if (!backup) return;

    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    if (!iframe || !iframe.contentDocument) return;

    const canvas = iframe.contentDocument.querySelector('.custom-form-design');
    if (!canvas) return;

    canvas.innerHTML = backup.html;
    this.selectedBackupId = backupId;

    // Notify canvas that content was restored
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        target: 'custom-form-twig',
        type: 'draft:restored',
        data: { savedAt: new Date(backup.timestamp).toISOString() }
      }, '*');
    }
  }

  protected deleteBackup(backupId: string): void {
    this.backupList = this.backupList.filter(b => b.id !== backupId);
    if (this.selectedBackupId === backupId) {
      this.selectedBackupId = null;
    }

    try {
      localStorage.setItem(this.BACKUP_STORAGE_KEY, JSON.stringify(this.backupList));
    } catch (e) {
      console.warn('Failed to delete backup:', e);
    }
  }

  // =========================================================================
  // Save as Template / Design  (manual "Save as" button)
  // =========================================================================

  private loadSavedItems(): void {
    try { this.savedTemplates = JSON.parse(localStorage.getItem(this.SAVED_TEMPLATES_KEY) || '[]'); }
    catch { this.savedTemplates = []; }
    try { this.savedComponents = JSON.parse(localStorage.getItem(this.COMPONENTS_KEY) || '[]'); }
    catch { this.savedComponents = []; }
  }

  // ----- Reusable component library -----

  // Ask the canvas to snapshot the selected block; it replies with
  // 'component:captured' (handled in onMessage).
  protected saveAsComponent(): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({ target: 'custom-form-twig', type: 'component:capture' }, '*');
  }

  private onComponentCaptured(data: { html: string; kind: 'single' | 'group'; thumbnail: string } | null): void {
    if (!data) { alert('Select a block (or a section / container) on the canvas first.'); return; }
    this.pendingComponent = data;
    this.componentName = data.thumbnail?.slice(0, 24) || 'My component';
    this.componentModalOpen = true;
  }

  protected cancelSaveComponent(): void {
    this.componentModalOpen = false;
    this.pendingComponent = null;
  }

  protected confirmSaveComponent(): void {
    if (!this.pendingComponent) { this.componentModalOpen = false; return; }
    const item: SavedComponent = {
      id: `cmp-${Date.now()}`,
      name: (this.componentName || '').trim() || 'Untitled component',
      kind: this.pendingComponent.kind,
      html: this.pendingComponent.html,
      thumbnail: this.pendingComponent.thumbnail,
      timestamp: Date.now(),
    };
    this.savedComponents.unshift(item);
    try { localStorage.setItem(this.COMPONENTS_KEY, JSON.stringify(this.savedComponents)); }
    catch (e) { console.warn('Failed to persist components:', e); }
    this.componentModalOpen = false;
    this.pendingComponent = null;
    this.activeLeftTab = 'My Components';
  }

  protected insertComponent(id: string): void {
    const comp = this.savedComponents.find(c => c.id === id);
    if (!comp) return;
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({ target: 'custom-form-twig', type: 'component:insert', html: comp.html }, '*');
  }

  protected deleteComponent(id: string): void {
    this.savedComponents = this.savedComponents.filter(c => c.id !== id);
    this.persistComponents();
  }

  private persistComponents(): void {
    try { localStorage.setItem(this.COMPONENTS_KEY, JSON.stringify(this.savedComponents)); }
    catch (e) { console.warn('Failed to persist components:', e); }
  }

  // ----- Export / Import (share templates & components across users) -----

  protected exportSavedItem(id: string): void {
    const item = this.savedTemplates.find(i => i.id === id);
    if (!item) return;
    const file = buildExportFile('template', [{ name: item.name, html: item.html, thumbnail: item.thumbnail }]);
    downloadJson(`${sanitizeFilename(item.name)}.template.bflow.json`, file);
  }

  protected exportComponentItem(id: string): void {
    const c = this.savedComponents.find(x => x.id === id);
    if (!c) return;
    const file = buildExportFile('component', [{ name: c.name, html: c.html, thumbnail: c.thumbnail, kind: c.kind }]);
    downloadJson(`${sanitizeFilename(c.name)}.component.bflow.json`, file);
  }

  // Import handler shared by all three tabs — the file declares its own type.
  protected async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      const parsed = parseImportFile(await readFileText(file));
      const n = this.applyImport(parsed);
      alert(`Imported ${n} ${parsed.type}${n > 1 ? 's' : ''} successfully.`);
    } catch (e: any) {
      alert('Import failed: ' + (e?.message || e));
    }
  }

  private applyImport(file: ExportFile): number {
    let i = 0;
    file.items.forEach((it) => {
      const base = `${Date.now()}-${i++}`;
      if (file.type === 'component') {
        this.savedComponents.unshift({
          id: `cmp-${base}`, name: it.name || 'Imported component',
          kind: it.kind === 'group' ? 'group' : 'single',
          html: it.html, thumbnail: it.thumbnail || '', timestamp: Date.now(),
        });
      } else {
        // Templates (and any legacy 'design' export) import into Saved templates.
        this.savedTemplates.unshift({
          id: `template-${base}`, name: it.name || 'Imported template',
          html: it.html, thumbnail: it.thumbnail || '', timestamp: Date.now(),
        });
      }
    });
    if (file.type === 'component') { this.persistComponents(); this.activeLeftTab = 'My Components'; }
    else { this.persistSaved(); this.activeLeftTab = 'Saved templates'; }
    return file.items.length;
  }

  // Drag a saved component into the canvas (same DnD channel as the palette).
  protected handleComponentDragStart(event: DragEvent, comp: SavedComponent): void {
    const payload: DragPayload = { blockType: 'component', kind: 'component', componentHtml: comp.html, label: comp.name };
    const serialized = JSON.stringify(payload);
    event.dataTransfer?.setData('application/x-brochure-block', serialized);
    event.dataTransfer?.setData('text/plain', serialized);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';

    // Fallback for the dragover phase: browsers block dataTransfer.getData()
    // while a drag is in progress, so the canvas + synclist read the payload
    // from here to show the live drop indicator and resolve the pending target.
    // Without this a component dragged like a normal block but showed no
    // indicator and couldn't be dropped into a List. Cleared on dragend (the
    // template reuses handleLibraryDragEnd). Mirrors handleLibraryDragStart.
    (window as Window & { __BROCHURE_FLOW_DRAG__?: DragPayload }).__BROCHURE_FLOW_DRAG__ = payload;
  }

  private persistSaved(): void {
    try {
      localStorage.setItem(this.SAVED_TEMPLATES_KEY, JSON.stringify(this.savedTemplates));
    } catch (e) {
      console.warn('Failed to persist saved templates:', e);
    }
  }

  // Grab the current canvas HTML + a thumbnail (mirrors the backup capture).
  private captureCanvas(): { html: string; thumbnail: string } | null {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    if (!iframe || !iframe.contentDocument) return null;
    const canvas = iframe.contentDocument.querySelector('.custom-form-design');
    if (!canvas) return null;
    return { html: canvas.innerHTML, thumbnail: this.generateThumbnail(iframe) };
  }

  // Toggle real-time comment mode in the canvas (collab.js lives in the iframe).
  protected toggleComments(): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({ target: 'custom-form-twig', type: 'comment:toggle' }, '*');
  }

  // Push the current collab feature flags to the canvas (collab.js applies them).
  private sendCollabConfig(): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'collab:config',
      config: { comments: this.pdfSettings.enableComments, presence: this.pdfSettings.enablePresence },
    }, '*');
  }

  protected onCommentsToggle(enabled: boolean): void {
    this.pdfSettings.enableComments = enabled;
    this.sendCollabConfig();
  }

  protected onPresenceToggle(enabled: boolean): void {
    this.pdfSettings.enablePresence = enabled;
    this.sendCollabConfig();
  }

  protected openSaveAs(): void {
    this.saveAsName = `Template ${new Date().toLocaleDateString()}`;
    this.saveAsOpen = true;
  }

  protected cancelSaveAs(): void {
    this.saveAsOpen = false;
  }

  // ----- Read-only preview of the whole design -----

  // Open a scaled, read-only view of every page. The editor already stacks all
  // pages inside `.cs_paper`, so we clone that, strip editor-only chrome, and
  // render it in a sandbox iframe that reuses the iframe's own stylesheets — so
  // the preview matches the design exactly. Pages show one below another.
  protected openPreview(): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    const paper = doc?.querySelector('.cs_paper');
    if (!doc || !paper) {
      alert('Nothing to preview yet — add some content to the canvas first.');
      return;
    }

    const clone = paper.cloneNode(true) as HTMLElement;
    this.cleanForPreview(clone);

    // Reuse every stylesheet (links + injected <style>) the editor iframe loaded
    // so fonts, page sizing and block styling render identically.
    const head: string[] = [];
    doc.querySelectorAll('link[rel="stylesheet"]').forEach((l) => head.push(`<link rel="stylesheet" href="${(l as HTMLLinkElement).href}">`));
    doc.querySelectorAll('style').forEach((s) => head.push(`<style>${s.textContent || ''}</style>`));

    const previewCss = `
      html, body { margin: 0; padding: 0; background: #525659; }
      body { padding: 28px 0; }
      /* Static preview — never react to the pointer (no hover borders, no edit). */
      * { pointer-events: none !important; cursor: default !important; }
      .cs-block-badge, [data-cs-chrome] { display: none !important; }
      /* Scale the whole multi-page board down; pages stay stacked one by one. */
      .cs_paper { zoom: ${this.previewZoom}; margin: 0 auto; }
    `;
    const html = `<!doctype html><html><head><meta charset="utf-8">${head.join('')}<style>${previewCss}</style></head><body>${clone.outerHTML}</body></html>`;
    this.previewSrcdoc = this.sanitizer.bypassSecurityTrustHtml(html);
    this.previewOpen = true;
  }

  protected closePreview(): void {
    this.previewOpen = false;
    this.previewSrcdoc = null;
  }

  // Live zoom without rebuilding the iframe: the srcdoc is same-origin, so we
  // can set `.cs_paper`'s zoom directly.
  protected setPreviewZoom(z: number): void {
    this.previewZoom = Math.min(1.5, Math.max(0.2, Math.round(z * 10) / 10));
    const frame = document.querySelector('.preview-modal__frame') as HTMLIFrameElement | null;
    const paper = frame?.contentDocument?.querySelector('.cs_paper') as HTMLElement | null;
    paper?.style.setProperty('zoom', String(this.previewZoom));
  }

  // Remove editor-only chrome from a cloned board (mirrors stripChrome() in
  // common-twig-generator.js) so the preview shows just the design.
  private cleanForPreview(root: HTMLElement): void {
    root.querySelectorAll('[data-cs-chrome], .section-binding-info, .cs-block-badge').forEach((el) => el.remove());
    const stateClasses = ['cs-selected', 'cs-editing', 'canvas-block--selected', 'cs_selected', 'cs_selected_border', 'cs-aiden--active', 'cs-aiden--loading', 'drop-surface--active'];
    [root, ...Array.from(root.querySelectorAll(stateClasses.map((c) => '.' + c).join(',')))].forEach((el) => {
      el.classList?.remove(...stateClasses);
    });
    root.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  }

  // Save the current canvas as a Template, then jump to the Saved templates list.
  protected confirmSaveAs(): void {
    const cap = this.captureCanvas();
    if (!cap) { alert('Nothing to save yet — add some blocks to the canvas first.'); return; }

    const item: SavedItem = {
      id: `template-${Date.now()}`,
      name: (this.saveAsName || '').trim() || 'Untitled template',
      timestamp: Date.now(),
      html: cap.html,
      thumbnail: cap.thumbnail,
    };

    this.savedTemplates.unshift(item);
    this.persistSaved();
    this.activeLeftTab = 'Saved templates';
    this.saveAsOpen = false;
  }

  // Load a saved template back into the canvas (mirrors restoreBackup).
  protected loadSavedItem(id: string): void {
    const item = this.savedTemplates.find(i => i.id === id);
    if (!item) return;

    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    if (!iframe || !iframe.contentDocument) return;
    const canvas = iframe.contentDocument.querySelector('.custom-form-design');
    if (!canvas) return;

    canvas.innerHTML = item.html;
    iframe.contentWindow?.postMessage({
      target: 'custom-form-twig',
      type: 'draft:restored',
      data: { savedAt: new Date(item.timestamp).toISOString() }
    }, '*');
  }

  protected deleteSavedItem(id: string): void {
    this.savedTemplates = this.savedTemplates.filter(i => i.id !== id);
    this.persistSaved();
  }

  protected formatBackupTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - timestamp;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  protected triggerHistoryAction(action: 'undo' | 'redo'): void {
    this.postToCanvas(`history:${action}`);
  }

  /* ----------------------------- canvas zoom -------------------------------
   * Host-side CSS `zoom` on the app-canvas wrapper (see canvas.scss). Purely a
   * host concern — the iframe needs no message; its internal coordinate math is
   * unaffected because the iframe document itself isn't transformed. */
  protected canvasZoom = 1;
  private readonly ZOOM_MIN = 0.25;
  private readonly ZOOM_MAX = 3;

  protected get zoomPercent(): number {
    return Math.round(this.canvasZoom * 100);
  }

  protected setZoom(z: number): void {
    this.canvasZoom = Math.min(this.ZOOM_MAX, Math.max(this.ZOOM_MIN, Math.round(z * 100) / 100));
    document.documentElement.style.setProperty('--editor-zoom', String(this.canvasZoom));
  }

  protected zoomIn(): void { this.setZoom(this.canvasZoom + 0.1); }
  protected zoomOut(): void { this.setZoom(this.canvasZoom - 0.1); }
  protected zoomReset(): void { this.setZoom(1); }

  /**
   * Ctrl/⌘ + (＋ / − / 0) zooms the canvas instead of the browser page.
   * This fires only when focus is on the host chrome; when the user is inside
   * the editor iframe, that document forwards its own presses as an
   * 'editor:zoom' message (handled in onMessage). preventDefault blocks the
   * browser's native page zoom. As a HostListener it auto-triggers change
   * detection, so the {{ zoomPercent }} label stays in sync (zoneless app).
   */
  @HostListener('window:keydown', ['$event'])
  protected onZoomKeydown(e: KeyboardEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    const dir = this.zoomKeyDir(e);
    if (!dir) return;
    e.preventDefault();
    this.applyZoomDir(dir);
  }

  /** Map a Ctrl/⌘ key event to a zoom direction, or '' if it isn't one. */
  private zoomKeyDir(e: KeyboardEvent): 'in' | 'out' | 'reset' | '' {
    const k = e.key;
    if (k === '+' || k === '=' || e.code === 'NumpadAdd') return 'in';
    if (k === '-' || k === '_' || e.code === 'NumpadSubtract') return 'out';
    if (k === '0' || e.code === 'Numpad0' || e.code === 'Digit0') return 'reset';
    return '';
  }

  private applyZoomDir(dir: 'in' | 'out' | 'reset'): void {
    if (dir === 'in') this.zoomIn();
    else if (dir === 'out') this.zoomOut();
    else this.zoomReset();
  }

  /* ------------------------------- brand kit -------------------------------- */
  private loadBrandKit(): void {
    try {
      const raw = localStorage.getItem(this.BRAND_KIT_KEY);
      if (!raw) return;
      const k = JSON.parse(raw);
      if (k && Array.isArray(k.colors) && k.colors.length) {
        this.brandKit = {
          colors: k.colors.slice(0, 5),
          headingFont: k.headingFont || this.brandKit.headingFont,
          bodyFont: k.bodyFont || this.brandKit.bodyFont,
        };
      }
    } catch (e) { /* ignore corrupt entry */ }
  }

  private persistBrandKit(): void {
    try { localStorage.setItem(this.BRAND_KIT_KEY, JSON.stringify(this.brandKit)); } catch (e) { /* */ }
  }

  protected onBrandColorChange(i: number, value: string): void {
    this.brandKit.colors[i] = value;
    this.persistBrandKit();
  }

  protected onBrandFontChange(which: 'headingFont' | 'bodyFont', value: string): void {
    this.brandKit[which] = value;
    this.persistBrandKit();
  }

  protected applyBrandPreset(p: { colors: string[]; headingFont: string; bodyFont: string }): void {
    this.brandKit = { colors: [...p.colors], headingFont: p.headingFont, bodyFont: p.bodyFont };
    this.persistBrandKit();
  }

  // Restyle ALL text in the document to the brand fonts (concrete inline, so it
  // survives export). Heading blocks get the heading font; everything else the
  // body font.
  protected brandApplied = false;
  protected applyBrandFonts(): void {
    this.postToCanvas('brand:apply-fonts', {
      headingFont: this.brandKit.headingFont,
      bodyFont: this.brandKit.bodyFont,
    });
    this.brandApplied = true;
    setTimeout(() => { this.brandApplied = false; }, 2200);
  }

  private postToCanvas(type: string, extra: Record<string, unknown> = {}): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        target: 'custom-form-twig',
        type,
        ...extra,
      }, '*');
    }
  }

  protected selectLeftTab(tab: string): void {
    this.activeLeftTab = tab;
  }

  protected selectRightTab(tab: string): void {
    this.activeRightTab = tab;
    if (tab === 'Layers') this.postToIframe({ type: 'layers:request' });
  }

  protected openMobileLeft(): void {
    this.mobileLeftOpen = true;
    this.mobileRightOpen = false;
  }

  protected openMobileRight(): void {
    this.mobileRightOpen = true;
    this.mobileLeftOpen = false;
  }

  protected closeMobileDrawers(): void {
    this.mobileLeftOpen = false;
    this.mobileRightOpen = false;
  }

  // -------- Layers panel helpers --------
  private postToIframe(msg: Record<string, unknown>): void {
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({ target: 'custom-form-twig', ...msg }, '*');
  }

  // Flatten the nested layer tree (top-first) into depth-tagged rows for @for,
  // skipping the children of any collapsed node.
  private rebuildLayerRows(): void {
    const rows: typeof this.layerRows = [];
    const walk = (nodes: any[], depth: number) => {
      for (const n of nodes) {
        const collapsed = this.collapsedLayerIds.has(n.id);
        rows.push({
          id: n.id, label: n.label, type: n.type, depth,
          selected: !!n.selected, hidden: !!n.hidden, locked: !!n.locked,
          thumb: n.thumb || null, hasChildren: !!n.hasChildren, collapsed,
        });
        if (n.hasChildren && n.children?.length && !collapsed) {
          walk(n.children, depth + 1);
        }
      }
    };
    walk(this.layerTreeNodes, 0);
    this.layerRows = rows;
  }

  protected toggleLayerCollapse(event: Event, id: string): void {
    event.stopPropagation();
    if (this.collapsedLayerIds.has(id)) this.collapsedLayerIds.delete(id);
    else this.collapsedLayerIds.add(id);
    this.rebuildLayerRows();
  }

  protected lockLayer(event: Event, id: string): void {
    event.stopPropagation();
    if (id) this.postToIframe({ type: 'layers:lock', blockId: id });
  }

  protected duplicateLayer(event: Event, id: string): void {
    event.stopPropagation();
    if (id) this.postToIframe({ type: 'layers:duplicate', blockId: id });
  }

  protected deleteLayer(event: Event, id: string): void {
    event.stopPropagation();
    if (id) this.postToIframe({ type: 'layers:delete', blockId: id });
  }

  protected toggleLayerVisibility(event: Event, id: string): void {
    event.stopPropagation();
    if (!id) return;
    this.postToIframe({ type: 'layers:visibility', blockId: id });
  }

  protected startLayerRename(event: Event, id: string): void {
    event.stopPropagation();
    this.editingLayerId = id;
    // Focus + select the input once Angular has rendered it.
    setTimeout(() => {
      const input = document.querySelector('.layer-row__input') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    });
  }

  protected commitLayerRename(event: Event): void {
    const id = this.editingLayerId;
    this.editingLayerId = null;
    if (!id) return;
    const name = ((event.target as HTMLInputElement)?.value || '').trim();
    if (name) this.postToIframe({ type: 'layers:rename', blockId: id, name });
  }

  protected cancelLayerRename(): void {
    this.editingLayerId = null;
  }

  protected selectLayer(id: string): void {
    if (!id) return;
    this.activeLayerId = id;
    this.postToIframe({ type: 'block:select', blockId: id });
  }

  protected layerOp(opName: 'front' | 'forward' | 'backward' | 'back'): void {
    if (!this.activeLayerId) return;
    this.postToIframe({ type: 'layers:op', blockId: this.activeLayerId, op: opName });
  }

  protected onLayerDragStart(id: string): void {
    this.layerDragId = id;
  }

  protected onLayerDragOver(event: DragEvent, id: string): void {
    if (!this.layerDragId || this.layerDragId === id) return;
    event.preventDefault();
    const row = event.currentTarget as HTMLElement;
    const rect = row.getBoundingClientRect();
    this.layerDropTargetId = id;
    this.layerDropPosition = (event.clientY - rect.top) < rect.height / 2 ? 'before' : 'after';
  }

  protected onLayerDrop(id: string): void {
    const dragId = this.layerDragId;
    const position = this.layerDropPosition || 'before';
    this.clearLayerDrag();
    if (!dragId || dragId === id) return;
    this.postToIframe({ type: 'layers:reorder', blockId: dragId, targetId: id, position });
  }

  protected clearLayerDrag(): void {
    this.layerDragId = null;
    this.layerDropTargetId = null;
    this.layerDropPosition = null;
  }

  protected openBindingModalForBlock(block: any): void {
    if (!block) return;
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        target: 'custom-form-twig',
        type: 'open-binding-modal-for-block',
        blockId: block.blockId
      }, '*');
    }
  }

  protected insertVariable(path: string): void {
    const placeholder = `{{ ${path} }}`;
    const iframe = document.querySelector('iframe.canvas-frame__iframe') as HTMLIFrameElement | null;

    if (!iframe) return;

    // Focus the iframe to ensure we have proper cursor context
    iframe.focus();

    const editorManager = iframe.contentWindow && (iframe.contentWindow as any).EditorManager;
    if (editorManager?.insertTextAtCursor) {
      editorManager.insertTextAtCursor(placeholder);
      return;
    }

    const targetDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!targetDoc) return;

    // Try to insert at current selection in iframe
    const selection = targetDoc.getSelection?.();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(targetDoc.createTextNode(placeholder));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    // Fallback: find the active editable element in iframe
    const activeEditable = targetDoc.activeElement as HTMLElement | null;
    if (activeEditable && activeEditable.isContentEditable) {
      activeEditable.focus();
      // Place cursor at the end of the element
      const newSelection = targetDoc.getSelection?.();
      if (newSelection) {
        const range = targetDoc.createRange();
        range.selectNodeContents(activeEditable);
        range.collapse(false);
        newSelection.removeAllRanges();
        newSelection.addRange(range);

        const rangeForInsert = newSelection.getRangeAt(0);
        rangeForInsert.deleteContents();
        rangeForInsert.insertNode(targetDoc.createTextNode(placeholder));
        rangeForInsert.collapse(false);
        newSelection.removeAllRanges();
        newSelection.addRange(rangeForInsert);
      }
    }
  }

  // -------- Data Binding panel helpers --------
  protected setDataBindingView(view: 'tree' | 'json'): void {
    this.dataBindingView = view;
  }

  protected clearDataBindingSearch(): void {
    this.dataBindingSearch = '';
  }

  protected toggleBindingNode(path: string): void {
    this.dataBindingExpanded[path] = !this.dataBindingExpanded[path];
  }

  protected isBindingNodeExpanded(path: string): boolean {
    // Default: top-level (1 dot or less) is expanded; deeper levels collapsed
    // unless user toggled. This keeps initial view compact but useful.
    if (Object.prototype.hasOwnProperty.call(this.dataBindingExpanded, path)) {
      return this.dataBindingExpanded[path];
    }
    return (path.match(/\./g) || []).length < 1;
  }

  protected expandAllBindingNodes(): void {
    const walk = (data: any, prefix: string) => {
      if (!data || typeof data !== 'object') return;
      const keys = Array.isArray(data) ? data.map((_, i) => String(i)) : Object.keys(data);
      keys.forEach((key) => {
        const path = prefix ? `${prefix}.${key}` : key;
        const value = Array.isArray(data) ? data[Number(key)] : data[key];
        if (value && typeof value === 'object') {
          this.dataBindingExpanded[path] = true;
          walk(value, path);
        }
      });
    };
    walk(this.bindingData, '');
  }

  protected collapseAllBindingNodes(): void {
    const walk = (data: any, prefix: string) => {
      if (!data || typeof data !== 'object') return;
      const keys = Array.isArray(data) ? data.map((_, i) => String(i)) : Object.keys(data);
      keys.forEach((key) => {
        const path = prefix ? `${prefix}.${key}` : key;
        const value = Array.isArray(data) ? data[Number(key)] : data[key];
        if (value && typeof value === 'object') {
          this.dataBindingExpanded[path] = false;
          walk(value, path);
        }
      });
    };
    walk(this.bindingData, '');
  }

  // Build the visible tree rows from bindingData, honoring expand state and
  // search filter. Each row carries everything the template needs to render
  // without further computation: depth, kind, sample value, child count.
  protected get bindingTreeRows(): ReadonlyArray<{
    path: string;
    key: string;
    kind: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
    depth: number;
    expandable: boolean;
    expanded: boolean;
    sample: string;
    childCount: number;
    matched: boolean;
  }> {
    const search = this.dataBindingSearch.trim().toLowerCase();
    const rows: Array<{
      path: string;
      key: string;
      kind: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
      depth: number;
      expandable: boolean;
      expanded: boolean;
      sample: string;
      childCount: number;
      matched: boolean;
    }> = [];

    const kindOf = (v: any): 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' => {
      if (v === null) return 'null';
      if (Array.isArray(v)) return 'array';
      const t = typeof v;
      if (t === 'object') return 'object';
      if (t === 'string') return 'string';
      if (t === 'number') return 'number';
      if (t === 'boolean') return 'boolean';
      return 'null';
    };

    const sampleOf = (v: any, kind: string): string => {
      if (kind === 'string') {
        const s = String(v);
        // Strip HTML for preview legibility (jobDetails.description has HTML)
        const stripped = s.replace(/<[^>]+>/g, '').trim();
        return stripped.length > 60 ? stripped.slice(0, 60) + '…' : stripped;
      }
      if (kind === 'number' || kind === 'boolean') return String(v);
      if (kind === 'null') return 'null';
      if (kind === 'array') return `${v.length} items`;
      if (kind === 'object') return `${Object.keys(v).length} keys`;
      return '';
    };

    const walk = (data: any, prefix: string, depth: number, parentMatched: boolean) => {
      if (!data || typeof data !== 'object') return;
      const isArr = Array.isArray(data);
      const keys = isArr ? data.map((_, i) => String(i)) : Object.keys(data);
      for (const key of keys) {
        const path = prefix ? `${prefix}.${key}` : key;
        const value = isArr ? data[Number(key)] : data[key];
        const kind = kindOf(value);
        const expandable = kind === 'object' || kind === 'array';
        const expanded = expandable && this.isBindingNodeExpanded(path);
        const childCount = expandable
          ? (Array.isArray(value) ? value.length : Object.keys(value).length)
          : 0;
        const sample = sampleOf(value, kind);

        const haystack = `${path} ${sample}`.toLowerCase();
        const selfMatched = search === '' ? true : haystack.includes(search);

        // When searching: include the row if itself OR any descendant matches.
        // Cheapest way is a two-pass: lookahead into children using a
        // temporary buffer.
        if (search === '') {
          rows.push({ path, key, kind, depth, expandable, expanded, sample, childCount, matched: false });
          if (expandable && expanded) {
            walk(value, path, depth + 1, parentMatched);
          }
        } else {
          // Recurse into a scratch buffer to see if any descendant matches.
          const before = rows.length;
          rows.push({ path, key, kind, depth, expandable, expanded: true, sample, childCount, matched: selfMatched });
          if (expandable) {
            walk(value, path, depth + 1, selfMatched || parentMatched);
          }
          const addedChildren = rows.length - before - 1;
          // If this row didn't match AND none of its descendants did, drop them all.
          if (!selfMatched && !parentMatched) {
            const anyChildMatched = rows.slice(before + 1).some((r) => r.matched);
            if (!anyChildMatched) {
              rows.length = before;
              continue;
            }
          }
          // Also drop if this isn't a leaf-of-interest AND added zero children.
          if (!selfMatched && !parentMatched && addedChildren === 0) {
            rows.pop();
          }
        }
      }
    };

    walk(this.bindingData, '', 0, false);
    return rows;
  }

  // Highlighted JSON: returns an array of tokens (text + kind) for the
  // template to render with per-token coloring. Keeps the markup simple
  // — no innerHTML, no third-party highlighter.
  protected get bindingJsonTokens(): ReadonlyArray<{ text: string; kind: string }> {
    const src = this.bindingJsonString;
    const tokens: Array<{ text: string; kind: string }> = [];
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])|(\s+)/g;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) {
        tokens.push({ text: src.slice(last, m.index), kind: 'plain' });
      }
      if (m[1] !== undefined) {
        // string literal — key if followed by ':'
        tokens.push({ text: m[1], kind: m[2] ? 'key' : 'string' });
        if (m[2]) tokens.push({ text: m[2], kind: 'punct' });
      } else if (m[3] !== undefined) {
        tokens.push({ text: m[3], kind: m[3] === 'null' ? 'null' : 'boolean' });
      } else if (m[4] !== undefined) {
        tokens.push({ text: m[4], kind: 'number' });
      } else if (m[5] !== undefined) {
        tokens.push({ text: m[5], kind: 'punct' });
      } else if (m[6] !== undefined) {
        tokens.push({ text: m[6], kind: 'plain' });
      }
      last = re.lastIndex;
    }
    if (last < src.length) tokens.push({ text: src.slice(last), kind: 'plain' });
    return tokens;
  }

  // Lines view for the JSON tab — same tokens but split per newline so the
  // template can render line numbers in a gutter.
  protected get bindingJsonLines(): ReadonlyArray<ReadonlyArray<{ text: string; kind: string }>> {
    const lines: Array<Array<{ text: string; kind: string }>> = [[]];
    for (const tok of this.bindingJsonTokens) {
      const parts = tok.text.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part !== '') lines[lines.length - 1].push({ text: part, kind: tok.kind });
      });
    }
    return lines;
  }

  protected copyBindingPath(path: string, event?: Event): void {
    event?.stopPropagation();
    const placeholder = `{{ ${path} }}`;
    this.copyToClipboard(placeholder);
    this.dataBindingCopyFeedback = path;
    setTimeout(() => {
      if (this.dataBindingCopyFeedback === path) this.dataBindingCopyFeedback = null;
    }, 1500);
  }

  protected copyBindingJson(): void {
    this.copyToClipboard(this.bindingJsonString);
    this.dataBindingCopyFeedback = '__json__';
    setTimeout(() => {
      if (this.dataBindingCopyFeedback === '__json__') this.dataBindingCopyFeedback = null;
    }, 1500);
  }

  private copyToClipboard(text: string): void {
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) { /* fall through */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  private buildArrayPaths(data: any, prefix = ''): ReadonlyArray<{ path: string; count: number; preview: string }> {
    const paths: Array<{ path: string; count: number; preview: string }> = [];

    if (Array.isArray(data)) {
      const preview = data.length && data[0] && typeof data[0] === 'object'
        ? Object.keys(data[0]).slice(0, 3).join(', ')
        : String(data[0] ?? '');
      paths.push({ path: prefix, count: data.length, preview });

      return paths;
    }

    if (data && typeof data === 'object') {
      for (const key of Object.keys(data)) {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        paths.push(...this.buildArrayPaths(data[key], nextPrefix));
      }
    }

    return paths;
  }

  private buildVariablePaths(data: any, prefix = ''): ReadonlyArray<{ path: string }> {
    const paths: Array<{ path: string }> = [];
    if (Array.isArray(data)) {
      data.forEach((item, index) => {
        const path = `${prefix}[${index}]`;
        if (item && typeof item === 'object') {
          paths.push(...this.buildVariablePaths(item, path));
        } else {
          paths.push({ path });
        }
      });
      return paths;
    }

    if (data && typeof data === 'object') {
      for (const key of Object.keys(data)) {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        const value = data[key];
        if (value && typeof value === 'object') {
          paths.push(...this.buildVariablePaths(value, nextPrefix));
        } else {
          paths.push({ path: nextPrefix });
        }
      }
    }
    return paths;
  }
}
