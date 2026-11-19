import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { calculatePopoverCoords } from './popoverPositioning.js';
import './ReviewMoreActionsMenu.css';

/**
 * ReviewMoreActionsMenu
 *
 * Compact "•••" actions menu in the Review Workspace toolbar.
 * Consolidates secondary/export/reporting actions into an anchored popover dropdown:
 * - Download Image Report (PDF)
 * - Export Image… (Full-res image with annotations)
 * - Version History (Audit trail & version inspection)
 *
 * Preserves all permissions, disabled states, tooltips, and click handlers while
 * preventing toolbar button collisions on constrained viewports.
 */
export function ReviewMoreActionsMenu({
  onDownloadImageReport,
  isGeneratingReport = false,
  isAnnotationsLoading = false,
  onOpenExport,
  isExportDisabled = false,
  onOpenHistory,
  versionNumber = 1,
  onRotateCW = null,
  onRotateCCW = null,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const updateCoords = useCallback(() => {
    if (!buttonRef.current) return;
    const nextCoords = calculatePopoverCoords(buttonRef.current, {
      preferredWidth: 230,
      estimatedHeight: onRotateCW || onRotateCCW ? 220 : 150,
      maxLimitHeight: 320,
      margin: 8,
      gap: 6,
      align: 'right',
      preferBelow: true,
    });
    setCoords(nextCoords);
  }, [onRotateCW, onRotateCCW]);

  useLayoutEffect(() => {
    if (isOpen) {
      updateCoords();
    }
  }, [isOpen, updateCoords]);

  useEffect(() => {
    if (!isOpen) return;

    const handleUpdate = () => {
      updateCoords();
    };

    const handleClickOutside = (event) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, updateCoords]);

  const handleDownloadClick = () => {
    if (isGeneratingReport || isAnnotationsLoading) return;
    setIsOpen(false);
    onDownloadImageReport?.();
  };

  const handleExportClick = () => {
    if (isExportDisabled) return;
    setIsOpen(false);
    onOpenExport?.();
  };

  const handleHistoryClick = () => {
    setIsOpen(false);
    onOpenHistory?.();
  };

  return (
    <div className="fc-review-more-container">
      <button
        ref={buttonRef}
        type="button"
        className={`fc-btn fc-btn-secondary fc-btn-sm fc-review-more-btn ${
          isOpen ? 'fc-review-more-btn-active' : ''
        }`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="More image actions"
        title="More image actions (Download Report, Export, History)"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      </button>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              className="fc-review-more-dropdown"
              role="menu"
              aria-label="More image actions"
              style={{
                position: 'fixed',
                left: `${coords?.left ?? 0}px`,
                top: coords?.top !== 'auto' ? `${coords?.top ?? 0}px` : 'auto',
                bottom: coords?.bottom !== 'auto' ? `${coords?.bottom ?? 0}px` : 'auto',
                width: coords?.width ? `${coords.width}px` : '230px',
                maxHeight: coords?.maxHeight ? `${coords.maxHeight}px` : '300px',
              }}
            >
              {/* 1. Download Image Report */}
              <button
                type="button"
                className="fc-review-more-item"
                role="menuitem"
                onClick={handleDownloadClick}
                disabled={isGeneratingReport || isAnnotationsLoading}
                title="Download comprehensive PDF report for this image and its annotations"
              >
                {isGeneratingReport ? (
                  <svg
                    className="fc-review-more-icon fc-review-more-spinner"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <line x1="12" y1="2" x2="12" y2="6" />
                    <line x1="12" y1="18" x2="12" y2="22" />
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                    <line x1="2" y1="12" x2="6" y2="12" />
                    <line x1="18" y1="12" x2="22" y2="12" />
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                  </svg>
                ) : (
                  <svg
                    className="fc-review-more-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                )}
                <span className="fc-review-more-text">
                  {isGeneratingReport ? 'Generating PDF…' : 'Download Image Report'}
                </span>
              </button>

              {/* 2. Export Image */}
              <button
                type="button"
                className="fc-review-more-item"
                role="menuitem"
                onClick={handleExportClick}
                disabled={isExportDisabled}
                title="Export full-resolution image with vector annotations"
              >
                <svg
                  className="fc-review-more-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span className="fc-review-more-text">Export Image…</span>
              </button>

              {/* 3. Version History */}
              <button
                type="button"
                className="fc-review-more-item"
                role="menuitem"
                onClick={handleHistoryClick}
                title="View complete version history and audit trail"
              >
                <svg
                  className="fc-review-more-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span className="fc-review-more-text">Version History</span>
                <span className="fc-review-more-version-badge">v{versionNumber}</span>
              </button>

              {/* 4. Rotate CCW */}
              {onRotateCCW ? (
                <button
                  type="button"
                  className="fc-review-more-item"
                  role="menuitem"
                  onClick={() => {
                    setIsOpen(false);
                    onRotateCCW();
                  }}
                  title="Rotate 90° Counter-Clockwise ([)"
                >
                  <svg
                    className="fc-review-more-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  <span className="fc-review-more-text">Rotate 90° CCW</span>
                  <kbd className="fc-shortcut-kbd">[</kbd>
                </button>
              ) : null}

              {/* 5. Rotate CW */}
              {onRotateCW ? (
                <button
                  type="button"
                  className="fc-review-more-item"
                  role="menuitem"
                  onClick={() => {
                    setIsOpen(false);
                    onRotateCW();
                  }}
                  title="Rotate 90° Clockwise (])"
                >
                  <svg
                    className="fc-review-more-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span className="fc-review-more-text">Rotate 90° CW</span>
                  <kbd className="fc-shortcut-kbd">]</kbd>
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

