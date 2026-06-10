import { Component, HostListener } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-canvas',
  templateUrl: './canvas.html',
  styleUrls: ['./canvas.scss']
})
export class CanvasComponent {
  protected readonly frameUrl: SafeResourceUrl;
  protected readonly pages = [1];
  protected iframeHeight = 1123;

  constructor(private readonly sanitizer: DomSanitizer) {
    this.frameUrl = this.sanitizer.bypassSecurityTrustResourceUrl('/custom-form/custom-form.html');
  }

  @HostListener('window:message', ['$event'])
  onMessage(event: MessageEvent) {
    if (event.data?.type === 'iframe:height') {
      this.iframeHeight = event.data.height;
    }
  }
}
