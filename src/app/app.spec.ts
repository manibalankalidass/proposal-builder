import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the brochure editor shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.editor-shell')).toBeTruthy();
    expect(compiled.querySelectorAll('app-canvas iframe').length).toBe(3);
    expect(compiled.textContent).toContain('BrochureFlow');
    expect(compiled.textContent).toContain('My Brochure');
  });
});
