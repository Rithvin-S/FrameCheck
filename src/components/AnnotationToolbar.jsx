import { ANNOTATION_COLORS } from '../services/annotationState.js';
import './AnnotationToolbar.css';

/**
 * Compact annotation toolbar for drawing, selecting, coloring, undoing, redoing,
 * and deleting circle annotations on the active image.
 */
export function AnnotationToolbar({
  toolMode,
  onToolModeChange,
  activeDrawColor,
  onColorSelect,
  selectedAnnotation,
  canEditSelected = false,
  hasDraft = false,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDeleteSelected,
  isSyncing = false,
  readOnly = false,
  disabled = false,
}) {
  if (readOnly) {
    return (
      <div
        className="fc-ann-toolbar fc-ann-toolbar-readonly"
        role="status"
        aria-label="Read-only review mode"
      >
        <span className="fc-ann-readonly-pill">Read-only mode</span>
        <span className="fc-ann-hint">
          Uploaders can monitor annotations and review status. Reviewers and Admins
          manage circles, comments, and completion.
        </span>
      </div>
    );
  }

  const effectiveColor = selectedAnnotation
    ? selectedAnnotation.color
    : activeDrawColor;
  const isSelectedResolved = selectedAnnotation?.status === 'resolved';
  const colorLocked =
    disabled ||
    isSyncing ||
    Boolean(selectedAnnotation && (!canEditSelected || isSelectedResolved));
  const deleteLocked =
    disabled || isSyncing || !selectedAnnotation || !canEditSelected;

  return (
    <div className="fc-ann-toolbar" role="toolbar" aria-label="Circle annotation tools">
      <div className="fc-ann-tool-group" role="group" aria-label="Annotation mode">
        <button
          type="button"
          className={`fc-ann-mode-btn${
            toolMode === 'select' ? ' fc-ann-mode-btn-active' : ''
          }`}
          onClick={() => onToolModeChange('select')}
          disabled={disabled}
          aria-pressed={toolMode === 'select'}
        >
          Select / Move
        </button>
        <button
          type="button"
          className={`fc-ann-mode-btn${
            toolMode === 'draw' ? ' fc-ann-mode-btn-active' : ''
          }`}
          onClick={() => onToolModeChange('draw')}
          disabled={disabled}
          aria-pressed={toolMode === 'draw'}
        >
          Draw Circle
        </button>
      </div>

      <span className="fc-ann-sep" aria-hidden="true" />

      <div className="fc-ann-color-group" role="group" aria-label="Annotation color">
        <span className="fc-ann-label">Color</span>
        <div className="fc-ann-swatches">
          {ANNOTATION_COLORS.map((swatch) => {
            const isActive = effectiveColor === swatch.value;
            let title = `Set draw color to ${swatch.name}`;
            if (selectedAnnotation) {
              if (!canEditSelected) {
                title = 'Only the creator can change this annotation color';
              } else if (isSelectedResolved) {
                title = 'Reopen this annotation to edit its circle';
              } else {
                title = `Change #${selectedAnnotation.displayNumber} to ${swatch.name}`;
              }
            }
            return (
              <button
                key={swatch.value}
                type="button"
                className={`fc-swatch-btn${isActive ? ' fc-swatch-btn-active' : ''}`}
                style={{ '--fc-swatch-color': swatch.value }}
                onClick={() => onColorSelect(swatch.value)}
                disabled={colorLocked}
                title={title}
                aria-label={`${swatch.name}${isActive ? ' (selected)' : ''}`}
                aria-pressed={isActive}
              />
            );
          })}
        </div>
      </div>

      <span className="fc-ann-sep" aria-hidden="true" />

      <div className="fc-ann-actions">
        <button
          type="button"
          className="fc-btn fc-btn-secondary fc-btn-sm"
          onClick={onUndo}
          disabled={disabled || isSyncing || !canUndo}
        >
          Undo
        </button>
        <button
          type="button"
          className="fc-btn fc-btn-secondary fc-btn-sm"
          onClick={onRedo}
          disabled={disabled || isSyncing || !canRedo}
        >
          Redo
        </button>
        <button
          type="button"
          className="fc-btn fc-btn-danger-outline fc-btn-sm"
          onClick={onDeleteSelected}
          disabled={deleteLocked}
          title={
            selectedAnnotation && !canEditSelected
              ? 'Only the creator can delete this annotation'
              : undefined
          }
        >
          {selectedAnnotation
            ? `Delete #${selectedAnnotation.displayNumber}`
            : 'Delete'}
        </button>
      </div>

      <div className="fc-ann-status">
        {isSyncing ? (
          <span className="fc-ann-syncing" aria-live="polite">
            Saving…
          </span>
        ) : hasDraft ? (
          <span className="fc-ann-hint">
            Add a comment in the sidebar to save draft circle
          </span>
        ) : selectedAnnotation ? (
          <span
            className="fc-ann-selected-pill"
            style={{ '--fc-selected-color': selectedAnnotation.color }}
          >
            <span className="fc-ann-selected-dot" aria-hidden="true" />
            <span>Selected: #{selectedAnnotation.displayNumber}</span>
            {!canEditSelected ? (
              <span className="fc-ann-readonly-tag">Read-only</span>
            ) : isSelectedResolved ? (
              <span className="fc-ann-readonly-tag">Resolved</span>
            ) : null}
          </span>
        ) : (
          <span className="fc-ann-hint">
            {toolMode === 'draw'
              ? 'Drag on image to draw a circle'
              : 'Click a circle to inspect or move'}
          </span>
        )}
      </div>
    </div>
  );
}

