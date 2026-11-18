/**
 * Shared Viewport-Aware Popover Positioning Utility
 *
 * Provides shared boundary detection, viewport clamping, stacking-context breakout,
 * and upward/downward auto-placement for top header and floating toolbar popovers
 * (such as Active Collaborators Popover and Workspace Layout Menu Popover).
 *
 * @param {HTMLElement} triggerEl - Trigger button element
 * @param {Object} options
 * @param {number} [options.preferredWidth=320] - Preferred popover width in px
 * @param {number} [options.estimatedHeight=400] - Estimated height used to evaluate upward vs downward placement
 * @param {number} [options.maxLimitHeight=520] - Upper bound on max-height
 * @param {number} [options.margin=12] - Minimum margin from viewport edges in px
 * @param {number} [options.gap=8] - Spacing between trigger button and popover edge in px
 * @param {'right'|'left'|'center'|'auto'} [options.align='right'] - Horizontal alignment relative to trigger
 * @param {boolean} [options.preferBelow=false] - When true, prefers opening downward unless space below is constrained
 * @returns {Object|null} Coords object { left, top, bottom, maxHeight, width, openUpward } or null
 */
export function calculatePopoverCoords(triggerEl, {
  preferredWidth = 320,
  estimatedHeight = 400,
  maxLimitHeight = 520,
  margin = 12,
  gap = 8,
  align = 'right',
  preferBelow = false,
} = {}) {
  if (!triggerEl || typeof window === 'undefined') return null;

  const btnRect = triggerEl.getBoundingClientRect();
  const popoverWidth = Math.min(preferredWidth, window.innerWidth - (margin * 2));

  const spaceAbove = btnRect.top - margin;
  const spaceBelow = window.innerHeight - btnRect.bottom - margin;

  // Prefer opening above or below based on preferBelow and space availability without clipping
  const openUpward = preferBelow
    ? spaceBelow < estimatedHeight && spaceAbove > spaceBelow && spaceAbove >= 160
    : spaceAbove >= estimatedHeight || (spaceAbove > spaceBelow && spaceAbove >= 160);

  // Auto-alignment: align left if trigger is in left half of screen, right if in right half
  const isLeftHalf = (btnRect.left + (btnRect.width / 2)) < (window.innerWidth / 2);
  const effectiveAlign = align === 'auto' ? (isLeftHalf ? 'left' : 'right') : align;

  // Neatly align horizontally with the button (default right-aligned to trigger, center or left), clamped safely within viewport margins
  const idealLeft = effectiveAlign === 'center'
    ? btnRect.left + (btnRect.width / 2) - (popoverWidth / 2)
    : effectiveAlign === 'right'
      ? btnRect.right - popoverWidth
      : btnRect.left;
  const clampedLeft = Math.max(margin, Math.min(idealLeft, window.innerWidth - popoverWidth - margin));

  const availableHeight = openUpward ? spaceAbove - gap : spaceBelow - gap;
  const maxHeight = Math.max(160, Math.min(maxLimitHeight, availableHeight));

  return {
    left: Math.round(clampedLeft),
    top: openUpward ? 'auto' : Math.round(btnRect.bottom + gap),
    bottom: openUpward ? Math.round(window.innerHeight - btnRect.top + gap) : 'auto',
    maxHeight: Math.round(maxHeight),
    width: Math.round(popoverWidth),
    openUpward,
  };
}

