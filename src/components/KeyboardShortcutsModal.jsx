import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_CATEGORIES,
  keyboardEventToShortcut,
  normalizeShortcut,
  findShortcutConflict,
} from '../services/keyboardShortcutsService.js';
import { calculatePopoverCoords } from './popoverPositioning.js';
import './ReviewerPreferencesModal.css';
import './KeyboardShortcutsModal.css';

export function KeyboardShortcutsModal({
  isOpen,
  onClose,
  shortcuts = {},
  onSaveShortcuts,
  onResetDefaults,
  anchorEl = null,
}) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingActionId, setEditingActionId] = useState(null);
  const [recordedCombo, setRecordedCombo] = useState('');
  const [conflictWarning, setConflictWarning] = useState(null);
  const [pendingShortcuts, setPendingShortcuts] = useState({ ...shortcuts });
  const [isDirty, setIsDirty] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState('');

  const popoverRef = useRef(null);
  const [popoverCoords, setPopoverCoords] = useState(null);

  // Sync incoming shortcuts when opened
  useEffect(() => {
    if (isOpen) {
      setPendingShortcuts({ ...shortcuts });
      setEditingActionId(null);
      setRecordedCombo('');
      setConflictWarning(null);
      setIsDirty(false);
      setSaveSuccessNotice('');
    }
  }, [isOpen, shortcuts]);

  // Calculate coordinates anchored near toolbar button matching Preferences design
  const updateCoords = useCallback(() => {
    const trigger =
      anchorEl ||
      document.querySelector('.fc-ann-shortcuts-btn') ||
      document.querySelector('.fc-ann-toolbar');
    if (!trigger) return;
    const coords = calculatePopoverCoords(trigger, {
      preferredWidth: 560,
      estimatedHeight: 480,
      maxLimitHeight: 520,
      margin: 12,
      gap: 8,
      align: 'center',
    });
    setPopoverCoords(coords);
  }, [anchorEl]);

  useLayoutEffect(() => {
    if (isOpen) {
      updateCoords();
    }
  }, [isOpen, updateCoords]);

  // Keep aligned on resize or scroll
  useEffect(() => {
    if (!isOpen) return;

    const handleUpdate = () => {
      updateCoords();
    };

    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [isOpen, updateCoords]);

  // Dismiss on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e) => {
      const trigger = anchorEl || document.querySelector('.fc-ann-shortcuts-btn');
      if (trigger && trigger.contains(e.target)) return;
      if (popoverRef.current && popoverRef.current.contains(e.target)) return;
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen, anchorEl, onClose]);

  // Handle escape to close or cancel recording
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (editingActionId) {
        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'Escape') {
          setEditingActionId(null);
          setRecordedCombo('');
          setConflictWarning(null);
          return;
        }

        const combo = keyboardEventToShortcut(e);
        if (combo) {
          setRecordedCombo(combo);
          const conflict = findShortcutConflict(editingActionId, combo, pendingShortcuts);
          setConflictWarning(conflict);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, editingActionId, pendingShortcuts, onClose]);

  // Filtered shortcut list
  const filteredShortcuts = useMemo(() => {
    const list = Object.entries(DEFAULT_SHORTCUTS).map(([actionId, meta]) => ({
      actionId,
      ...meta,
      currentKey: pendingShortcuts[actionId] || meta.key,
      isModified: (pendingShortcuts[actionId] || meta.key) !== meta.key,
    }));

    return list.filter((item) => {
      const matchesCategory =
        activeCategory === 'all' || item.category === activeCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.currentKey.toLowerCase().includes(q) ||
        item.actionId.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchQuery, pendingShortcuts]);

  const handleStartEditing = (actionId) => {
    setEditingActionId(actionId);
    setRecordedCombo(pendingShortcuts[actionId] || DEFAULT_SHORTCUTS[actionId]?.key || '');
    setConflictWarning(null);
  };

  const handleCancelEdit = () => {
    setEditingActionId(null);
    setRecordedCombo('');
    setConflictWarning(null);
  };

  const handleConfirmEdit = () => {
    if (!editingActionId || !recordedCombo || conflictWarning) return;
    setPendingShortcuts((prev) => ({
      ...prev,
      [editingActionId]: recordedCombo,
    }));
    setIsDirty(true);
    setEditingActionId(null);
    setRecordedCombo('');
    setConflictWarning(null);
  };

  const handleSaveAll = () => {
    onSaveShortcuts?.(pendingShortcuts);
    setIsDirty(false);
    setSaveSuccessNotice('Custom shortcuts saved successfully.');
    setTimeout(() => {
      setSaveSuccessNotice('');
      onClose();
    }, 900);
  };

  const handleResetDefaults = () => {
    if (window.confirm('Reset all keyboard shortcuts to factory defaults?')) {
      const defaults = onResetDefaults?.();
      if (defaults) {
        setPendingShortcuts({ ...defaults });
        setIsDirty(false);
        setEditingActionId(null);
        setConflictWarning(null);
        setSaveSuccessNotice('All shortcuts restored to defaults.');
        setTimeout(() => setSaveSuccessNotice(''), 3000);
      }
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="fc-preferences-modal fc-shortcuts-popover"
      role="dialog"
      aria-label="Keyboard Shortcuts"
      style={
        popoverCoords
          ? {
              position: 'fixed',
              zIndex: 1050,
              left: `${popoverCoords.left}px`,
              top: popoverCoords.top === 'auto' ? 'auto' : `${popoverCoords.top}px`,
              bottom: popoverCoords.bottom === 'auto' ? 'auto' : `${popoverCoords.bottom}px`,
              width: `${popoverCoords.width}px`,
              maxHeight: `${popoverCoords.maxHeight}px`,
            }
          : {
              position: 'fixed',
              zIndex: 1050,
              visibility: 'hidden',
            }
      }
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Preferences-style Header */}
      <div className="fc-preferences-header">
        <div className="fc-preferences-header-left">
          <h2 className="fc-preferences-title">Keyboard Shortcuts</h2>
          <p className="fc-preferences-subtitle">
            View and customize workspace keybindings
          </p>
        </div>
        <button
          type="button"
          className="fc-preferences-close-btn"
          onClick={onClose}
          aria-label="Close shortcuts"
        >
          ×
        </button>
      </div>

      {/* Preferences-style Tabs */}
      <div className="fc-preferences-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeCategory === 'all'}
          className={`fc-preferences-tab${activeCategory === 'all' ? ' fc-preferences-tab-active' : ''}`}
          onClick={() => setActiveCategory('all')}
        >
          All
        </button>
        {SHORTCUT_CATEGORIES.map((cat) => (
          <button
            type="button"
            key={cat.id}
            role="tab"
            aria-selected={activeCategory === cat.id}
            className={`fc-preferences-tab${activeCategory === cat.id ? ' fc-preferences-tab-active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Search Bar Toolbar */}
      <div className="fc-shortcuts-toolbar">
        <div className="fc-shortcuts-search">
          <input
            type="text"
            placeholder="Search shortcuts by name or key..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="fc-shortcuts-search-input"
            aria-label="Search shortcuts"
          />
          {searchQuery ? (
            <button
              type="button"
              className="fc-shortcuts-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      {/* Feedback Notices */}
      {saveSuccessNotice ? (
        <div className="fc-shortcuts-notice fc-shortcuts-notice-success" role="status">
          ✓ {saveSuccessNotice}
        </div>
      ) : null}

      {/* Recording Bar if active */}
      {editingActionId ? (
        <div className="fc-shortcuts-recorder-panel">
          <div className="fc-shortcuts-recorder-info">
            <span className="fc-shortcuts-recorder-title">
              Assigning key for: <strong>{DEFAULT_SHORTCUTS[editingActionId]?.label}</strong>
            </span>
            <span className="fc-shortcuts-recorder-hint">
              Press desired key combination (or Esc to cancel).
            </span>
          </div>
          <div className="fc-shortcuts-recorder-keys">
            <span className="fc-shortcut-kbd fc-shortcut-kbd-recording">
              {recordedCombo || 'Press key…'}
            </span>
          </div>
          {conflictWarning ? (
            <div className="fc-shortcuts-conflict-badge" role="alert">
              ⚠️ {conflictWarning.message}
            </div>
          ) : null}
          <div className="fc-shortcuts-recorder-actions">
            <button
              type="button"
              className="fc-btn fc-btn-primary fc-btn-sm"
              onClick={handleConfirmEdit}
              disabled={!recordedCombo || Boolean(conflictWarning)}
            >
              Accept Key
            </button>
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm"
              onClick={handleCancelEdit}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Shortcuts List */}
      <div className="fc-shortcuts-body">
        {filteredShortcuts.length === 0 ? (
          <div className="fc-shortcuts-empty">No shortcuts match your filter.</div>
        ) : (
          <table className="fc-shortcuts-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Description</th>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Shortcut Key</th>
                <th style={{ width: '70px', textAlign: 'center' }}>Edit</th>
              </tr>
            </thead>
            <tbody>
              {filteredShortcuts.map((item) => {
                const isEditingThis = editingActionId === item.actionId;
                return (
                  <tr
                    key={item.actionId}
                    className={`${item.isModified ? 'is-customized' : ''} ${isEditingThis ? 'is-editing' : ''}`}
                  >
                    <td className="fc-shortcuts-cell-label">
                      <span>{item.label}</span>
                      {item.isModified ? (
                        <span className="fc-shortcuts-modified-dot" title="Customized">
                          ●
                        </span>
                      ) : null}
                    </td>
                    <td className="fc-shortcuts-cell-desc">{item.description}</td>
                    <td className="fc-shortcuts-cell-cat">
                      <span className="fc-shortcuts-category-tag">{item.category}</span>
                    </td>
                    <td className="fc-shortcuts-cell-key">
                      <kbd className="fc-shortcut-kbd">{item.currentKey}</kbd>
                    </td>
                    <td className="fc-shortcuts-cell-actions">
                      <button
                        type="button"
                        className="fc-btn fc-btn-secondary fc-btn-xs"
                        onClick={() => handleStartEditing(item.actionId)}
                        disabled={editingActionId !== null}
                        title={`Remap shortcut for ${item.label}`}
                      >
                        Remap
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Preferences-style Footer */}
      <div className="fc-preferences-footer">
        <div className="fc-shortcuts-footer-left">
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-sm"
            onClick={handleResetDefaults}
            title="Reset all mappings to FrameCheck defaults"
          >
            Restore Defaults
          </button>
          {isDirty ? (
            <span className="fc-shortcuts-unsaved-badge">Unsaved changes</span>
          ) : null}
        </div>
        <div className="fc-shortcuts-footer-right">
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-sm"
            onClick={onClose}
          >
            {isDirty ? 'Cancel' : 'Close'}
          </button>
          <button
            type="button"
            className="fc-btn fc-btn-primary fc-btn-sm"
            onClick={handleSaveAll}
            disabled={!isDirty}
          >
            Save Shortcuts
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
