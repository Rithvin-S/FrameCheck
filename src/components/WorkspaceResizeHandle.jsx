import { useCallback, useEffect, useRef, useState } from 'react';
import './WorkspaceResizeHandle.css';

/**
 * Phase 21A: Workspace Resize Handle
 * Interactive separator providing drag-based and keyboard-accessible panel resizing.
 */
export function WorkspaceResizeHandle({
  id = 'workspace-resize-handle',
  side = 'left',
  currentWidth = 250,
  minWidth = 180,
  maxWidth = 450,
  onResize,
  onResizeEnd,
  onToggleCollapse,
  isCollapsed = false,
  panelTitle = 'Panel',
  disabled = false,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const handleRef = useRef(null);
  const dragStartRef = useRef({ startX: 0, startWidth: 0 });

  const handlePointerDown = useCallback(
    (e) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();

      const handleEl = handleRef.current;
      if (handleEl && handleEl.setPointerCapture) {
        try {
          handleEl.setPointerCapture(e.pointerId);
        } catch {
          // Fallback if pointer capture is not supported
        }
      }

      dragStartRef.current = {
        startX: e.clientX,
        startWidth: isCollapsed ? minWidth : currentWidth,
      };

      setIsDragging(true);
      document.body.classList.add('fc-workspace-resizing');
    },
    [currentWidth, disabled, isCollapsed, minWidth]
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (!isDragging) return;
      e.preventDefault();

      const { startX, startWidth } = dragStartRef.current;
      const deltaX = e.clientX - startX;

      // For left side, dragging right expands; for right side, dragging left expands
      const rawWidth = side === 'left' ? startWidth + deltaX : startWidth - deltaX;
      const clampedWidth = Math.min(Math.max(rawWidth, minWidth), maxWidth);

      onResize?.(clampedWidth);
    },
    [isDragging, maxWidth, minWidth, onResize, side]
  );

  const handlePointerUp = useCallback(
    (e) => {
      if (!isDragging) return;
      e.preventDefault();

      const handleEl = handleRef.current;
      if (handleEl && handleEl.releasePointerCapture) {
        try {
          handleEl.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
      }

      const { startX, startWidth } = dragStartRef.current;
      const deltaX = e.clientX - startX;
      const rawWidth = side === 'left' ? startWidth + deltaX : startWidth - deltaX;
      const finalWidth = Math.min(Math.max(rawWidth, minWidth), maxWidth);

      setIsDragging(false);
      document.body.classList.remove('fc-workspace-resizing');
      onResizeEnd?.(finalWidth);
    },
    [isDragging, maxWidth, minWidth, onResizeEnd, side]
  );

  useEffect(() => {
    return () => {
      document.body.classList.remove('fc-workspace-resizing');
    };
  }, []);

  const handleDoubleClick = (e) => {
    e.preventDefault();
    onToggleCollapse?.();
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    const step = e.shiftKey ? 25 : 10;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = side === 'left' ? -step : step;
      const nextW = Math.min(Math.max(currentWidth + delta, minWidth), maxWidth);
      onResize?.(nextW);
      onResizeEnd?.(nextW);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = side === 'left' ? step : -step;
      const nextW = Math.min(Math.max(currentWidth + delta, minWidth), maxWidth);
      onResize?.(nextW);
      onResizeEnd?.(nextW);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleCollapse?.();
    } else if (e.key === 'Home') {
      e.preventDefault();
      onResize?.(minWidth);
      onResizeEnd?.(minWidth);
    } else if (e.key === 'End') {
      e.preventDefault();
      onResize?.(maxWidth);
      onResizeEnd?.(maxWidth);
    }
  };

  const tooltipText = isCollapsed
    ? `Double-click to expand ${panelTitle}`
    : `Drag to resize ${panelTitle} (Double-click to collapse)`;

  return (
    <div
      ref={handleRef}
      id={id}
      role="separator"
      tabIndex={disabled ? -1 : 0}
      aria-orientation="vertical"
      aria-label={`Resize ${panelTitle}`}
      aria-valuenow={currentWidth}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      title={tooltipText}
      className={`fc-workspace-resize-handle fc-resize-handle-${side}${
        isDragging ? ' fc-resize-handle-active' : ''
      }${isCollapsed ? ' fc-resize-handle-collapsed' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="fc-resize-handle-grip" aria-hidden="true">
        <span className="fc-resize-grip-line" />
      </div>
    </div>
  );
}

