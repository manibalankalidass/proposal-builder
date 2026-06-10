import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  CompletionContext,
  CompletionResult,
  Completion,
} from '@codemirror/autocomplete';

// Twig comparison / logic operators offered alongside the JSON field paths,
// so the box behaves like a small SQL/expression console: type a field, then
// pick an operator, then another field or literal.
const TWIG_OPERATORS: ReadonlyArray<string> = [
  '==', '!=', '>', '<', '>=', '<=',
  '+', '-', '*', '/', '%', '~',
];

const TWIG_KEYWORDS: ReadonlyArray<string> = [
  'and', 'or', 'not', 'in', 'is',
  'starts with', 'ends with', 'matches',
  'true', 'false', 'null', 'empty', 'defined',
];

// Token chars that make up a field path (identifiers, dots, array indices).
const PATH_TOKEN = /[A-Za-z0-9_.$\[\]]*/;

/**
 * A single-line CodeMirror 6 expression editor for Twig show-conditions.
 *
 * It is driven entirely by the `variables` list (the JSON field paths the
 * parent already builds from the binding data) plus a fixed set of Twig
 * operators/keywords. Completion is context aware: as you type an identifier
 * it filters the field paths, and after a space it also surfaces operators —
 * the same feel as an SQL editor's auto-suggest.
 */
@Component({
  selector: 'app-condition-editor',
  standalone: true,
  template: `<div class="cond-editor-host" #host></div>`,
  styles: [`
    .cond-editor-host { width: 100%; margin-bottom: 8px; }
    .cond-editor-host .cm-editor {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #fff;
      font-family: monospace;
      font-size: 14px;
    }
    .cond-editor-host .cm-editor.cm-focused {
      outline: none;
      border-color: #5c5cff;
      box-shadow: 0 0 0 2px rgba(92, 92, 255, 0.15);
    }
    .cond-editor-host .cm-scroller { font-family: monospace; }
    .cond-editor-host .cm-content { padding: 10px 12px; }
    .cond-editor-host .cm-line { padding: 0; }
    /* Single line: hide the gutter / wrap visuals */
    .cond-editor-host .cm-placeholder { color: #9ca3af; }
  `],
})
export class ConditionEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;

  /** Current expression text (two-way bindable as [value] / (valueChange)). */
  @Input() value = '';
  /** JSON field paths to suggest, e.g. ['mainContent.accountNo', ...]. */
  @Input() variables: ReadonlyArray<string> = [];
  /**
   * Scope-relative paths that should rank above {@link variables}, e.g. the
   * loop-alias fields `['item.price', 'item.qty']` when the condition lives
   * inside a repeater. These are what the user almost always wants there.
   */
  @Input() priorityVariables: ReadonlyArray<string> = [];
  @Input() placeholder = 'e.g. mainContent.visible';

  @Output() valueChange = new EventEmitter<string>();

  private view?: EditorView;
  private completionsCompartment = new Compartment();
  private placeholderCompartment = new Compartment();
  /** Guards the updateListener so programmatic doc sets don't echo back. */
  private settingExternally = false;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    // Run CodeMirror outside Angular's zone to avoid change-detection churn on
    // every keystroke; we hop back into the zone only when emitting changes.
    this.zone.runOutsideAngular(() => {
      this.view = new EditorView({
        parent: this.hostRef.nativeElement,
        state: EditorState.create({
          doc: this.value ?? '',
          extensions: [
            history(),
            closeBrackets(),
            autocompletion({ activateOnTyping: true, icons: false }),
            keymap.of([
              ...closeBracketsKeymap,
              ...completionKeymap,
              ...historyKeymap,
              ...defaultKeymap,
            ]),
            // Keep it strictly single-line: drop any inserted newlines.
            EditorState.transactionFilter.of((tr) => {
              if (!tr.docChanged) return tr;
              // newDoc.lines > 1 means a newline slipped in (paste / Enter).
              return tr.newDoc.lines > 1 ? [] : tr;
            }),
            this.placeholderCompartment.of(cmPlaceholder(this.placeholder)),
            this.completionsCompartment.of(this.makeCompletionExtension()),
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !this.settingExternally) {
                const text = update.state.doc.toString();
                this.value = text;
                this.zone.run(() => this.valueChange.emit(text));
              }
            }),
            EditorView.theme({
              '&': { height: 'auto' },
              '.cm-scroller': { overflow: 'hidden' },
            }),
          ],
        }),
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.view) return;

    if (changes['value']) {
      const incoming = this.value ?? '';
      const current = this.view.state.doc.toString();
      if (incoming !== current) {
        this.settingExternally = true;
        this.view.dispatch({
          changes: { from: 0, to: current.length, insert: incoming },
        });
        this.settingExternally = false;
      }
    }

    if (changes['variables'] || changes['priorityVariables']) {
      this.view.dispatch({
        effects: this.completionsCompartment.reconfigure(this.makeCompletionExtension()),
      });
    }

    if (changes['placeholder']) {
      this.view.dispatch({
        effects: this.placeholderCompartment.reconfigure(cmPlaceholder(this.placeholder)),
      });
    }
  }

  ngOnDestroy(): void {
    this.view?.destroy();
  }

  /** Build the autocompletion extension from the current variables list. */
  private makeCompletionExtension() {
    const fieldOptions = this.buildFieldOptions();
    const keywordOptions: Completion[] = TWIG_KEYWORDS.map((k) => ({
      label: k,
      type: 'keyword',
    }));
    const operatorOptions: Completion[] = TWIG_OPERATORS.map((op) => ({
      label: op,
      type: 'operator',
    }));
    const allOptions = [...fieldOptions, ...keywordOptions, ...operatorOptions];

    const source = (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(PATH_TOKEN);
      const tokenEmpty = !word || word.from === word.to;
      const before = context.state.sliceDoc(0, context.pos);

      // When there is no token under the cursor, only auto-open if we just
      // typed a space/opening paren (so operators/keywords can follow a field)
      // or the user explicitly asked (Ctrl-Space).
      if (tokenEmpty && !context.explicit && !/[\s(]$/.test(before)) {
        return null;
      }

      return {
        from: tokenEmpty ? context.pos : word!.from,
        options: allOptions,
        validFor: PATH_TOKEN,
      };
    };

    return autocompletion({
      activateOnTyping: true,
      icons: false,
      override: [source],
    });
  }

  /** Map the field paths to completions, collapsing array indices so the list
   *  isn't flooded with one entry per array element. Scope-relative
   *  `priorityVariables` are emitted first and ranked highest. */
  private buildFieldOptions(): Completion[] {
    const seen = new Set<string>();
    const options: Completion[] = [];

    const add = (raw: string, boost: number) => {
      // mainContent.visitDetails[3].engineer -> mainContent.visitDetails[0].engineer
      const normalized = raw.replace(/\[\d+\]/g, '[0]');
      if (seen.has(normalized)) return;
      seen.add(normalized);
      options.push({ label: normalized, type: 'variable', boost });
    };

    // Loop-alias / scoped fields rank above root paths, which rank above
    // operators/keywords (boost 0).
    for (const p of this.priorityVariables) add(p, 2);
    for (const p of this.variables) add(p, 1);

    return options;
  }
}
