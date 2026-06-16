import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

type RatioOpt = { key: string; label: string; value: number | null };

/**
 * Lightweight image cropper modal. Supports FREE crop (any rectangle) and
 * RATIO-locked crop (Page aspect, 1:1, 4:3, 3:4, 16:9). Emits the cropped image
 * as a data-URL. Pure DOM/canvas — no external library.
 *
 *   <app-image-cropper [src]="url" [pageRatio]="0.707"
 *      (applied)="onCrop($event)" (cancelled)="closeCrop()"></app-image-cropper>
 */
@Component({
  selector: 'app-image-cropper',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ic-modal">
      <div class="ic-backdrop" (click)="cancel()"></div>
      <div class="ic-card">
        <div class="ic-head">
          <div class="ic-title">Crop background image</div>
          <div class="ic-ratios">
            <button type="button" *ngFor="let r of ratios"
              [class.is-active]="ratioKey === r.key" (click)="setRatio(r)">{{ r.label }}</button>
          </div>
        </div>

        <div class="ic-stage">
          <div class="ic-imgwrap">
            <img #img [src]="src" (load)="onImgLoad()" draggable="false" alt="crop source" />
            <div class="ic-crop" *ngIf="ready"
              [style.left.px]="crop.x" [style.top.px]="crop.y"
              [style.width.px]="crop.w" [style.height.px]="crop.h"
              (pointerdown)="startMove($event)">
              <span class="ic-h ic-h--nw" (pointerdown)="startResize($event,'nw')"></span>
              <span class="ic-h ic-h--n"  (pointerdown)="startResize($event,'n')"></span>
              <span class="ic-h ic-h--ne" (pointerdown)="startResize($event,'ne')"></span>
              <span class="ic-h ic-h--e"  (pointerdown)="startResize($event,'e')"></span>
              <span class="ic-h ic-h--se" (pointerdown)="startResize($event,'se')"></span>
              <span class="ic-h ic-h--s"  (pointerdown)="startResize($event,'s')"></span>
              <span class="ic-h ic-h--sw" (pointerdown)="startResize($event,'sw')"></span>
              <span class="ic-h ic-h--w"  (pointerdown)="startResize($event,'w')"></span>
            </div>
          </div>
        </div>

        <div class="ic-foot">
          <span class="ic-hint">Drag to move · drag a handle to resize · pick a ratio above</span>
          <div class="ic-actions">
            <button type="button" class="ic-btn" (click)="cancel()">Cancel</button>
            <button type="button" class="ic-btn ic-btn--primary" (click)="apply()">Apply crop</button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ic-modal { position: fixed; inset: 0; z-index: 4000; display: grid; place-items: center; }
    .ic-backdrop { position: absolute; inset: 0; background: rgba(15, 18, 32, 0.66); backdrop-filter: blur(4px); }
    .ic-card { position: relative; z-index: 1; width: min(880px, 94vw); max-height: 92vh; display: flex; flex-direction: column;
      background: #192238; color: #f0f2f9; border-radius: 16px; box-shadow: 0 28px 72px rgba(8, 12, 30, 0.55); overflow: hidden; }
    .ic-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
      padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .ic-title { font-size: 14px; font-weight: 700; }
    .ic-ratios { display: flex; gap: 4px; flex-wrap: wrap; }
    .ic-ratios button { padding: 5px 11px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.05); color: #d7dbec; font-size: 12px; font-weight: 600; cursor: pointer; }
    .ic-ratios button:hover { background: rgba(92,92,255,0.22); }
    .ic-ratios button.is-active { background: #5c5cff; border-color: #5c5cff; color: #fff; }
    .ic-stage { flex: 1; min-height: 0; overflow: auto; display: grid; place-items: center; padding: 22px; background: #11182b; }
    .ic-imgwrap { position: relative; line-height: 0; }
    .ic-imgwrap img { display: block; max-width: 78vw; max-height: 62vh; user-select: none; -webkit-user-drag: none; }
    .ic-crop { position: absolute; box-sizing: border-box; border: 1.5px solid #fff; cursor: move;
      box-shadow: 0 0 0 9999px rgba(0,0,0,0.5); }
    /* rule-of-thirds grid */
    .ic-crop::before, .ic-crop::after { content: ''; position: absolute; inset: 0; pointer-events: none; }
    .ic-crop::before { background-image: linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px);
      background-size: 33.33% 33.33%; background-position: 0 0; }
    .ic-h { position: absolute; width: 12px; height: 12px; background: #fff; border: 1px solid #5c5cff; border-radius: 2px; }
    .ic-h--nw { left: -6px; top: -6px; cursor: nwse-resize; }
    .ic-h--n  { left: 50%; top: -6px; transform: translateX(-50%); cursor: ns-resize; }
    .ic-h--ne { right: -6px; top: -6px; cursor: nesw-resize; }
    .ic-h--e  { right: -6px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
    .ic-h--se { right: -6px; bottom: -6px; cursor: nwse-resize; }
    .ic-h--s  { left: 50%; bottom: -6px; transform: translateX(-50%); cursor: ns-resize; }
    .ic-h--sw { left: -6px; bottom: -6px; cursor: nesw-resize; }
    .ic-h--w  { left: -6px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
    .ic-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.08); }
    .ic-hint { font-size: 11px; color: rgba(255,255,255,0.55); }
    .ic-actions { display: flex; gap: 8px; }
    .ic-btn { padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.16);
      background: rgba(255,255,255,0.06); color: #e7eaf6; font-size: 13px; font-weight: 600; cursor: pointer; }
    .ic-btn:hover { background: rgba(255,255,255,0.12); }
    .ic-btn--primary { background: #5c5cff; border-color: #5c5cff; color: #fff; }
    .ic-btn--primary:hover { background: #4a4af0; }
  `]
})
export class ImageCropperComponent {
  @Input() src = '';
  /** Page aspect ratio (width / height) for the "Page" preset. */
  @Input() pageRatio: number | null = null;
  @Output() applied = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('img') imgRef!: ElementRef<HTMLImageElement>;

  ready = false;
  imgW = 0; imgH = 0;   // displayed image size (px)
  natW = 0; natH = 0;   // natural image size (px)
  crop = { x: 0, y: 0, w: 0, h: 0 }; // in displayed px, relative to the image
  ratioKey = 'free';

  private drag: { mode: string; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null = null;

  get ratios(): RatioOpt[] {
    return [
      { key: 'free', label: 'Free', value: null },
      { key: 'page', label: 'Page', value: this.pageRatio || null },
      { key: '1', label: '1:1', value: 1 },
      { key: '43', label: '4:3', value: 4 / 3 },
      { key: '34', label: '3:4', value: 3 / 4 },
      { key: '169', label: '16:9', value: 16 / 9 },
    ].filter((r) => r.key !== 'page' || !!r.value);
  }

  onImgLoad(): void {
    const im = this.imgRef?.nativeElement;
    if (!im) return;
    this.natW = im.naturalWidth; this.natH = im.naturalHeight;
    this.imgW = im.clientWidth; this.imgH = im.clientHeight;
    this.crop = { x: 0, y: 0, w: this.imgW, h: this.imgH };
    this.ratioKey = 'free';
    this.ready = true;
  }

  setRatio(r: RatioOpt): void {
    this.ratioKey = r.key;
    if (r.value) this.fitRatio(r.value);
  }

  private activeRatio(): number | null {
    const r = this.ratios.find((x) => x.key === this.ratioKey);
    return r ? r.value : null;
  }

  /** Centre a max-size rectangle of the given ratio inside the image. */
  private fitRatio(ratio: number): void {
    let w = this.imgW, h = w / ratio;
    if (h > this.imgH) { h = this.imgH; w = h * ratio; }
    this.crop = { x: (this.imgW - w) / 2, y: (this.imgH - h) / 2, w, h };
  }

  startMove(e: PointerEvent): void {
    e.preventDefault(); e.stopPropagation();
    this.drag = { mode: 'move', sx: e.clientX, sy: e.clientY, ox: this.crop.x, oy: this.crop.y, ow: this.crop.w, oh: this.crop.h };
  }

  startResize(e: PointerEvent, handle: string): void {
    e.preventDefault(); e.stopPropagation();
    this.drag = { mode: handle, sx: e.clientX, sy: e.clientY, ox: this.crop.x, oy: this.crop.y, ow: this.crop.w, oh: this.crop.h };
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(e: PointerEvent): void {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.sx, dy = e.clientY - this.drag.sy;
    if (this.drag.mode === 'move') {
      this.crop.x = Math.max(0, Math.min(this.imgW - this.crop.w, this.drag.ox + dx));
      this.crop.y = Math.max(0, Math.min(this.imgH - this.crop.h, this.drag.oy + dy));
      return;
    }
    this.resize(this.drag.mode, dx, dy);
  }

  @HostListener('document:pointerup')
  onPointerUp(): void { this.drag = null; }

  private resize(handle: string, dx: number, dy: number): void {
    const d = this.drag!;
    const hasW = handle.includes('w'), hasE = handle.includes('e');
    const hasN = handle.includes('n'), hasS = handle.includes('s');
    let x = d.ox, y = d.oy, w = d.ow, h = d.oh;
    if (hasE) w = d.ow + dx;
    if (hasW) { w = d.ow - dx; x = d.ox + dx; }
    if (hasS) h = d.oh + dy;
    if (hasN) { h = d.oh - dy; y = d.oy + dy; }

    const ratio = this.activeRatio();
    if (ratio) {
      const pureVertical = (hasN || hasS) && !(hasE || hasW); // n / s handle
      if (pureVertical) {
        const nw = h * ratio;
        if (hasW) x = d.ox + (d.ow - nw); // keep right edge anchored (n/s never sets x, so anchor left/centre)
        w = nw;
      } else {
        const nh = w / ratio;
        if (hasN) y = d.oy + (d.oh - nh); // keep bottom edge anchored
        h = nh;
      }
    }

    const MIN = 24;
    if (w < MIN) { if (hasW) x = d.ox + d.ow - MIN; w = MIN; }
    if (h < MIN) { if (hasN) y = d.oy + d.oh - MIN; h = MIN; }
    // Clamp inside the image.
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > this.imgW) w = this.imgW - x;
    if (y + h > this.imgH) h = this.imgH - y;
    this.crop = { x, y, w, h };
  }

  cancel(): void { this.cancelled.emit(); }

  apply(): void {
    const im = this.imgRef?.nativeElement;
    if (!im || !this.imgW || !this.imgH) { this.cancelled.emit(); return; }
    const scaleX = this.natW / this.imgW, scaleY = this.natH / this.imgH;
    const sx = Math.round(this.crop.x * scaleX);
    const sy = Math.round(this.crop.y * scaleY);
    const sw = Math.max(1, Math.round(this.crop.w * scaleX));
    const sh = Math.max(1, Math.round(this.crop.h * scaleY));

    // Cap output to keep the data-URL (and saved template) a sane size.
    const MAX = 2200;
    let outW = sw, outH = sh;
    const longest = Math.max(outW, outH);
    if (longest > MAX) { const k = MAX / longest; outW = Math.round(outW * k); outH = Math.round(outH * k); }

    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) { this.cancelled.emit(); return; }
    ctx.drawImage(im, sx, sy, sw, sh, 0, 0, outW, outH);
    const isPng = /^data:image\/png/i.test(this.src);
    const url = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.92);
    this.applied.emit(url);
  }
}
