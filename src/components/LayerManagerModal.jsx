import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { calculatePopoverCoords } from './popoverPositioning.js';
import './LayerManagerModal.css';

const PRESET_LAYER_COLORS = [
  '#6366f1', // Indigo
  '#ef4444', // Red
  '#f97316', // Orange
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#8b5cf6', // Violet
  '#ec4899', // Pink
];

export function LayerManagerModal({
  isOpen,
  onClose,
  anchorEl = null,
  layers = [],
  annotationCountsByLayer = {},
  hiddenLayerIds = new Set(),
  lockedLayerIds = new Set(),
  onToggleLayerVisibility,
  onToggleAllLayers,
  onToggleLayerLock,
  onToggleAllLayersLock,
  onCreateLayer,
  onUpdateLayer,
  onDeleteLayer,
  canManage = false,
}) {
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerColor, setNewLayerColor] = useState('#6366f1');
  const [editingLayerId, setEditingLayerId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const popoverRef = useRef(null);
  const [coords, setCoords] = useState(null);

  // Viewport-aware positioning: calculates coordinates anchored to the Manage Layers trigger button
  const updateCoords = useCallback(() => {
    const trigger =
      anchorEl ||
      (typeof document !== 'undefined'
        ? (document.querySelector('.fc-layer-manager-trigger-btn') ||
           document.querySelector('.fc-layer-pop-manage-btn'))
        : null);

    if (!trigger) {
      setCoords({
        left: Math.round(Math.max(12, (window.innerWidth - 380) / 2)),
        top: Math.round(Math.max(12, (window.innerHeight - 440) / 2)),
        bottom: 'auto',
        maxHeight: Math.min(520, window.innerHeight - 24),
        width: Math.min(380, window.innerWidth - 24),
        openUpward: false,
      });
      return;
    }

    const nextCoords = calculatePopoverCoords(trigger, {
      preferredWidth: 380,
      estimatedHeight: 420,
      maxLimitHeight: 520,
      margin: 12,
      gap: 8,
      align: 'auto',
      preferBelow: true,
    });
    setCoords(nextCoords);
  }, [anchorEl]);

  useLayoutEffect(() => {
    if (isOpen) {
      updateCoords();
    }
  }, [isOpen, updateCoords]);

  // Keep popover coordinates synchronized on resize and scroll
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

  // Close popover on outside click or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e) => {
      const trigger =
        anchorEl ||
        (typeof document !== 'undefined'
          ? (document.querySelector('.fc-layer-manager-trigger-btn') ||
             document.querySelector('.fc-layer-pop-manage-btn'))
          : null);
      const isInsideTrigger = trigger && trigger.contains(e.target);
      const isInsidePopover =
        popoverRef.current && popoverRef.current.contains(e.target);

      if (!isInsideTrigger && !isInsidePopover) {
        onClose?.();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, anchorEl, onClose]);

  if (!isOpen) return null;

  const allVisible = layers.length > 0 && layers.every((l) => !hiddenLayerIds.has(l.id));
  const allLocked = layers.length > 0 && layers.every((l) => lockedLayerIds.has(l.id));

  const handleCreate = async (e) => {
    e?.preventDefault();
    const trimmed = newLayerName.trim();
    if (!trimmed) {
      setErrorMessage('Please enter a layer name.');
      return;
    }
    if (layers.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
      setErrorMessage(`A layer named "${trimmed}" already exists.`);
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');
      await onCreateLayer({ name: trimmed, color: newLayerColor });
      setNewLayerName('');
      setNewLayerColor('#6366f1');
      setIsSubmitting(false);
    } catch (err) {
      setIsSubmitting(false);
      setErrorMessage(err.message || 'Failed to create layer.');
    }
  };

  const handleStartEdit = (layer) => {
    if (layer.id === 'default') return;
    setEditingLayerId(layer.id);
    setEditName(layer.name);
    setEditColor(layer.color || '#6366f1');
    setErrorMessage('');
  };

  const handleSaveEdit = async (layerId) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      setErrorMessage('Layer name cannot be empty.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');
      await onUpdateLayer(layerId, { name: trimmed, color: editColor });
      setEditingLayerId(null);
      setIsSubmitting(false);
    } catch (err) {
      setIsSubmitting(false);
      setErrorMessage(err.message || 'Failed to update layer.');
    }
  };

  const handleDelete = async (layerId) => {
    if (layerId === 'default') return;
    const count = annotationCountsByLayer[layerId] || 0;
    const confirmMsg =
      count > 0
        ? `This layer contains ${count} annotation${
            count === 1 ? '' : 's'
          }. Deleting the layer will keep the annotations on the default layer. Continue?`
        : 'Are you sure you want to delete this layer?';

    if (!window.confirm(confirmMsg)) return;

    try {
      setIsSubmitting(true);
      setErrorMessage('');
      await onDeleteLayer(layerId);
      setIsSubmitting(false);
    } catch (err) {
      setIsSubmitting(false);
      setErrorMessage(err.message || 'Failed to delete layer.');
    }
  };

  return createPortal(
    <div
      ref={popoverRef}
      className="fc-layer-popover"
      role="dialog"
      aria-modal="false"
      aria-labelledby="fc-layer-mgr-title"
      style={
        coords
          ? {
              left: `${coords.left}px`,
              top: coords.top === 'auto' ? 'auto' : `${coords.top}px`,
              bottom: coords.bottom === 'auto' ? 'auto' : `${coords.bottom}px`,
              width: `${coords.width}px`,
              maxHeight: `${coords.maxHeight}px`,
            }
          : { visibility: 'hidden' }
      }
    >
      <div className="fc-layer-modal-header">
        <div>
          <h3 id="fc-layer-mgr-title" className="fc-layer-modal-title">
            Manage Layers
          </h3>
          <p className="fc-layer-modal-subtitle">
            Organize annotations into layers and manage visibility.
          </p>
        </div>
        <button
          type="button"
          className="fc-modal-close-btn"
          onClick={onClose}
          disabled={isSubmitting}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

        <div className="fc-layer-modal-body">
          {/* Global visibility and lock bar */}
          <div className="fc-layer-visibility-bar">
            <div className="fc-layer-bar-group">
              <span className="fc-layer-vis-label">Visibility:</span>
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-xs"
                onClick={() => onToggleAllLayers(allVisible ? false : true)}
              >
                {allVisible ? 'Hide All' : 'Show All'}
              </button>
            </div>
            <div className="fc-layer-bar-group">
              <span className="fc-layer-vis-label">Locking:</span>
              <button
                type="button"
                className={`fc-btn fc-btn-xs ${allLocked ? 'fc-btn-warning' : 'fc-btn-secondary'}`}
                onClick={() => onToggleAllLayersLock?.(!allLocked)}
                title={allLocked ? 'Unlock all layers' : 'Lock all layers to prevent modifications'}
              >
                {allLocked ? '🔓 Unlock All' : '🔒 Lock All'}
              </button>
            </div>
          </div>

          {/* Layer List */}
          <div className="fc-layer-list">
            {layers.map((layer) => {
              const count = annotationCountsByLayer[layer.id] || 0;
              const isHidden = hiddenLayerIds.has(layer.id);
              const isLocked = lockedLayerIds.has(layer.id);
              const isDefault = layer.id === 'default';
              const isEditing = editingLayerId === layer.id;

              return (
                <div
                  key={layer.id}
                  className={`fc-layer-row${isHidden ? ' fc-layer-row-hidden' : ''}${
                    isLocked ? ' fc-layer-row-locked' : ''
                  }`}
                >
                  {/* Visibility Eye Button */}
                  <button
                    type="button"
                    className={`fc-layer-eye-btn${isHidden ? ' fc-layer-eye-hidden' : ''}`}
                    onClick={() => onToggleLayerVisibility(layer.id)}
                    title={isHidden ? 'Show layer on canvas' : 'Hide layer from canvas'}
                    aria-label={isHidden ? 'Show layer' : 'Hide layer'}
                  >
                    {isHidden ? (
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                        <path d="M2 2l12 12M6.7 6.7a2 2 0 0 0 2.6 2.6M2.5 8c1.5-3 4-5 5.5-5 1 0 2.2.8 3.3 2m2.2 3c-1.5 3-4 5-5.5 5-1.5 0-3-.9-4.2-2.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                        <path d="M1 8s3-5.5 7-5.5 7 5.5 7 5.5-3 5.5-7 5.5-7-5.5-7-5.5z" />
                        <circle cx="8" cy="8" r="2.2" />
                      </svg>
                    )}
                  </button>

                  {/* Lock Button */}
                  <button
                    type="button"
                    className={`fc-layer-lock-btn${isLocked ? ' fc-layer-lock-active' : ''}`}
                    onClick={() => onToggleLayerLock?.(layer.id)}
                    title={
                      isLocked
                        ? 'Layer is locked (editing and deletion prevented). Click to unlock.'
                        : 'Lock layer to prevent editing and deletion.'
                    }
                    aria-label={isLocked ? 'Unlock layer' : 'Lock layer'}
                  >
                    {isLocked ? (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.5 6V4a3.5 3.5 0 1 1 7 0v2h.5A1.5 1.5 0 0 1 13.5 7.5v6a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 13.5v-6A1.5 1.5 0 0 1 4 6h.5zm1.5 0h4V4a2 2 0 1 0-4 0v2z" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                        <path d="M5 6V4.5a3 3 0 0 1 5.8-1.1M3 6.5A1.5 1.5 0 0 1 4.5 5h7A1.5 1.5 0 0 1 13 6.5v6a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12.5v-6z" strokeLinecap="round" />
                        <circle cx="8" cy="9.5" r="1" fill="currentColor" />
                      </svg>
                    )}
                  </button>

                  {/* Layer Color swatch */}
                  <span
                    className="fc-layer-color-dot"
                    style={{ backgroundColor: layer.color || '#6366f1' }}
                  />

                  {/* Name or Edit Input */}
                  {isEditing ? (
                    <div className="fc-layer-edit-fields">
                      <input
                        type="text"
                        className="fc-input fc-layer-edit-name-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                      />
                      <input
                        type="color"
                        className="fc-layer-color-picker"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        title="Choose layer color"
                      />
                      <button
                        type="button"
                        className="fc-btn fc-btn-primary fc-btn-xs"
                        onClick={() => handleSaveEdit(layer.id)}
                        disabled={isSubmitting}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="fc-btn fc-btn-secondary fc-btn-xs"
                        onClick={() => setEditingLayerId(null)}
                        disabled={isSubmitting}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="fc-layer-info">
                      <span className="fc-layer-name">
                        {layer.name}
                        {isDefault ? <span className="fc-layer-default-tag">Default</span> : null}
                        {isLocked ? <span className="fc-layer-locked-tag">🔒 Locked</span> : null}
                      </span>
                      <span className="fc-layer-count">
                        {count} annotation{count === 1 ? '' : 's'}
                      </span>
                    </div>
                  )}

                  {/* Actions (if canManage and not default) */}
                  {canManage && !isDefault && !isEditing ? (
                    <div className="fc-layer-row-actions">
                      <button
                        type="button"
                        className="fc-btn fc-btn-secondary fc-btn-xs"
                        onClick={() => handleStartEdit(layer)}
                        disabled={isSubmitting}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="fc-btn fc-btn-danger-outline fc-btn-xs"
                        onClick={() => handleDelete(layer.id)}
                        disabled={isSubmitting}
                        title="Delete layer"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Create new layer section */}
          {canManage ? (
            <form onSubmit={handleCreate} className="fc-layer-create-box">
              <h4 className="fc-layer-create-title">+ Create New Layer</h4>
              <div className="fc-layer-create-row">
                <input
                  type="text"
                  className="fc-input fc-layer-create-input"
                  placeholder="Layer name (e.g. Design Tweaks, Copy Feedback)"
                  value={newLayerName}
                  onChange={(e) => setNewLayerName(e.target.value)}
                  disabled={isSubmitting}
                />
                <div className="fc-layer-create-colors">
                  {PRESET_LAYER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`fc-layer-color-btn${newLayerColor === c ? ' fc-layer-color-active' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setNewLayerColor(c)}
                    />
                  ))}
                  <input
                    type="color"
                    className="fc-layer-color-picker"
                    value={newLayerColor}
                    onChange={(e) => setNewLayerColor(e.target.value)}
                    title="Custom color"
                  />
                </div>
                <button
                  type="submit"
                  className="fc-btn fc-btn-primary fc-btn-sm"
                  disabled={isSubmitting || !newLayerName.trim()}
                >
                  {isSubmitting ? 'Adding…' : 'Add Layer'}
                </button>
              </div>
            </form>
          ) : null}

          {errorMessage ? (
            <div className="fc-layer-error" role="alert">
              ⚠️ {errorMessage}
            </div>
          ) : null}
        </div>

        <div className="fc-layer-modal-footer">
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>,
      document.body
    );
  }

