import { useEffect, useState } from 'react';
import {
  PROPERTY_TYPES,
  validateCustomPropertiesList,
} from '../services/annotationState.js';
import './AnnotationPropertiesModal.css';

export function AnnotationPropertiesModal({
  isOpen,
  annotation,
  canEdit = false,
  onClose,
  onSave,
}) {
  const [properties, setProperties] = useState([]);
  const [validationError, setValidationError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && annotation) {
      const initial = Array.isArray(annotation.customProperties)
        ? annotation.customProperties.map((p) => ({
            id: p.id || `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: p.name || '',
            type: p.type || PROPERTY_TYPES.TEXT,
            value: p.value ?? '',
            options: Array.isArray(p.options) ? [...p.options] : [],
          }))
        : [];
      setProperties(initial);
      setValidationError('');
      setIsSaving(false);
    }
  }, [isOpen, annotation]);

  if (!isOpen || !annotation) return null;

  const handleAddProperty = () => {
    setProperties((prev) => [
      ...prev,
      {
        id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: '',
        type: PROPERTY_TYPES.TEXT,
        value: '',
        options: [],
      },
    ]);
    setValidationError('');
  };

  const handleRemoveProperty = (id) => {
    setProperties((prev) => prev.filter((p) => p.id !== id));
    setValidationError('');
  };

  const handleUpdateField = (id, field, val) => {
    setProperties((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (field === 'type') {
          // Reset default value when type switches
          let defaultValue = '';
          if (val === PROPERTY_TYPES.BOOLEAN) defaultValue = false;
          if (val === PROPERTY_TYPES.NUMBER) defaultValue = '';
          if (val === PROPERTY_TYPES.DATE) defaultValue = new Date().toISOString().slice(0, 10);
          if (val === PROPERTY_TYPES.SELECT) defaultValue = p.options[0] || '';
          return { ...p, type: val, value: defaultValue };
        }
        return { ...p, [field]: val };
      })
    );
    setValidationError('');
  };

  const handleAddOption = (propId, optionText) => {
    const trimmed = String(optionText || '').trim();
    if (!trimmed) return;
    setProperties((prev) =>
      prev.map((p) => {
        if (p.id !== propId) return p;
        const nextOptions = [...(p.options || []), trimmed];
        return {
          ...p,
          options: nextOptions,
          value: p.value || trimmed,
        };
      })
    );
  };

  const handleRemoveOption = (propId, optIndex) => {
    setProperties((prev) =>
      prev.map((p) => {
        if (p.id !== propId) return p;
        const nextOptions = p.options.filter((_, idx) => idx !== optIndex);
        return {
          ...p,
          options: nextOptions,
          value: p.value === p.options[optIndex] ? nextOptions[0] || '' : p.value,
        };
      })
    );
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (isSaving || !canEdit) return;

    try {
      const validated = validateCustomPropertiesList(properties);
      setIsSaving(true);
      await onSave(annotation.id, validated);
      setIsSaving(false);
      onClose();
    } catch (err) {
      setIsSaving(false);
      setValidationError(err.message || 'Failed to validate custom properties.');
    }
  };

  return (
    <div
      className="fc-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fc-props-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <div className="fc-props-modal">
        <div className="fc-props-modal-header">
          <div>
            <h3 id="fc-props-title" className="fc-props-title">
              Annotation #{annotation.displayNumber} Custom Properties
            </h3>
            <p className="fc-props-subtitle">
              Associate structured metadata, attributes, and tags with this annotation.
            </p>
          </div>
          <button
            type="button"
            className="fc-modal-close-btn"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSave} className="fc-props-form">
          <div className="fc-props-list-container">
            {properties.length === 0 ? (
              <div className="fc-props-empty-state">
                <span className="fc-props-empty-icon">📋</span>
                <h4>No custom properties</h4>
                <p>Add structured metadata fields such as priority, component, severity, or due date.</p>
                {canEdit ? (
                  <button
                    type="button"
                    className="fc-btn fc-btn-primary fc-btn-sm"
                    onClick={handleAddProperty}
                  >
                    + Add Property
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="fc-props-table-wrapper">
                <table className="fc-props-table">
                  <thead>
                    <tr>
                      <th style={{ width: '28%' }}>Property Name</th>
                      <th style={{ width: '22%' }}>Type</th>
                      <th style={{ width: '42%' }}>Value</th>
                      {canEdit ? <th style={{ width: '8%', textAlign: 'center' }}></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {properties.map((prop) => (
                      <tr key={prop.id} className="fc-props-row">
                        <td>
                          {canEdit ? (
                            <input
                              type="text"
                              className="fc-input fc-props-input"
                              placeholder="e.g. Priority, Browser"
                              value={prop.name}
                              disabled={isSaving}
                              onChange={(e) =>
                                handleUpdateField(prop.id, 'name', e.target.value)
                              }
                            />
                          ) : (
                            <span className="fc-props-val-static">{prop.name}</span>
                          )}
                        </td>
                        <td>
                          {canEdit ? (
                            <select
                              className="fc-select fc-props-select"
                              value={prop.type}
                              disabled={isSaving}
                              onChange={(e) =>
                                handleUpdateField(prop.id, 'type', e.target.value)
                              }
                            >
                              <option value={PROPERTY_TYPES.TEXT}>Text</option>
                              <option value={PROPERTY_TYPES.NUMBER}>Number</option>
                              <option value={PROPERTY_TYPES.BOOLEAN}>Boolean</option>
                              <option value={PROPERTY_TYPES.DATE}>Date</option>
                              <option value={PROPERTY_TYPES.SELECT}>Dropdown</option>
                            </select>
                          ) : (
                            <span className="fc-props-type-badge">{prop.type}</span>
                          )}
                        </td>
                        <td>
                          {/* Value editor depends on type */}
                          {prop.type === PROPERTY_TYPES.BOOLEAN ? (
                            <label className="fc-props-bool-label">
                              <input
                                type="checkbox"
                                checked={Boolean(prop.value)}
                                disabled={!canEdit || isSaving}
                                onChange={(e) =>
                                  handleUpdateField(prop.id, 'value', e.target.checked)
                                }
                              />
                              <span>{prop.value ? 'Yes / True' : 'No / False'}</span>
                            </label>
                          ) : prop.type === PROPERTY_TYPES.NUMBER ? (
                            <input
                              type="number"
                              className="fc-input fc-props-input"
                              placeholder="Numeric value"
                              value={prop.value}
                              disabled={!canEdit || isSaving}
                              onChange={(e) =>
                                handleUpdateField(prop.id, 'value', e.target.value)
                              }
                            />
                          ) : prop.type === PROPERTY_TYPES.DATE ? (
                            <input
                              type="date"
                              className="fc-input fc-props-input"
                              value={prop.value}
                              disabled={!canEdit || isSaving}
                              onChange={(e) =>
                                handleUpdateField(prop.id, 'value', e.target.value)
                              }
                            />
                          ) : prop.type === PROPERTY_TYPES.SELECT ? (
                            <div className="fc-props-select-editor">
                              {canEdit ? (
                                <>
                                  <select
                                    className="fc-select fc-props-select"
                                    value={prop.value}
                                    disabled={isSaving || prop.options.length === 0}
                                    onChange={(e) =>
                                      handleUpdateField(prop.id, 'value', e.target.value)
                                    }
                                  >
                                    {prop.options.length === 0 ? (
                                      <option value="">(No options defined)</option>
                                    ) : (
                                      prop.options.map((opt, i) => (
                                        <option key={i} value={opt}>
                                          {opt}
                                        </option>
                                      ))
                                    )}
                                  </select>
                                  <div className="fc-props-options-chips">
                                    {prop.options.map((opt, optIdx) => (
                                      <span key={optIdx} className="fc-props-opt-chip">
                                        {opt}
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveOption(prop.id, optIdx)}
                                          aria-label={`Remove option ${opt}`}
                                        >
                                          ×
                                        </button>
                                      </span>
                                    ))}
                                    <input
                                      type="text"
                                      className="fc-input fc-props-add-opt-input"
                                      placeholder="+ option"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          handleAddOption(prop.id, e.target.value);
                                          e.target.value = '';
                                        }
                                      }}
                                    />
                                  </div>
                                </>
                              ) : (
                                <span className="fc-props-val-static">{prop.value || '—'}</span>
                              )}
                            </div>
                          ) : (
                            <input
                              type="text"
                              className="fc-input fc-props-input"
                              placeholder="Value"
                              value={prop.value}
                              disabled={!canEdit || isSaving}
                              onChange={(e) =>
                                handleUpdateField(prop.id, 'value', e.target.value)
                              }
                            />
                          )}
                        </td>
                        {canEdit ? (
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="fc-props-del-btn"
                              onClick={() => handleRemoveProperty(prop.id)}
                              disabled={isSaving}
                              title="Delete property"
                            >
                              ✕
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {canEdit && properties.length > 0 ? (
            <div className="fc-props-add-row">
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm"
                onClick={handleAddProperty}
                disabled={isSaving}
              >
                + Add Another Property
              </button>
            </div>
          ) : null}

          {validationError ? (
            <div className="fc-props-error" role="alert">
              ⚠️ {validationError}
            </div>
          ) : null}

          <div className="fc-props-modal-footer">
            <button
              type="button"
              className="fc-btn fc-btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              {canEdit ? 'Cancel' : 'Close'}
            </button>
            {canEdit ? (
              <button
                type="submit"
                className="fc-btn fc-btn-primary"
                disabled={isSaving}
              >
                {isSaving ? 'Saving…' : 'Save Properties'}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

