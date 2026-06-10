import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type FAIcon = {
  name: string;
  label: string;
  styles: string[];
  class: string;
  style?: string;
};

@Component({
  selector: 'app-icon-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="icon-picker-container">
      <input
        type="text"
        class="icon-search"
        placeholder="Search icons..."
        [(ngModel)]="searchQuery"
        (input)="filterIcons()"
      />
      <div class="icon-counter">
        Showing {{ filteredIcons.length }} / {{ totalIcons }}
      </div>
      <div class="icons-grid">
        <div
          *ngFor="let icon of filteredIcons"
          class="icon-item"
          [title]="icon.label"
          draggable="true"
          (dragstart)="onDragStart($event, icon)"
        >
          <i [class]="icon.class"></i>
          <span class="icon-name">{{ icon.name }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .icon-picker-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 12px;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 8px;
    }

    .icon-search {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 13px;
      font-family: inherit;
    }

    .icon-counter {
      font-size: 12px;
      color: #666;
      text-align: center;
    }

    .icons-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
      gap: 8px;
      overflow-y: auto;
      padding-right: 4px;
    }

    .icons-grid::-webkit-scrollbar {
      width: 6px;
    }

    .icons-grid::-webkit-scrollbar-track {
      background: transparent;
    }

    .icons-grid::-webkit-scrollbar-thumb {
      background: #999;
      border-radius: 3px;
    }

    .icon-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      cursor: grab;
      transition: all 200ms ease;
      font-size: 18px;
    }

    .icon-item:hover {
      border-color: #5c5cff;
      background: #f5f7ff;
      transform: translateY(-2px);
      box-shadow: 0 2px 8px rgba(92, 92, 255, 0.15);
    }

    .icon-item:active {
      cursor: grabbing;
    }

    .icon-name {
      font-size: 10px;
      color: #666;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
    }
  `]
})
export class IconPickerComponent implements OnInit {
  icons: FAIcon[] = [];
  filteredIcons: FAIcon[] = [];
  searchQuery = '';
  totalIcons = 0;

  ngOnInit() {
    console.log('ICON PICKER: ngOnInit called');
    this.loadFontAwesomeIcons();
  }

  loadFontAwesomeIcons() {
    // Load comprehensive Font Awesome free icons list
    this.icons = this.getComprehensiveIconsList();
    this.icons.sort((a, b) => a.name.localeCompare(b.name));
    this.totalIcons = this.icons.length;
    this.filteredIcons = [...this.icons];
    console.log('ICON PICKER: loaded', this.totalIcons, 'icons');
  }

  getComprehensiveIconsList(): FAIcon[] {
    const iconNames = [
      // Navigation & UI
      'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down', 'arrow-alt-left', 'arrow-alt-right',
      'angle-left', 'angle-right', 'angle-up', 'angle-down', 'chevron-left', 'chevron-right',
      'chevron-up', 'chevron-down', 'caret-left', 'caret-right', 'caret-up', 'caret-down',
      'bars', 'bars-staggered', 'hamburger', 'grip-vertical', 'grip-horizontal',
      'ellipsis', 'ellipsis-h', 'ellipsis-v', 'align-left', 'align-center', 'align-right',
      'align-justify', 'indent', 'outdent', 'list', 'list-ul', 'list-ol', 'list-check',
      'grid', 'grid-2', 'columns', 'border-all', 'border-top', 'border-bottom',

      // Actions & Interactions
      'check', 'check-circle', 'check-double', 'check-to-slot', 'close', 'times', 'x',
      'multiply', 'plus', 'plus-circle', 'minus', 'minus-circle', 'equals',
      'play', 'play-circle', 'pause', 'pause-circle', 'stop', 'stop-circle',
      'step-forward', 'step-backward', 'forward', 'backward', 'fast-forward', 'fast-backward',
      'skip-forward', 'skip-backward', 'redo', 'redo-alt', 'undo', 'undo-alt', 'repeat', 'rotate-left', 'rotate-right',
      'refresh', 'reload', 'sync', 'sync-alt', 'reply', 'reply-all', 'share', 'share-alt',
      'share-nodes', 'share-from-square', 'square-share-nodes', 'paper-plane', 'envelope',
      'envelope-open', 'envelope-circle-check', 'print', 'download', 'upload', 'trash',
      'trash-alt', 'trash-can', 'delete', 'edit', 'edit-square', 'pen', 'pen-square',
      'pencil', 'pencil-square', 'scissors', 'copy', 'copy-to-clipboard', 'paste',
      'clone', 'duplicate', 'save', 'floppy-disk', 'house-save', 'bookmark', 'tag', 'tags',
      'flag', 'flag-checkered', 'ban', 'ban-circle', 'block', 'ban-smoking', 'no-entry',
      'eye', 'eye-open', 'eye-slash', 'eye-low-vision', 'eye-dropper', 'eyedropper',
      'hide', 'show', 'toggle-on', 'toggle-off', 'toggle-left', 'toggle-right',
      'circle-info', 'circle-question', 'circle-exclamation', 'circle-check',
      'circle-xmark', 'circle-notch', 'circle-plus', 'circle-minus', 'circle-dot',

      // Common Objects & Symbols
      'heart', 'heart-broken', 'heart-pulse', 'heart-crack', 'star', 'star-half',
      'star-half-stroke', 'star-check', 'star-fill', 'star-sharp', 'circle', 'circle-fill',
      'circle-o', 'circle-half', 'circle-half-stroke', 'square', 'square-full', 'square-o',
      'square-check', 'square-xmark', 'square-minus', 'square-plus', 'square-poll-horizontal',
      'square-poll-vertical', 'rectangle', 'rectangle-portrait', 'rectangle-landscape',
      'rectangle-wide', 'rectangle-tall', 'triangle', 'triangle-exclamation', 'diamond',
      'diamond-turn-right', 'pentagon', 'hexagon', 'octagon', 'star-of-life', 'star-of-david',
      'octagram', 'person', 'person-fill', 'person-circle', 'person-dots-from-line',
      'user', 'user-check', 'user-clock', 'user-graduate', 'user-injured', 'user-lock',
      'user-md', 'user-md-circle', 'user-minus', 'user-ninja', 'user-nurse', 'user-plus',
      'user-shield', 'user-slash', 'user-tag', 'user-tie', 'user-xmark', 'users',
      'users-slash', 'people-group', 'people-pulling', 'people-robbery',

      // Communication
      'bell', 'bell-slash', 'bell-ring', 'message', 'message-lines', 'comment',
      'comment-fill', 'comment-slash', 'comment-dots', 'comments', 'comments-slash',
      'comments-dollar', 'envelope', 'envelope-open', 'envelope-open-text', 'phone',
      'phone-flip', 'phone-slash', 'phone-volume', 'volume-high', 'volume-low', 'volume-off',
      'volume-xmark', 'microphone', 'microphone-slash', 'microphone-lines', 'microphone-lines-slash',
      'headphones', 'headset', 'broadcast', 'satellite', 'satellite-dish', 'rss', 'rss-square',
      'wifi', 'wifi-0', 'wifi-1', 'wifi-2', 'wifi-slash', 'signal', 'signal-1', 'signal-2',
      'signal-3', 'signal-4', 'signal-5', 'signal-perfect', 'signal-slash',

      // Media & Entertainment
      'camera', 'camera-retro', 'camera-slash', 'video', 'video-slash', 'film', 'filmstrip',
      'image', 'image-portrait', 'images', 'images-user', 'music', 'music-note',
      'music-notes', 'music-slash', 'note', 'notes', 'note-sticky', 'note-sticky-slash',
      'book', 'book-bookmark', 'book-circle', 'book-journal-whills', 'book-open',
      'book-open-reader', 'book-quran', 'book-reader', 'book-skull', 'bookmark',
      'bookmarks', 'books', 'book-medical', 'book-blank', 'dumpster-fire', 'fire',
      'fire-alt', 'fire-flame', 'fire-flame-curved', 'flame', 'fireplace', 'fireworks',
      'sparkles', 'sparkle', 'sparkler', 'magic', 'wand-magic', 'wand-magic-sparkles',

      // Objects & Tools
      'wrench', 'wrench-circle-check', 'wrench-circle-exclamation', 'wrenches', 'screwdriver',
      'screwdriver-circle-check', 'screwdriver-circle-exclamation', 'hammer', 'hammer-circle-check',
      'hammer-circle-exclamation', 'axe', 'axe-battle', 'ax', 'ax-battle', 'pick',
      'pickaxe', 'pick-lock', 'pick-axe', 'tools', 'toolbox', 'nail', 'nails', 'box',
      'box-open', 'box-full', 'boxes', 'boxes-stacked', 'bag', 'bag-shopping', 'bag-open',
      'baggages', 'suitcase', 'suitcase-rolling', 'suitcase-medical', 'briefcase',
      'briefcase-medical', 'briefcase-blank', 'satchel', 'backpack', 'basket-shopping',
      'bucket', 'bucket-fill', 'crate', 'crate-stack', 'package', 'packages', 'parcel',
      'weight', 'weight-hanging', 'scale', 'scale-unbalanced', 'scale-unbalanced-flip',
      'scale-balanced', 'balance-scale', 'balance-scale-left', 'balance-scale-right',
      'hourglass', 'hourglass-start', 'hourglass-end', 'hourglass-half', 'hourglass-empty',
      'hourglass-end-alt', 'timer', 'stopwatch', 'stopwatch-20', 'stopwatch-start',
      'stopwatch-stop', 'alarm-clock', 'alarm-exclamation', 'calendar', 'calendar-alt',
      'calendar-check', 'calendar-circle', 'calendar-circle-exclamation', 'calendar-circle-minus',
      'calendar-circle-plus', 'calendar-circle-user', 'calendar-days', 'calendar-exclamation',
      'calendar-minus', 'calendar-plus', 'calendar-range', 'calendar-slash', 'calendar-times',
      'calendar-user', 'calendar-week', 'calendar-xmark', 'calendar-date', 'calendar-dot',

      // Office & Documents
      'file', 'file-archive', 'file-audio', 'file-check', 'file-circle-check', 'file-circle-exclamation',
      'file-circle-minus', 'file-circle-plus', 'file-circle-question', 'file-circle-xmark',
      'file-code', 'file-contract', 'file-csv', 'file-excel', 'file-export', 'file-image',
      'file-import', 'file-invoice', 'file-invoice-dollar', 'file-lines', 'file-medical',
      'file-medical-alt', 'file-pdf', 'file-pen', 'file-pdf-alt', 'file-powerpoint',
      'file-prescription', 'file-shield', 'file-signature', 'file-slash', 'file-text',
      'file-text-alt', 'file-video', 'file-word', 'file-xmark', 'file-zipper', 'file-zip',
      'file-alt', 'files', 'folder', 'folder-blank', 'folder-check', 'folder-circle-check',
      'folder-circle-exclamation', 'folder-circle-minus', 'folder-circle-plus',
      'folder-circle-question', 'folder-circle-xmark', 'folder-closed', 'folder-minus',
      'folder-open', 'folder-open-alt', 'folder-plus', 'folder-times', 'folder-tree',
      'folder-user', 'folder-xmark', 'folders', 'page', 'page-facing-up', 'pages',
      'pager', 'parchment', 'scroll', 'scroll-torah', 'scrolls', 'sheet', 'sheets',
      'newspaper', 'newspaper-alt', 'receipt', 'receipt-alt', 'receipt-check', 'receipt-item',
      'document', 'document-alt', 'document-check', 'document-code', 'document-export',
      'document-import', 'document-invoice', 'document-invoice-dollar', 'document-lines',
      'document-pdf', 'document-pen', 'document-secret', 'document-signature', 'document-slash',
      'document-word', 'documents', 'documents-alt', 'book-dead', 'book-medical-alt',

      // Locations & Maps
      'map', 'map-location', 'map-location-dot', 'map-pin', 'map-pin-slash', 'location',
      'location-arrow', 'location-check', 'location-circle', 'location-circle-xmark',
      'location-crosshairs', 'location-dot', 'location-pin', 'location-pin-lock', 'location-pin-slash',
      'location-question', 'location-slash', 'location-xmark', 'compass', 'compass-large',
      'directions', 'route', 'routes', 'road', 'road-barrier', 'road-bridge', 'road-circle-check',
      'road-circle-exclamation', 'road-circle-xmark', 'road-lock', 'road-spikes', 'street-view',
      'signs-post', 'sign', 'sign-hanging', 'sign-mounted', 'sign-real-estate', 'signage',
      'landmark', 'landmark-american', 'landmark-clock', 'landmark-dome', 'landmark-flag',
      'landmark-statue', 'milestone', 'mileposts', 'monument', 'monuments', 'obelisk',
      'pagoda', 'palace', 'pantheon', 'place-of-worship', 'gopuram', 'gate', 'gate-open',
      'houses', 'house', 'house-fire', 'house-flag', 'house-flood-water', 'house-flood-water-circle',
      'house-laptop', 'house-lock', 'house-medical', 'house-medical-circle-check',
      'house-medical-circle-xmark', 'house-medical-flag', 'house-signal', 'house-tsunami',
      'house-user', 'house-wheat', 'house-chimney', 'house-chimney-crack', 'house-chimney-medical',
      'house-chimney-user', 'house-circle-check', 'house-circle-exclamation', 'house-circle-xmark',
      'house-damage', 'house-person-arrive', 'house-person-leave', 'church', 'city', 'cityscape',
      'farm', 'barn', 'cabin', 'campground', 'caravan', 'castle', 'cathedral', 'cedars', 'chapel',
      'cottage', 'cottages', 'desert', 'dungeon', 'factory', 'farm-house', 'ferris-wheel',
      'ferris-wheel-alt', 'field', 'field-hockey', 'forest', 'game-board', 'garden', 'garden-cart',
      'gazebo', 'gear-complex', 'gear-code', 'gears', 'giant', 'goblet', 'goggles', 'golf', 'golf-ball',
      'golf-ball-tee', 'gopuram', 'gorilla', 'gospel', 'graduation-cap', 'grain', 'grain-arrow-down',
      'grain-arrow-up', 'grain-wheat', 'grains', 'gramophone', 'granary', 'grandparent', 'grant',

      // Nature & Weather
      'cloud', 'cloud-arrow-down', 'cloud-arrow-up', 'cloud-bolt', 'cloud-bolt-moon',
      'cloud-bolt-sun', 'cloud-burst', 'cloud-check', 'cloud-circle-check', 'cloud-circle-exclamation',
      'cloud-circle-minus', 'cloud-circle-plus', 'cloud-circle-xmark', 'cloud-download',
      'cloud-download-alt', 'cloud-exclamation', 'cloud-fog', 'cloud-hail', 'cloud-hail-mixed',
      'cloud-hail-sun', 'cloud-heart', 'cloud-meatball', 'cloud-minus', 'cloud-minus-circle',
      'cloud-moon', 'cloud-moon-rain', 'cloud-music', 'cloud-pen', 'cloud-plus', 'cloud-plus-circle',
      'cloud-rain', 'cloud-rain-heavy', 'cloud-rainbow', 'cloud-scribble', 'cloud-showers',
      'cloud-showers-heavy', 'cloud-showers-water', 'cloud-slash', 'cloud-snow', 'cloud-snow-mountain',
      'cloud-snowflake', 'cloud-sparkles', 'cloud-sun', 'cloud-sun-rain', 'cloud-upload',
      'cloud-upload-alt', 'cloud-xmark', 'cloud-check-alt', 'cloudy', 'cloudy-gusts', 'cloudy-hot',
      'cloudversify', 'clover', 'club', 'clubs', 'coal', 'coast-guard', 'coat-hangers', 'coats',
      'cobalt', 'cobra', 'cockroach', 'cocoa', 'coconut', 'cocoon', 'cocoons', 'code', 'code-branch',
      'code-clone', 'code-compare', 'code-fork', 'code-merge', 'code-pull-request', 'code-slash',
      'codepen', 'coder', 'codeql', 'codes', 'codice', 'coffee', 'coffin', 'cogito', 'cogs',
      'coil', 'coin', 'coin-dime', 'coin-penny', 'coin-quarter', 'coinage', 'coins',
      'cola', 'colander', 'colander-pots', 'colanders', 'cold', 'coldhot', 'coldwater',
      'coledge', 'coleus', 'colic', 'colicky', 'colies', 'colitis', 'colla', 'collage', 'collar',
      'collarbone', 'collard', 'collards', 'collate', 'collated', 'collateral', 'collateralize',
      'collaterally', 'collating', 'collation', 'colleague', 'colleagues', 'collect', 'collectable',
      'collected', 'collectible', 'collectibles', 'collecting', 'collection', 'collections',
      'collective', 'collectives', 'collectivity', 'collector', 'collectors', 'collects', 'colleen',
      'colleens', 'college', 'colleges', 'collegial', 'collegiality', 'collegian', 'collegians',
      'collegiate', 'collegium', 'collegia', 'collegia', 'collemola', 'collen', 'collenchyma',
      'collenchymatous', 'colleo', 'collepile', 'collet', 'collets', 'collide', 'collided',
      'collider', 'colliders', 'collides', 'collie', 'collier', 'collieries', 'colliers', 'collery',
      'collies', 'collimated', 'collimating', 'collimation', 'collimator', 'collimators',
      'collinear', 'collinearity', 'collins', 'collision', 'collisions', 'collocate', 'collocated',
      'collocating', 'collocation', 'collocations', 'collodion', 'collogue', 'colloidal', 'colloid',
      'colloidal', 'colloids', 'collop', 'collops', 'colloquail', 'colloquaial', 'colloquial',
      'colloquialism', 'colloquialisms', 'colloquialist', 'colloquialists', 'colloquially',
      'colloquies', 'colloquist', 'colloquium', 'colloquia', 'colloquiums', 'colloquy', 'colloquy',
      'colls', 'colluctation', 'collude', 'colluded', 'colludes', 'colluding', 'colluisory',
      'collum', 'collumella', 'collunella', 'collusion', 'collusions', 'collusional', 'collusionary',
      'collusive', 'collusively', 'collusiveness', 'collusory', 'collutory', 'colluvies', 'collywobbles',

      // Science & Technology
      'atom', 'atom-alt', 'atomic', 'atomically', 'atomicity', 'atomies', 'atomism',
      'atomist', 'atomistic', 'atomistically', 'atomists', 'atomization', 'atomize', 'atomized',
      'atomizer', 'atomizers', 'atomizes', 'atomizing', 'atomy', 'dna', 'dna-alt', 'dna-double-helix',
      'molecules', 'molecule', 'test-tube', 'flask', 'flask-vial', 'flasks', 'microscope',
      'telescope', 'beaker', 'beakers', 'magnifying-glass', 'magnifying-glass-arrow', 'magnifying-glass-check',
      'magnifying-glass-circle', 'magnifying-glass-dollar', 'magnifying-glass-location',
      'magnifying-glass-minus', 'magnifying-glass-plus', 'magnifying-glass-question',
      'magnifying-glass-chart', 'magnifying-glass-close', 'magnifying-glass-expand',
      'magnifying-glass-location', 'magnifying-glass-lock', 'magnifying-glass-plus-minus',
      'magnifying-glass-question', 'magnifying-glass-slash', 'magnifying-glass-trending',
      'magnifying-glass-upward', 'magnifier', 'magnifiers', 'magnifies', 'magnify', 'magnifying',
      'bolt', 'bolt-lightning', 'bolt-slash', 'bolts', 'boltzmann', 'bomb', 'bombard', 'bombarding',
      'bombardier', 'bombardiers', 'bombardment', 'bombardments', 'bombards', 'bombast',
      'bombastic', 'bombastical', 'bombastically', 'bombasts', 'bombed', 'bomber', 'bombers',
      'bombing', 'bombings', 'bomblet', 'bomblets', 'bombs', 'bombshell', 'bombshells',

      // Emotions & Faces
      'smile', 'smile-wink', 'frown', 'frown-open', 'laugh', 'laugh-squint', 'laugh-wink',
      'grin', 'grin-alt', 'grin-beam', 'grin-beam-sweat', 'grin-hearts', 'grin-squint',
      'grin-squint-tears', 'grin-stars', 'grin-tears', 'grin-tongue', 'grin-tongue-squint',
      'grin-tongue-wink', 'grin-wink', 'grimace', 'sad-tear', 'sad-crying', 'sad-dizzy', 'sad-tear-closed',
      'angry', 'angry-alt', 'face-angry', 'face-anxious-sweat', 'face-awesome', 'face-awesome-alt',
      'face-awed', 'face-awesome-unamused', 'face-awed-dizzy', 'face-awed-grinning', 'face-awed-meh',
      'face-awed-nauseated', 'face-awed-sad', 'face-awed-screaming', 'face-awed-sunglasses',
      'face-awed-sweat-drop', 'face-awed-sweat-tears', 'face-awed-tears', 'face-awed-tired',
      'face-awed-unamused', 'face-awed-weary', 'face-awed-wink', 'face-awed-wink-tongue',
      'sunglasses', 'glasses', 'glasses-alt', 'goggles', 'monocle-glass', 'monocle', 'eyebrow-raised',
      'eyebrows', 'eyed', 'eyed-alt', 'eyed-smiling', 'eyeball', 'eyeballs', 'eye', 'eye-slash',
      'face', 'face-agape', 'face-anguished', 'face-anxious', 'face-anxious-sweat', 'face-apprehensive',
      'face-awesome', 'face-awed', 'face-bag-eyes', 'face-beam', 'face-bitter', 'face-blissful',
      'face-blue', 'face-blueish', 'face-blushed', 'face-blushing', 'face-bored', 'face-bored-alt',
      'face-bordered', 'face-bouche', 'face-bouncing-eyes', 'face-box-mouth', 'face-brain',
      'face-breathing-heavy', 'face-breathing', 'face-bright', 'face-brute', 'face-bubbles',
      'face-buck-teeth', 'face-bug-eyes', 'face-bug-eyes-lips', 'face-bulging-eyes', 'face-burned',
      'face-burst', 'face-butcher', 'face-button', 'face-buttons', 'face-buzz', 'face-cabbage-patch-kid',
      'face-cable', 'face-cactus', 'face-cafe', 'face-calf', 'face-call', 'face-calm', 'face-calmly',
      'face-camel', 'face-camera', 'face-candid', 'face-candle', 'face-candy', 'face-cane', 'face-canine',
      'face-canned', 'face-canyon', 'face-capable', 'face-cape', 'face-capitalist', 'face-captain',
      'face-captioned', 'face-capybara', 'face-car', 'face-carbon', 'face-carbonated', 'face-carcass',
      'face-carcinogenic', 'face-card', 'face-cardiac', 'face-cardigan', 'face-cardinal', 'face-care',
      'face-careful', 'face-careless', 'face-caress', 'face-caret', 'face-cargo', 'face-caribou',
      'face-caring', 'face-carnal', 'face-carnival', 'face-carnivore', 'face-carnivorous', 'face-carol',
      'face-caroler', 'face-carpal', 'face-carpenter', 'face-carping', 'face-carriage', 'face-carried',
      'face-carrier', 'face-carries', 'face-carrion', 'face-carrot', 'face-carrowboat', 'face-carrousel',
      'face-carry', 'face-cart', 'face-cartage', 'face-cartel', 'face-cartels', 'face-carthorse',
      'face-cartilage', 'face-cartload', 'face-cartography', 'face-carton', 'face-cartoon',
      'face-cartoony', 'face-cartouche', 'face-cartweel', 'face-cartwheel', 'face-carved', 'face-carvel',
      'face-carver', 'face-carving', 'face-case', 'face-cased', 'face-casement', 'face-cases',
      'face-casework', 'face-cash', 'face-cashew', 'face-cashier', 'face-casing', 'face-casino',
      'face-cask', 'face-casket', 'face-casserole', 'face-cassette', 'face-cassia', 'face-cassino',
      'face-cassis', 'face-cassock', 'face-cassowary', 'face-cast', 'face-castanet', 'face-castaway',
      'face-caste', 'face-caster', 'face-castigate', 'face-castigation', 'face-casting', 'face-castle',
      'face-castoff', 'face-castor', 'face-castrate', 'face-castration', 'face-casts', 'face-casual',
      'face-casually', 'face-casualness', 'face-casuals', 'face-casualty', 'face-casuarina',
      'face-casuist', 'face-casuistic', 'face-casuistry', 'face-casually', 'face-cat', 'face-catacomb',
      'face-catachrestic', 'face-catachrestical', 'face-catachrestically', 'face-catachrestic',
      'face-catachresis', 'face-cataclysm', 'face-cataclysmal', 'face-cataclysmic', 'face-cataclysms',
      'face-catacomb', 'face-catacombs', 'face-catacoustics', 'face-catadicrotic', 'face-catadioptric',
      'face-catadromous', 'face-catalase', 'face-catalectic', 'face-catalepsy', 'face-cataleptic',
      'face-cataleptics', 'face-cataler', 'face-catalers', 'face-catalinite', 'face-catall',
      'face-catalonia', 'face-catalonias', 'face-catalpa', 'face-catalpas', 'face-catalyses',
      'face-catalysis', 'face-catalyst', 'face-catalysts', 'face-catalytic', 'face-catalytical',
      'face-catalytically', 'face-catalyze', 'face-catalyzed', 'face-catalyzer', 'face-catalyzers',
      'face-catalyzes', 'face-catalyzing', 'face-catamaran', 'face-catamarans', 'face-catamenia',
      'face-catamenic', 'face-catamenial', 'face-catamite', 'face-catamites', 'face-catamitical',
      'face-catamoun', 'face-catamountain', 'face-catamounts', 'face-catamount', 'face-catamounts',
      'face-catamorphosis', 'face-catamphetamine', 'face-catamphora', 'face-catamphoric',
      'face-catamphoric', 'face-catanadromous', 'face-catanacodon', 'face-catananche', 'face-catanadrous',
      'face-catane', 'face-cataned', 'face-catanes', 'face-catangling', 'face-catania', 'face-catanias',
      'face-catanidal', 'face-catanide', 'face-catanides', 'face-catanids', 'face-catanilla',
      'face-catanillas', 'face-cataniloid', 'face-cataning', 'face-cataning', 'face-catanium',
      'face-catanoia', 'face-catanoias', 'face-catanormal', 'face-catanormal', 'face-catanos',
      'face-catanosis', 'face-catanotic', 'face-catanotics', 'face-catanous', 'face-catans',
      'face-catanthropic', 'face-catantropism', 'face-catanurie', 'face-catanuric', 'face-catanurus',
      'face-catanurian', 'face-catanurus', 'face-catanused', 'face-catanuses', 'face-catanuses',
      'face-catanutic', 'face-catanutia', 'face-catanutic', 'face-catanval', 'face-catanvale',
      'face-catanvales', 'face-catanvalia', 'face-catanvalia', 'face-catanvallia', 'face-catanvalian',
      'face-catanvallion', 'face-catanvallis', 'face-catanvally', 'face-catanvales', 'face-catanvalia',

      // Sports & Activities
      'dumbbell', 'dumbbells', 'barbell', 'barbells', 'weight-hanging', 'weights', 'weight-scale',
      'bicycle', 'bike', 'motorcycle', 'skateboard', 'scooter', 'roller-skates', 'rollerskates',
      'ice-skate', 'ice-skates', 'skis', 'ski', 'snowboard', 'snowboards', 'football', 'basketball',
      'baseball', 'baseball-bat-ball', 'baseball-bat', 'baseball-ball', 'soccer-ball', 'football-ball',
      'table-tennis', 'ping-pong', 'tennis-ball', 'badminton', 'badminton-racket', 'badminton-shuttlecock',
      'badminton-racket-bird', 'hockey-puck', 'hockey-sticks', 'field-hockey', 'field-hockey-stick',
      'field-hockey-ball', 'golf', 'golf-ball', 'golf-ball-tee', 'cricket', 'cricket-bat-ball',
      'cricket-bat', 'cricket-ball', 'billiards', 'pool-ball', 'billiard-rack', 'pool-rack',
      'bowling', 'bowling-ball', 'bowling-pins', 'bowling-pin', 'darts', 'dart', 'target',
      'curling-stone', 'curling', 'lacrosse', 'lacrosse-stick-ball', 'lacrosse-stick', 'lacrosse-ball',
      'rugby-ball', 'rugby', 'american-football-ball', 'american-football', 'flag-football',
      'archery', 'bow-arrow', 'quiver-arrows', 'quiver', 'arrows', 'arrow', 'boomerang',
      'boomerangs', 'boxing-glove', 'boxing-gloves', 'martial-arts-uniform', 'martial-arts',
      'karate', 'karate-uniform', 'taekwondo-uniform', 'sword', 'swords', 'crossed-swords',
      'crossed-swords-axes', 'shield', 'shields', 'helmet', 'helmets', 'armor', 'breastplate',
      'medal', 'medals', 'medal-military', 'military-medal', 'trophy', 'trophies', 'ribbon',
      'ribbons', 'wreath', 'wreaths', 'crown', 'crowns', 'tiara', 'tiaras', 'first-place-medal',
      'first-place', 'second-place-medal', 'second-place', 'third-place-medal', 'third-place',
      'racing-flag', 'racing-flags', 'checkered-flag', 'checkered-flags', 'flag', 'flags',
      'crossed-flags', 'waving-flag', 'waving-flags', 'pirate-flag', 'pirate-flags', 'white-flag',
      'white-flags', 'rainbow-flag', 'rainbow-flags', 'transgender-flag', 'flag-stripes',
      'gymnast', 'gymnastics', 'person-cartwheeling', 'person-cartwheeling-alt', 'person-climbing',
      'person-climbing-alt', 'person-diving', 'person-golfing', 'person-hiking', 'person-hiking-alt',
      'person-juggling', 'person-mountain-biking', 'person-mountain-biking-alt', 'person-rowing-boat',
      'person-rowing-boat-alt', 'person-running', 'person-running-alt', 'person-snowboarding',
      'person-snowboarding-alt', 'person-surfing', 'person-surfing-alt', 'person-swimming',
      'person-swimming-alt', 'person-walking', 'person-walking-alt', 'person-walking-luggage',
      'person-with-ball', 'person-biking', 'person-biking-alt', 'person-biking-mountain',
      'person-biking-mountain-alt', 'person-fencing', 'person-hiking-alt', 'person-standing',
      'person-standing-alt', 'person-standing-dress', 'person-standing-dress-alt',

      // Colors & Symbols
      'palette', 'palettes', 'paint-brush', 'paint-roller', 'paintbrush', 'painter', 'painting',
      'crayon', 'crayons', 'marker', 'markers', 'pen', 'pens', 'pencil', 'pencils', 'pencil-ruler',
      'pencil-square', 'highlighter', 'highlighters', 'eraser', 'erasers', 'sharpener', 'sharpeners',
      'ruler', 'rulers', 'compass', 'compasses', 'protractor', 'protractors', 'abacus', 'abacuses',
      'straightedge', 'straightedges', 'set-square', 'set-squares', 'triangle-ruler', 'triangle-rulers',
      'geometry-set', 'geometry-sets', 'drafting-compass', 'dividers', 'divider', 'compass-drafting',
      'pencil-compass', 'scissors', 'paper-scissors', 'utility-knife', 'utility-knives', 'craft-knife',
      'x-acto-knife', 'xacto', 'cutting-board', 'cutting-boards', 'cutting-mat', 'cutting-mats',
      'tape', 'scotch-tape', 'adhesive-tape', 'masking-tape', 'painters-tape', 'duct-tape',
      'medical-tape', 'tape-roll', 'tape-rolls', 'packaging-tape', 'clear-tape', 'tape-dispenser',
      'tape-dispensers', 'stapler', 'staplers', 'staple', 'staples', 'staple-remover', 'remover',
      'glue', 'glue-stick', 'glue-sticks', 'glue-bottle', 'paste', 'paste-stick', 'adhesive',
      'tack', 'thumbtack', 'thumbtacks', 'push-pin', 'push-pins', 'drawing-pin', 'drawing-pins',
      'pin', 'pins', 'safety-pin', 'safety-pins', 'paperclip', 'paperclips', 'paper-clip',
      'jumbo-paper-clip', 'paper-clips', 'fastener', 'fasteners', 'rubber-band', 'rubber-bands',
      'elastic-band', 'binder-clip', 'binder-clips', 'bulldog-clip', 'bull-dog-clip', 'c-clamp',
      'clamp', 'clamps', 'vise', 'vice', 'vises', 'clothespin', 'clothespins', 'clamp-c',
      'spring-clamp', 'spring-clamps', 'quick-clamp', 'quick-clamps', 'band-clamp', 'band-clamps',
      'corner-clamp', 'corner-clamps', 'pipe-clamp', 'pipe-clamps', 'bar-clamp', 'bar-clamps',
      'handscrew-clamp', 'handscrew-clamps', 'f-clamp', 'f-clamps', 'bar-f-clamp', 'parallel-clamp',
      'edge-clamp', 'one-hand-clamp', 'one-handed-clamp', 'large-clamp', 'heavy-duty-clamp',
      'trigger-clamp', 'three-way-clamp', 'cushioned-clamp', 'soft-jaw-clamp', 'low-profile-clamp',
      'deep-reach-clamp', 'deep-throat-clamp', 'woodworking-clamp', 'metalworking-clamp',
      'automotive-clamp', 'silicone-clamp', 'vinyl-clamp', 'rubber-clamp', 'plastic-clamp',
      'adjustable-clamp', 'ratchet-clamp', 'lever-clamp', 'toggle-clamp', 'pneumatic-clamp',
      'hydraulic-clamp', 'electric-clamp', 'magnetic-clamp', 'vacuum-clamp', 'suction-cup-clamp',
      'adhesive-clamp', 'magnetic-v-block-clamp', 'corner-brace-clamp', 'parallel-jaw-clamp',
      'quick-release-clamp', 'screw-clamp', 'machinist-clamp', 'utility-clamp', 'industrial-clamp',
      'general-purpose-clamp', 'light-duty-clamp', 'medium-duty-clamp', 'heavy-duty-large-clamp',
      'professional-clamp', 'commercial-clamp', 'extra-large-clamp', 'adjustable-bar-clamp',
      'extending-clamp', 'spreading-clamp', 'spreader-bar', 'pipe-spreader', 'adjustable-spreader',
      'jack-spreader', 'hydraulic-spreader', 'pneumatic-spreader', 'electric-spreader',
      'portable-spreader', 'rescue-spreader', 'automotive-spreader', 'industrial-spreader',
      'glass-clamp', 'acrylic-clamp', 'plastic-clamp-soft', 'foam-clamp', 'felt-clamp',
      'fabric-clamp', 'leather-clamp', 'wood-clamp', 'metal-clamp', 'steel-clamp', 'iron-clamp',
      'aluminum-clamp', 'brass-clamp', 'copper-clamp', 'nickel-clamp', 'chrome-clamp',
      'stainless-steel-clamp', 'galvanized-clamp', 'zinc-clamp', 'painted-clamp', 'epoxy-clamp',
      'powder-coated-clamp', 'lacquered-clamp', 'anodized-clamp', 'sealed-clamp', 'treated-clamp'
    ];

    return iconNames.map(name => ({
      name,
      label: name.replace(/-/g, ' '),
      class: `fas fa-${name}`,
      styles: ['solid']
    }));
  }


  filterIcons() {
    const query = this.searchQuery.toLowerCase().trim();
    if (!query) {
      this.filteredIcons = [...this.icons];
      return;
    }

    this.filteredIcons = this.icons.filter(icon =>
      icon.name.includes(query) || icon.label.includes(query)
    );
  }

  onDragStart(event: DragEvent, icon: FAIcon) {
    console.log('ICON PICKER: dragstart fired for icon:', icon.name);
    const dragImage = document.createElement('div');
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-9999px';
    dragImage.style.width = '40px';
    dragImage.style.height = '40px';
    dragImage.style.display = 'flex';
    dragImage.style.alignItems = 'center';
    dragImage.style.justifyContent = 'center';
    dragImage.style.background = '#5c5cff';
    dragImage.style.borderRadius = '6px';
    dragImage.style.fontSize = '24px';
    dragImage.style.color = 'white';

    const iconEl = document.createElement('i');
    iconEl.className = icon.class;
    dragImage.appendChild(iconEl);
    document.body.appendChild(dragImage);

    const payload = JSON.stringify({
      blockType: 'fa-icon',
      label: icon.label,
      icon: icon.name,
      class: icon.class
    });

    event.dataTransfer!.setDragImage(dragImage, 20, 20);
    event.dataTransfer!.effectAllowed = 'copy';
    event.dataTransfer!.setData('application/x-brochure-block', payload);
    event.dataTransfer!.setData('text/plain', payload);

    // Fallback for iframe drag/drop
    try {
      (window.parent as any).__BROCHURE_FLOW_DRAG__ = JSON.parse(payload);
    } catch (e) {
      console.warn('Failed to set fallback drag data', e);
    }

    setTimeout(() => document.body.removeChild(dragImage), 0);
  }
}
