// Angular usage for <proposal-studio>. Works on Angular 7 through 22+.
//
//   npm install proposal-studio
//
// The ONE required step on every Angular version: allow unknown elements by
// adding CUSTOM_ELEMENTS_SCHEMA, and `import 'proposal-studio'` once to
// register the custom element.
//
// ── Angular 15+ (standalone component) ──────────────────────────────────────
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  ViewChild,
  AfterViewInit,
  Input,
  Output,
  EventEmitter
} from '@angular/core';
import 'proposal-studio'; // registers <proposal-studio>
import type { ProposalStudioElement } from 'proposal-studio';

@Component({
  selector: 'app-proposal-studio',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <proposal-studio
      #ed
      (ready)="onReady()"
      (change)="onChange($event)"
      style="display:block;min-height:600px"
    ></proposal-studio>
  `
})
export class ProposalStudioComponent implements AfterViewInit {
  @ViewChild('ed') edRef!: ElementRef<ProposalStudioElement>;

  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
  @Output() ready = new EventEmitter<ProposalStudioElement>();

  private get el() {
    return this.edRef.nativeElement;
  }

  ngAfterViewInit() {
    if (this.value) this.el.whenReady().then(() => this.el.setHtml(this.value));
  }

  onReady() {
    this.ready.emit(this.el);
  }

  // Native CustomEvent — read the payload off $event.detail.
  onChange(event: Event) {
    this.valueChange.emit((event as CustomEvent<{ html: string }>).detail.html);
  }

  /** Read the current document on demand (e.g. on a Save click). */
  getHtml(): string {
    return this.el.getHtml();
  }
}

// ── Angular 7–14 (NgModule based) ───────────────────────────────────────────
// Same idea, just register the schema on your @NgModule instead of the
// component, and drop `standalone: true`:
//
//   import 'proposal-studio';
//   @NgModule({
//     declarations: [AppComponent],
//     schemas: [CUSTOM_ELEMENTS_SCHEMA],
//   })
//   export class AppModule {}
//
// In the template use the element exactly the same way:
//   <proposal-studio (ready)="..." (change)="..."></proposal-studio>
