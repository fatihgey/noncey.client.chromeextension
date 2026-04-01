// noncey — field picker
// Injected programmatically by the options page when the user clicks "Pick field".
// Highlights input/textarea elements on hover; on click, generates a CSS selector
// and signals the result back via chrome.runtime.sendMessage → background →
// chrome.storage.session, where the options page picks it up.

'use strict';

(function () {
  // Guard against double-injection.
  if (window.__nonceyPickerActive) return;
  window.__nonceyPickerActive = true;

  let highlighted = null;

  // ── Banner ────────────────────────────────────────────────────────────────
  const banner = document.createElement('div');
  Object.assign(banner.style, {
    position:        'fixed',
    top:             '0',
    left:            '0',
    right:           '0',
    zIndex:          '2147483647',
    background:      '#00897b',
    color:           '#fff',
    fontFamily:      'system-ui, sans-serif',
    fontSize:        '14px',
    padding:         '8px 16px',
    textAlign:       'center',
    boxShadow:       '0 2px 6px rgba(0,0,0,.3)',
    cursor:          'default',
  });
  banner.textContent = 'noncey: click the OTP input field  —  Esc to cancel';
  document.body.appendChild(banner);

  // ── Hover highlight ───────────────────────────────────────────────────────
  function onMouseover(e) {
    const target = e.target.closest('input:not([type=hidden]), textarea');
    if (!target) return;
    if (highlighted && highlighted !== target) clearHighlight(highlighted);
    highlighted = target;
    target._nonceyOutline = target.style.outline;
    target._nonceyOutlineOffset = target.style.outlineOffset;
    target.style.outline       = '3px solid #00897b';
    target.style.outlineOffset = '1px';
  }

  function clearHighlight(el) {
    if (!el) return;
    el.style.outline       = el._nonceyOutline       ?? '';
    el.style.outlineOffset = el._nonceyOutlineOffset ?? '';
  }

  // ── Click capture ─────────────────────────────────────────────────────────
  function onClick(e) {
    const target = e.target.closest('input:not([type=hidden]), textarea');
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    finish(generateSelector(target));
  }

  // ── Escape to cancel ──────────────────────────────────────────────────────
  function onKeydown(e) {
    if (e.key === 'Escape') finish(null);
  }

  // ── CSS selector generation ───────────────────────────────────────────────
  function generateSelector(el) {
    if (el.id)   return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    // Fallback: type + any data-testid / data-cy hint
    const attrs = ['data-testid', 'data-cy', 'data-qa', 'aria-label'].find(
      a => el.getAttribute(a)
    );
    if (attrs) return `${el.tagName.toLowerCase()}[${attrs}="${CSS.escape(el.getAttribute(attrs))}"]`;
    if (el.type && el.type !== 'text')
      return `${el.tagName.toLowerCase()}[type="${el.type}"]`;
    return el.tagName.toLowerCase();
  }

  // ── Teardown ──────────────────────────────────────────────────────────────
  function finish(selector) {
    clearHighlight(highlighted);
    banner.remove();
    document.removeEventListener('mouseover', onMouseover, true);
    document.removeEventListener('click',     onClick,     true);
    document.removeEventListener('keydown',   onKeydown,   true);
    window.__nonceyPickerActive = false;
    if (selector !== null) {
      chrome.runtime.sendMessage({ type: 'PICKER_RESULT', selector, url: window.location.href });
    }
  }

  document.addEventListener('mouseover', onMouseover, true);
  document.addEventListener('click',     onClick,     true);
  document.addEventListener('keydown',   onKeydown,   true);
})();
