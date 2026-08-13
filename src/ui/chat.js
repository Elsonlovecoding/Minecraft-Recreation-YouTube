// ui/chat.js — Phase 27: the chat/command bar. Pressing T (or '/', which
// arrives with the slash already typed) opens a single-line input in the
// bottom-left corner — vanilla's chat spot. The game KEEPS RUNNING while it
// is open, exactly like the sign editor: pointer lock releases, main.js's
// pause verdict consults `isOpen`, and closing (Enter or Escape) requests
// the pointer back. Enter hands the line to main.js's onCommand — this file
// owns only the DOM and the key routing, never a game rule (the signs.js
// division of labour). ArrowUp/ArrowDown recall recent lines.
//
// All tunables in config.js CHAT.

import { CHAT } from '../config.js';

export function createChat({ canvas, onCommand, canOpen }) {
  let panel = null;
  let input = null;
  let open = false;
  const history = [];
  let historyAt = 0; // index into history while recalling; length = "fresh"
  let draft = '';    // what was typed before ArrowUp started recalling

  const hint = () => document.getElementById('lock-hint');

  function injectPanel() {
    if (panel) return;
    const style = document.createElement('style');
    style.textContent = `
      #mc-chat {
        position: fixed; z-index: 30;
        left: ${CHAT.LEFT_PX}px; bottom: ${CHAT.BOTTOM_PX}px;
        width: ${CHAT.WIDTH_PX}px;
      }
      #mc-chat input {
        width: 100%; box-sizing: border-box;
        background: rgba(0, 0, 0, 0.55);
        border: 2px solid rgba(255, 255, 255, 0.25);
        color: #f2f2f2;
        font: ${CHAT.FONT_PX}px/1.5 monospace;
        padding: 4px 8px;
        outline: none;
      }
    `;
    document.head.appendChild(style);
    panel = document.createElement('div');
    panel.id = 'mc-chat';
    panel.style.display = 'none';
    input = document.createElement('input');
    input.maxLength = CHAT.MAX_LENGTH;
    input.autocomplete = 'off';
    input.spellcheck = false;
    // Keys typed into the chat must never reach the game's own listeners
    // (the sign editor's rule).
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const line = input.value;
        closeChat(true);
        if (line.trim()) {
          history.push(line);
          if (history.length > CHAT.HISTORY) history.shift();
          onCommand(line);
        }
      } else if (e.key === 'Escape') {
        closeChat(true);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (history.length === 0) return;
        if (historyAt === history.length) draft = input.value;
        historyAt = Math.max(0, Math.min(history.length,
          historyAt + (e.key === 'ArrowUp' ? -1 : 1)));
        input.value = historyAt === history.length ? draft : history[historyAt];
      }
    });
    panel.appendChild(input);
    document.body.appendChild(panel);
  }

  function openChat(prefill = '') {
    injectPanel();
    if (open) return;
    open = true;
    if (document.pointerLockElement) document.exitPointerLock();
    hint()?.classList.add('mc-suppressed');
    panel.style.display = 'block';
    input.value = prefill;
    historyAt = history.length;
    draft = '';
    input.focus();
  }

  function closeChat(relock) {
    if (!open) return;
    open = false;
    panel.style.display = 'none';
    input.blur();
    hint()?.classList.remove('mc-suppressed');
    if (relock && canvas) {
      const req = canvas.requestPointerLock();
      if (req && typeof req.catch === 'function') req.catch(() => {});
    }
  }

  // The opener. preventDefault stops the trigger key from typing itself
  // into the freshly focused input.
  document.addEventListener('keydown', (e) => {
    if (open) return;
    const isOpenKey = e.code === CHAT.OPEN_KEY;
    const isCmdKey = e.code === CHAT.COMMAND_KEY;
    if (!isOpenKey && !isCmdKey) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (!canOpen()) return;
    e.preventDefault();
    openChat(isCmdKey ? '/' : '');
  });

  // Clicking back onto the canvas relocks the pointer through the normal
  // click path — an acquired lock means the chat was dismissed.
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas && open) closeChat(false);
  });

  return {
    open: openChat,
    close: closeChat,
    get isOpen() {
      return open;
    },
  };
}
