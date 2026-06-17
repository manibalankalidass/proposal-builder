/**
 * @fileoverview VoiceText block — speak to type using the Web Speech API.
 *
 * Drop this block on the canvas, then click the mic button to start dictating.
 * Text appears live as you speak (interim results shown as ghost text; final
 * transcripts are committed to the editable area).
 *
 * Language support: en-US (American), en-GB (British), en-IN (Indian English).
 * No API keys required — uses the browser's built-in SpeechRecognition.
 *
 * Exposes: window.VoiceText.createBlock()
 */
(function () {
  window.VoiceText = window.VoiceText || {};

  const hash = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2);

  // Track active recognizer per block so we can stop it on teardown.
  const recognizers = new WeakMap();

  /* ------------------------------------------------------------------ */
  /* Block DOM builder                                                     */
  /* ------------------------------------------------------------------ */

  function createBlock() {
    const block = document.createElement('div');
    block.className = 'cs_block_s cs-voice-text-block';
    block.setAttribute('data', 'Voice Text');
    block.setAttribute('custom-name', 'Voice Text');
    block.dataset.blockType = 'voice-text';

    // Flex row: [text  ←  grows  →] [wave + mic button]
    const layout = document.createElement('div');
    layout.className = 'cs-voice-layout';

    // Left: editable text area — CustomRichEditor attaches here
    const editMe = document.createElement('div');
    editMe.className = 'edit_me cs-voice-text-content fr-element fr-view';
    editMe.id = `dynamic_${hash()}`;
    editMe.setAttribute('placeholder', 'Tap mic to dictate, or click to type…');
    editMe.style.fontSize = '14px';
    editMe.style.lineHeight = '1.7';

    // Right: wave bars + mic button (hidden until selected/editing via CSS)
    const controls = document.createElement('div');
    controls.className = 'cs-voice-controls';
    controls.innerHTML = `
      <span class="cs-voice-wave">
        <span></span><span></span><span></span><span></span><span></span>
      </span>
      <button class="cs-voice-mic-btn" title="Click to start / stop dictation">
        <svg class="cs-voice-mic-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="9" y="2" width="6" height="11" rx="3"/>
          <path d="M5 10a7 7 0 0 0 14 0"/>
          <line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <line x1="9" y1="22" x2="15" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span class="cs-voice-mic-label">Speak</span>
      </button>
    `;

    layout.appendChild(editMe);
    layout.appendChild(controls);

    // Interim ghost text — shown below the layout while speaking
    const interim = document.createElement('div');
    interim.className = 'cs-voice-interim';

    block.appendChild(layout);
    block.appendChild(interim);

    _initVoiceUI(block);
    return block;
  }

  /* ------------------------------------------------------------------ */
  /* Voice UI logic                                                        */
  /* ------------------------------------------------------------------ */

  function _initVoiceUI(block) {
    const micBtn    = block.querySelector('.cs-voice-mic-btn');
    const micLabel  = block.querySelector('.cs-voice-mic-label');
    const waveEl    = block.querySelector('.cs-voice-wave');
    const statusText = block.querySelector('.cs-voice-status-text'); // optional element
    const interimEl = block.querySelector('.cs-voice-interim');
    const editMe    = block.querySelector('.edit_me');

    let recognition   = null;
    let isRecording   = false;
    let selectedLang  = 'en-US';
    let silenceTimer  = null;

    // Show wave while speaking; hide 400ms after the last interim result arrives.
    // This is more reliable than onsoundstart/onsoundend which Chrome doesn't fire consistently.
    const _showWave = () => {
      clearTimeout(silenceTimer);
      waveEl.classList.add('active');
    };
    const _hideWaveAfterSilence = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => waveEl.classList.remove('active'), 400);
    };

    // Language toggle
    // Mic button
    micBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    micBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isRecording) _stop(); else _start();
    });

    function _start() {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) {
        if (statusText) statusText.textContent = '⚠ Speech not supported in this browser (use Chrome/Edge)';
        micLabel.textContent = '⚠ No support';
        return;
      }

      recognition = new SpeechRec();
      recognition.lang = selectedLang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        isRecording = true;
        micBtn.classList.add('recording');
        // Wave starts only when actual sound is detected (onsoundstart below)
        micLabel.textContent = 'Stop';
        if (statusText) statusText.textContent = 'Listening…';
        block.classList.add('cs-voice-recording');
      };

      recognition.onresult = (event) => {
        // Any result (interim or final) means speech is happening right now
        _showWave();
        _hideWaveAfterSilence(); // reset 400ms silence countdown

        let interimText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            _appendText(editMe, transcript.trim() + ' ');
            interimEl.textContent = '';
          } else {
            interimText += transcript;
          }
        }
        interimEl.textContent = interimText;
      };

      recognition.onerror = (event) => {
        if (event.error === 'no-speech') {
          // Silent pause — onend will auto-restart, nothing to do
          return;
        }
        if (event.error === 'not-allowed') {
          if (statusText) statusText.textContent = '⚠ Mic access denied — check browser permissions';
          _stop();
        } else {
          if (statusText) statusText.textContent = `Error: ${event.error}`;
          _stop();
        }
      };

      recognition.onend = () => {
        // Auto-restart to keep continuous dictation going
        if (isRecording) {
          setTimeout(() => { try { recognition && recognition.start(); } catch (_) { } }, 150);
        }
      };

      try {
        recognition.start();
        recognizers.set(block, recognition);
      } catch (err) {
        if (statusText) statusText.textContent = `Could not start mic: ${err.message}`;
      }
    }

    function _stop() {
      isRecording = false;
      clearTimeout(silenceTimer);
      micBtn.classList.remove('recording');
      waveEl.classList.remove('active');
      micLabel.textContent = 'Speak';
      if (statusText) statusText.textContent = 'Click mic to dictate';
      block.classList.remove('cs-voice-recording');
      interimEl.textContent = '';

      if (recognition) {
        try { recognition.stop(); } catch (_) { }
        recognition = null;
      }
      recognizers.delete(block);
    }

    // Stop recording when block loses selection/editing state (user clicked outside)
    new MutationObserver(() => {
      if (!isRecording) return;
      const isActive = block.classList.contains('cs-selected') ||
                       block.classList.contains('cs-editing');
      if (!isActive) _stop();
    }).observe(block, { attributes: true, attributeFilter: ['class'] });

    // Stop recording if block is removed from DOM
    new MutationObserver(() => {
      if (!document.contains(block) && isRecording) _stop();
    }).observe(document.body, { childList: true, subtree: false });

    // Expose stop for external teardown (e.g. inline-editor exit)
    block._voiceStop = _stop;
  }

  /* ------------------------------------------------------------------ */
  /* Text insertion                                                        */
  /* ------------------------------------------------------------------ */

  function _appendText(editMe, text) {
    if (!text) return;

    if (editMe.contentEditable === 'true') {
      // Focus the editMe so execCommand targets it reliably
      editMe.focus();

      // Move caret to the very end of content before inserting
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editMe);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      // execCommand is the safest way to insert text while keeping undo history
      const ok = document.execCommand('insertText', false, text);
      if (!ok) {
        // execCommand not supported (rare) — fall back to direct text node
        _appendRaw(editMe, text);
      }
    } else {
      // Not in edit mode yet — write directly to DOM
      _appendRaw(editMe, text);
    }
  }

  function _appendRaw(editMe, text) {
    // Append to the last text node if possible, otherwise create one
    const last = editMe.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) {
      last.textContent += text;
    } else {
      editMe.appendChild(document.createTextNode(text));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                            */
  /* ------------------------------------------------------------------ */

  window.VoiceText.createBlock = createBlock;

  // Allow inline-editor to stop recording when exiting edit mode
  window.VoiceText.stopBlock = (block) => {
    if (block && typeof block._voiceStop === 'function') block._voiceStop();
  };
})();
