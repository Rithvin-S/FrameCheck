import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { calculatePopoverCoords } from './popoverPositioning.js';
import { BUILTIN_PRESETS } from '../services/workspaceLayoutService.js';
import './WorkspaceLayoutMenu.css';

/**
 * Phase 21B: Workspace Layout & Visibility Popover Menu.
 * Controls panel visibility toggles (with non-empty guardrails), panel dock swapping,
 * default size resets, preset selection, and custom layout saving/deletion.
 */
export function WorkspaceLayoutMenu({
  panelLayout = 'default',
  onTogglePanelLayout,
  onResetPanelSizes,
  isThumbnailsVisible = true,
  onToggleThumbnailsVisible,
  isSidebarVisible = true,
  onToggleSidebarVisible,
  onShowAllPanels,
  activeLayoutId = 'preset-default',
  activeLayoutName = 'Default',
  isModified = false,
  savedLayouts = [],
  onApplyLayout,
  onSaveLayout,
  onDeleteLayout,
  onOpenPreferences = null,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [layoutCoords, setLayoutCoords] = useState(null);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const inputRef = useRef(null);

  // Viewport-aware positioning calculation ensuring popover stays above the toolbar and within viewport bounds
  const updateLayoutCoords = useCallback(() => {
    const trigger = buttonRef.current || menuRef.current;
    if (!trigger) return;
    const coords = calculatePopoverCoords(trigger, {
      preferredWidth: 320,
      estimatedHeight: 480,
      maxLimitHeight: 520,
      margin: 12,
      gap: 8,
      align: 'right',
    });
    setLayoutCoords(coords);
  }, []);

  useLayoutEffect(() => {
    if (isOpen) {
      updateLayoutCoords();
    }
  }, [isOpen, updateLayoutCoords]);

  // Keep popover coordinates aligned on resize or scroll
  useEffect(() => {
    if (!isOpen) return;

    const handleUpdate = () => {
      updateLayoutCoords();
    };

    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [isOpen, updateLayoutCoords]);

  // Close menu on outside click or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e) => {
      const isInsideTrigger = menuRef.current && menuRef.current.contains(e.target);
      const isInsidePopover = popoverRef.current && popoverRef.current.contains(e.target);
      if (!isInsideTrigger && !isInsidePopover) {
        setIsOpen(false);
        setIsSaving(false);
        setSaveError('');
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setIsSaving(false);
        setSaveError('');
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isSaving && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isSaving]);

  const hiddenCount = (!isThumbnailsVisible ? 1 : 0) + (!isSidebarVisible ? 1 : 0);

  const handleToggleThumbnails = () => {
    if (isThumbnailsVisible && !isSidebarVisible) {
      // Guardrail: Cannot hide both
      return;
    }
    onToggleThumbnailsVisible?.();
  };

  const handleToggleSidebar = () => {
    if (isSidebarVisible && !isThumbnailsVisible) {
      // Guardrail: Cannot hide both
      return;
    }
    onToggleSidebarVisible?.();
  };

  const handleStartSave = () => {
    setIsSaving(true);
    setSaveName('');
    setSaveError('');
  };

  const handleConfirmSave = async (e) => {
    e.preventDefault();
    const clean = saveName.trim();
    if (!clean) {
      setSaveError('Please enter a name');
      return;
    }
    try {
      await onSaveLayout?.(clean);
      setIsSaving(false);
      setSaveName('');
      setSaveError('');
    } catch (err) {
      setSaveError(err?.message || 'Failed to save layout');
    }
  };

  return (
    <div className="fc-workspace-layout-menu-container" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`fc-btn fc-btn-secondary fc-btn-sm fc-layout-menu-trigger${
          isOpen ? ' fc-layout-menu-active' : ''
        }${hiddenCount > 0 ? ' fc-layout-has-hidden' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        title="Workspace Layout and Panel Visibility"
        aria-label="Workspace Layout and Panel Visibility"
      >
        <svg
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
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>

        <span className="fc-layout-trigger-label">
          Layout{activeLayoutName ? `: ${activeLayoutName}` : ''}
          {isModified ? ' *' : ''}
        </span>

        {hiddenCount > 0 ? (
          <span
            className="fc-layout-hidden-badge"
            title={`${hiddenCount} panel hidden`}
          >
            {hiddenCount} hidden
          </span>
        ) : null}

        <svg
          className={`fc-layout-chevron${isOpen ? ' fc-chevron-up' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && typeof document !== 'undefined' && document.body
        ? createPortal(
            <div
              ref={popoverRef}
              className="fc-layout-popover"
              role="dialog"
              aria-label="Workspace Layout Options"
              style={
                layoutCoords
                  ? {
                      left: `${layoutCoords.left}px`,
                      top: layoutCoords.top === 'auto' ? 'auto' : `${layoutCoords.top}px`,
                      bottom: layoutCoords.bottom === 'auto' ? 'auto' : `${layoutCoords.bottom}px`,
                      width: `${layoutCoords.width}px`,
                      maxHeight: `${layoutCoords.maxHeight}px`,
                      visibility: 'visible',
                    }
                  : { visibility: 'hidden' }
              }
            >
              <div className="fc-layout-popover-header">
                <h3 className="fc-layout-popover-title">Workspace Layout</h3>
                <button
                  type="button"
                  className="fc-layout-close-btn"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close layout menu"
                >
                  ×
                </button>
              </div>

          <div className="fc-layout-popover-body">
            {/* Section 1: Panel Visibility */}
            <div className="fc-layout-section">
              <div className="fc-layout-section-title">Panel Visibility</div>
              <div className="fc-layout-visibility-list">
                <label
                  className={`fc-layout-checkbox-label${
                    isThumbnailsVisible && !isSidebarVisible
                      ? ' fc-layout-checkbox-disabled'
                      : ''
                  }`}
                  title={
                    isThumbnailsVisible && !isSidebarVisible
                      ? 'At least one panel must stay visible'
                      : 'Toggle Thumbnails Panel (Alt+1)'
                  }
                >
                  <input
                    type="checkbox"
                    checked={isThumbnailsVisible}
                    disabled={isThumbnailsVisible && !isSidebarVisible}
                    onChange={handleToggleThumbnails}
                  />
                  <span className="fc-layout-checkbox-text">Image Thumbnails</span>
                  <kbd className="fc-layout-kbd">Alt+1</kbd>
                </label>

                <label
                  className={`fc-layout-checkbox-label${
                    isSidebarVisible && !isThumbnailsVisible
                      ? ' fc-layout-checkbox-disabled'
                      : ''
                  }`}
                  title={
                    isSidebarVisible && !isThumbnailsVisible
                      ? 'At least one panel must stay visible'
                      : 'Toggle Review Sidebar (Alt+2)'
                  }
                >
                  <input
                    type="checkbox"
                    checked={isSidebarVisible}
                    disabled={isSidebarVisible && !isThumbnailsVisible}
                    onChange={handleToggleSidebar}
                  />
                  <span className="fc-layout-checkbox-text">Review Sidebar</span>
                  <kbd className="fc-layout-kbd">Alt+2</kbd>
                </label>
              </div>

              {hiddenCount > 0 && onShowAllPanels ? (
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary fc-btn-xs fc-layout-action-btn fc-mt-1"
                  onClick={() => {
                    onShowAllPanels();
                  }}
                >
                  Restore All Panels
                </button>
              ) : null}
            </div>

            {/* Section 2: Dock Arrangement & Sizing */}
            <div className="fc-layout-section">
              <div className="fc-layout-section-title">Arrangement & Sizing</div>
              <div className="fc-layout-btn-group">
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary fc-btn-xs fc-layout-action-btn"
                  onClick={onTogglePanelLayout}
                  title="Swap Left and Right workspace panels"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <span>
                    {panelLayout === 'default'
                      ? 'Swap Sides (Thumbnails ⇄ Sidebar)'
                      : 'Restore Default Sides'}
                  </span>
                </button>

                <button
                  type="button"
                  className="fc-btn fc-btn-secondary fc-btn-xs fc-layout-action-btn"
                  onClick={onResetPanelSizes}
                  title="Reset panel widths to default (250px Thumbnails, 360px Sidebar)"
                >
                  Reset Default Sizes
                </button>
              </div>
            </div>

            {/* Section 3: Presets */}
            <div className="fc-layout-section">
              <div className="fc-layout-section-title">Workspace Presets</div>
              <div className="fc-layout-presets-list" role="list">
                {BUILTIN_PRESETS.map((preset) => {
                  const isActive = activeLayoutId === preset.id && !isModified;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`fc-layout-preset-item${
                        isActive ? ' fc-layout-preset-active' : ''
                      }`}
                      onClick={() => {
                        onApplyLayout?.(preset);
                      }}
                      title={preset.description}
                    >
                      <div className="fc-layout-preset-info">
                        <span className="fc-layout-preset-name">
                          {preset.name}
                        </span>
                        {preset.description ? (
                          <span className="fc-layout-preset-desc">
                            {preset.description}
                          </span>
                        ) : null}
                      </div>
                      {isActive ? (
                        <span className="fc-layout-preset-check" aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Section 4: Custom Saved Layouts */}
            <div className="fc-layout-section">
              <div className="fc-layout-section-title">My Saved Layouts</div>
              {savedLayouts && savedLayouts.length > 0 ? (
                <div className="fc-layout-custom-list">
                  {savedLayouts.map((custom) => {
                    const isActive = activeLayoutId === custom.id && !isModified;
                    return (
                      <div
                        key={custom.id}
                        className={`fc-layout-custom-item${
                          isActive ? ' fc-layout-preset-active' : ''
                        }`}
                      >
                        <button
                          type="button"
                          className="fc-layout-custom-apply-btn"
                          onClick={() => onApplyLayout?.(custom)}
                          title={`Apply layout: ${custom.name}`}
                        >
                          <span className="fc-layout-custom-name">
                            {custom.name}
                          </span>
                          {isActive ? (
                            <span className="fc-layout-preset-check">✓</span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="fc-layout-delete-btn"
                          onClick={() => onDeleteLayout?.(custom.id)}
                          title={`Delete ${custom.name}`}
                          aria-label={`Delete ${custom.name}`}
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="fc-layout-empty-text">
                  No custom layouts saved yet.
                </div>
              )}

              {/* Save Form */}
              {!isSaving ? (
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary fc-btn-xs fc-layout-save-trigger fc-mt-2"
                  onClick={handleStartSave}
                >
                  + Save Current Layout…
                </button>
              ) : (
                <form
                  onSubmit={handleConfirmSave}
                  className="fc-layout-save-form fc-mt-2"
                >
                  <input
                    ref={inputRef}
                    type="text"
                    className="fc-layout-save-input"
                    placeholder="Layout name (e.g., Ultrawide Review)"
                    value={saveName}
                    maxLength={40}
                    onChange={(e) => {
                      setSaveName(e.target.value);
                      if (saveError) setSaveError('');
                    }}
                  />
                  {saveError ? (
                    <div className="fc-layout-save-error">{saveError}</div>
                  ) : null}
                  <div className="fc-layout-save-actions">
                    <button
                      type="submit"
                      className="fc-btn fc-btn-primary fc-btn-xs"
                      disabled={!saveName.trim()}
                    >
                      Save Layout
                    </button>
                    <button
                      type="button"
                      className="fc-btn fc-btn-secondary fc-btn-xs"
                      onClick={() => {
                        setIsSaving(false);
                        setSaveName('');
                        setSaveError('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

            {onOpenPreferences ? (
              <div className="fc-layout-section fc-layout-pref-section">
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary fc-btn-xs fc-layout-action-btn"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenPreferences();
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Reviewer Preferences…</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>,
        document.body
      )
    : null}
    </div>
  );
}
