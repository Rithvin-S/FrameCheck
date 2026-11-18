import React, { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  BUILTIN_TEMPLATES,
  fetchTemplates,
  saveUserTemplate,
  deleteUserTemplate,
  extractTemplateFromAnnotation,
} from '../services/annotationTemplateService.js';
import {
  ANNOTATION_COLORS,
  STROKE_WIDTH_OPTIONS,
  LINE_STYLES,
  ARROW_HEAD_STYLES,
  ANNOTATION_MARKERS,
  ANNOTATION_STAMPS,
} from '../services/annotationState.js';
import { calculatePopoverCoords } from './popoverPositioning.js';
import './ReviewerPreferencesModal.css';
import './AnnotationTemplatesModal.css';

export function AnnotationTemplatesModal({
  isOpen,
  onClose,
  anchorEl = null,
  userId = 'guest',
  selectedAnnotation = null,
  activeDrawStyle = {},
  activeDrawColor = '#dc2626',
  onApplyToAnnotation,
  onApplyToDrawTools,
}) {
  const popoverRef = useRef(null);
  const [popoverCoords, setPopoverCoords] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('browse'); // 'browse' | 'create'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [statusNotice, setStatusNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Form state for creating template
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTool, setFormTool] = useState('circle');
  const [formColor, setFormColor] = useState('#dc2626');
  const [formStrokeWidth, setFormStrokeWidth] = useState(3);
  const [formLineStyle, setFormLineStyle] = useState('solid');
  const [formFillEnabled, setFormFillEnabled] = useState(false);
  const [formFillOpacity, setFormFillOpacity] = useState(0.2);
  const [formArrowHead, setFormArrowHead] = useState('standard');
  const [formMarker, setFormMarker] = useState('');
  const [formStamp, setFormStamp] = useState('');
  const [formLabelsStr, setFormLabelsStr] = useState('');
  const [formPropsStr, setFormPropsStr] = useState('');

  // Calculate coordinates relative to anchor element
  const updatePosition = useCallback(() => {
    if (!isOpen) return;
    const trigger =
      anchorEl ||
      (typeof document !== 'undefined'
        ? document.querySelector('[data-role="templates-button"]') ||
          document.querySelector('button[title*="Templates" i]')
        : null);
    if (!trigger) return;

    const coords = calculatePopoverCoords(trigger, {
      preferredWidth: 620,
      estimatedHeight: 520,
      maxLimitHeight: 560,
      margin: 12,
      gap: 8,
      align: 'center',
    });
    setPopoverCoords(coords);
  }, [isOpen, anchorEl]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverCoords(null);
      return;
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  // Handle outside clicks and Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDownOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        if (anchorEl && (anchorEl === e.target || anchorEl.contains(e.target))) {
          return;
        }
        onClose?.();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, anchorEl]);

  // Load templates on open
  useEffect(() => {
    if (isOpen) {
      loadTemplates();
      setStatusNotice('');
      setErrorMessage('');
      setActiveTab('browse');
    }
  }, [isOpen, userId]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const list = await fetchTemplates(userId);
      setTemplates(list);
      if (list.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(list[0].id);
      }
    } catch (err) {
      console.error('[AnnotationTemplatesModal] Failed loading templates:', err);
    } finally {
      setLoading(false);
    }
  };

  // Pre-fill form from selected annotation or active style
  const handlePreFillFromAnnotation = () => {
    if (selectedAnnotation) {
      const extracted = extractTemplateFromAnnotation(selectedAnnotation);
      setFormName(`Preset: #${selectedAnnotation.displayNumber || selectedAnnotation.annotationNumber}`);
      setFormDescription(extracted.description || '');
      setFormTool(extracted.tool || 'circle');
      setFormColor(extracted.color || '#dc2626');
      setFormStrokeWidth(extracted.style?.strokeWidth || 3);
      setFormLineStyle(extracted.style?.lineStyle || 'solid');
      setFormFillEnabled(Boolean(extracted.style?.fillEnabled));
      setFormFillOpacity(extracted.style?.fillOpacity ?? 0.2);
      setFormArrowHead(extracted.style?.arrowHead || 'standard');
      setFormMarker(extracted.style?.marker || '');
      setFormStamp(extracted.style?.stamp || '');
      setFormLabelsStr((extracted.labels || []).join(', '));
      setFormPropsStr(
        Object.entries(extracted.customProperties || {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      );
      setActiveTab('create');
      setStatusNotice('Loaded properties from selected annotation.');
    } else {
      setFormName('Custom Tool Style');
      setFormColor(activeDrawColor);
      setFormStrokeWidth(activeDrawStyle.strokeWidth || 3);
      setFormLineStyle(activeDrawStyle.lineStyle || 'solid');
      setFormFillEnabled(Boolean(activeDrawStyle.fillEnabled));
      setFormFillOpacity(activeDrawStyle.fillOpacity ?? 0.2);
      setFormArrowHead(activeDrawStyle.arrowHead || 'standard');
      setFormMarker(activeDrawStyle.marker || '');
      setFormStamp(activeDrawStyle.stamp || '');
      setActiveTab('create');
    }
  };

  const handleCreateTemplate = async (e) => {
    e.preventDefault();
    if (!formName.trim()) {
      setErrorMessage('Template name is required.');
      return;
    }

    setErrorMessage('');
    const labels = formLabelsStr
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);

    const customProperties = {};
    if (formPropsStr.trim()) {
      const lines = formPropsStr.split('\n');
      for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const key = line.substring(0, idx).trim();
          const val = line.substring(idx + 1).trim();
          if (key) customProperties[key] = val;
        }
      }
    }

    const payload = {
      name: formName.trim(),
      description: formDescription.trim(),
      tool: formTool,
      color: formColor,
      style: {
        strokeWidth: Number(formStrokeWidth),
        lineStyle: formLineStyle,
        fillEnabled: formFillEnabled,
        fillColor: formColor,
        fillOpacity: Number(formFillOpacity),
        arrowHead: formArrowHead,
        marker: formMarker || null,
        stamp: formStamp || null,
      },
      customProperties,
      labels,
    };

    try {
      const saved = await saveUserTemplate(userId, payload);
      await loadTemplates();
      setSelectedTemplateId(saved.id);
      setActiveTab('browse');
      setStatusNotice(`Template "${saved.name}" saved successfully.`);
      setTimeout(() => setStatusNotice(''), 3500);
    } catch (err) {
      setErrorMessage('Failed to save template: ' + (err.message || 'Unknown error'));
    }
  };

  const handleDeleteTemplate = async (templateId, templateName) => {
    if (window.confirm(`Delete custom template "${templateName}"?`)) {
      try {
        await deleteUserTemplate(userId, templateId);
        await loadTemplates();
        setStatusNotice(`Template "${templateName}" deleted.`);
        setTimeout(() => setStatusNotice(''), 3000);
      } catch (err) {
        setErrorMessage(err.message || 'Failed to delete template.');
      }
    }
  };

  // Filter templates
  const filteredTemplates = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        (t.tool && t.tool.toLowerCase().includes(q)) ||
        (t.labels && t.labels.some((l) => l.toLowerCase().includes(q)))
    );
  }, [templates, searchQuery]);

  const activeTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) || filteredTemplates[0] || null;
  }, [templates, selectedTemplateId, filteredTemplates]);

  const handleApplyToSelection = () => {
    if (!activeTemplate || !selectedAnnotation) return;
    onApplyToAnnotation?.(activeTemplate, selectedAnnotation);
    setStatusNotice(`Template "${activeTemplate.name}" applied to annotation #${selectedAnnotation.displayNumber}.`);
    setTimeout(() => setStatusNotice(''), 3000);
  };

  const handleApplyToTools = () => {
    if (!activeTemplate) return;
    onApplyToDrawTools?.(activeTemplate);
    setStatusNotice(`Template "${activeTemplate.name}" set as active drawing style.`);
    setTimeout(() => setStatusNotice(''), 3000);
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="fc-preferences-modal fc-templates-popover"
      role="dialog"
      aria-label="Annotation Templates"
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
          <h2 className="fc-preferences-title">Annotation Templates</h2>
          <p className="fc-preferences-subtitle">
            Manage, customize, and apply reusable annotation presets
          </p>
        </div>
        <button
          type="button"
          className="fc-preferences-close-btn"
          onClick={onClose}
          aria-label="Close templates dialog"
        >
          ×
        </button>
      </div>

      {/* Preferences-style Tab Navigation */}
      <div className="fc-preferences-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'browse'}
          className={`fc-preferences-tab${activeTab === 'browse' ? ' fc-preferences-tab-active' : ''}`}
          onClick={() => setActiveTab('browse')}
        >
          Browse Templates ({templates.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'create'}
          className={`fc-preferences-tab${activeTab === 'create' ? ' fc-preferences-tab-active' : ''}`}
          onClick={() => setActiveTab('create')}
        >
          + Create Template
        </button>
        {selectedAnnotation ? (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-xs"
              onClick={handlePreFillFromAnnotation}
              title="Save selected annotation's style as a new reusable template"
            >
              Save Selection as Template
            </button>
          </div>
        ) : null}
      </div>

        {/* Notices */}
        {statusNotice ? (
          <div className="fc-templates-notice fc-templates-notice-success" role="status">
            ✓ {statusNotice}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="fc-templates-notice fc-templates-notice-error" role="alert">
            ⚠️ {errorMessage}
          </div>
        ) : null}

        {/* Tab Content */}
        {activeTab === 'browse' ? (
          <div className="fc-templates-browser-layout">
            {/* Left list */}
            <div className="fc-templates-list-pane">
              <div className="fc-templates-search-box">
                <input
                  type="text"
                  placeholder="Filter templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="fc-templates-search-input"
                  aria-label="Filter templates"
                />
              </div>

              <div className="fc-templates-items-scroll">
                {loading ? (
                  <div className="fc-templates-loading">Loading templates…</div>
                ) : filteredTemplates.length === 0 ? (
                  <div className="fc-templates-empty">No templates found.</div>
                ) : (
                  filteredTemplates.map((t) => {
                    const isSelected = activeTemplate?.id === t.id;
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        className={`fc-template-card ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => setSelectedTemplateId(t.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedTemplateId(t.id);
                          }
                        }}
                      >
                        <div className="fc-template-card-header">
                          <span
                            className="fc-template-color-dot"
                            style={{ backgroundColor: t.color }}
                            aria-hidden="true"
                          />
                          <span className="fc-template-card-name">{t.name}</span>
                          {t.isBuiltin ? (
                            <span className="fc-template-builtin-tag">Built-in</span>
                          ) : (
                            <span className="fc-template-custom-tag">Custom</span>
                          )}
                        </div>
                        {t.description ? (
                          <p className="fc-template-card-desc">{t.description}</p>
                        ) : null}
                        <div className="fc-template-card-meta">
                          <span className="fc-template-tool-badge">{t.tool}</span>
                          {t.labels && t.labels.length > 0 ? (
                            <span className="fc-template-labels-summary">
                              {t.labels.slice(0, 2).join(', ')}
                              {t.labels.length > 2 ? ` +${t.labels.length - 2}` : ''}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right preview & apply pane */}
            <div className="fc-templates-preview-pane">
              {activeTemplate ? (
                <div className="fc-template-detail">
                  <div className="fc-template-detail-header">
                    <div className="fc-template-detail-title-row">
                      <span
                        className="fc-template-color-badge"
                        style={{ backgroundColor: activeTemplate.color }}
                      />
                      <h3>{activeTemplate.name}</h3>
                    </div>
                    {activeTemplate.description ? (
                      <p className="fc-template-detail-desc">{activeTemplate.description}</p>
                    ) : null}
                  </div>

                  {/* Visual Preview Box */}
                  <div className="fc-template-visual-preview">
                    <div
                      className="fc-template-preview-shape"
                      style={{
                        borderColor: activeTemplate.color,
                        borderWidth: `${Math.min(6, activeTemplate.style?.strokeWidth || 3)}px`,
                        borderStyle: activeTemplate.style?.lineStyle || 'solid',
                        backgroundColor: activeTemplate.style?.fillEnabled
                          ? activeTemplate.style?.fillColor || activeTemplate.color
                          : 'transparent',
                        opacity: activeTemplate.style?.strokeOpacity ?? 1,
                      }}
                    >
                      <span className="fc-template-preview-tool-text">
                        {activeTemplate.tool.toUpperCase()}
                      </span>
                      {activeTemplate.style?.stamp ? (
                        <span className="fc-template-preview-stamp">
                          {activeTemplate.style.stamp.toUpperCase()}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Properties Summary Grid */}
                  <div className="fc-template-props-grid">
                    <div className="fc-template-prop-item">
                      <span className="fc-template-prop-label">Primary Tool:</span>
                      <span className="fc-template-prop-value">{activeTemplate.tool}</span>
                    </div>
                    <div className="fc-template-prop-item">
                      <span className="fc-template-prop-label">Stroke Width:</span>
                      <span className="fc-template-prop-value">{activeTemplate.style?.strokeWidth || 3}px</span>
                    </div>
                    <div className="fc-template-prop-item">
                      <span className="fc-template-prop-label">Line Style:</span>
                      <span className="fc-template-prop-value">{activeTemplate.style?.lineStyle || 'solid'}</span>
                    </div>
                    {activeTemplate.style?.marker ? (
                      <div className="fc-template-prop-item">
                        <span className="fc-template-prop-label">Marker Icon:</span>
                        <span className="fc-template-prop-value">{activeTemplate.style.marker}</span>
                      </div>
                    ) : null}
                    {activeTemplate.style?.stamp ? (
                      <div className="fc-template-prop-item">
                        <span className="fc-template-prop-label">Status Stamp:</span>
                        <span className="fc-template-prop-value">{activeTemplate.style.stamp}</span>
                      </div>
                    ) : null}
                  </div>

                  {/* Labels Section */}
                  {activeTemplate.labels && activeTemplate.labels.length > 0 ? (
                    <div className="fc-template-section">
                      <span className="fc-template-section-label">Applied Labels:</span>
                      <div className="fc-template-labels-list">
                        {activeTemplate.labels.map((l) => (
                          <span key={l} className="fc-template-label-pill">
                            {l}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Custom Properties Section */}
                  {activeTemplate.customProperties && Object.keys(activeTemplate.customProperties).length > 0 ? (
                    <div className="fc-template-section">
                      <span className="fc-template-section-label">Custom Properties:</span>
                      <div className="fc-template-custom-props-list">
                        {Object.entries(activeTemplate.customProperties).map(([k, v]) => (
                          <div key={k} className="fc-template-custom-prop-row">
                            <code>{k}:</code> <span>{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Actions */}
                  <div className="fc-template-actions-row">
                    <button
                      type="button"
                      className="fc-btn fc-btn-primary fc-btn-sm"
                      onClick={handleApplyToSelection}
                      disabled={!selectedAnnotation}
                      title={
                        selectedAnnotation
                          ? `Apply style to selected annotation #${selectedAnnotation.displayNumber} (preserves geometry)`
                          : 'Select an annotation on canvas to apply this template'
                      }
                    >
                      {selectedAnnotation
                        ? `Apply to Selected #${selectedAnnotation.displayNumber}`
                        : 'Apply to Selected (None)'}
                    </button>

                    <button
                      type="button"
                      className="fc-btn fc-btn-secondary fc-btn-sm"
                      onClick={handleApplyToTools}
                      title="Set as default drawing style for subsequent annotations"
                    >
                      Set Active Draw Style
                    </button>

                    {!activeTemplate.isBuiltin ? (
                      <button
                        type="button"
                        className="fc-btn fc-btn-danger-outline fc-btn-sm"
                        onClick={() => handleDeleteTemplate(activeTemplate.id, activeTemplate.name)}
                        title="Delete this custom template"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="fc-templates-empty">Select a template to view details.</div>
              )}
            </div>
          </div>
        ) : (
          /* Create Template Form */
          <form className="fc-templates-form-pane" onSubmit={handleCreateTemplate}>
            <div className="fc-templates-form-grid">
              <div className="fc-templates-form-group">
                <label htmlFor="tpl-name">Template Name *</label>
                <input
                  id="tpl-name"
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Layout Offset Warning"
                  className="fc-templates-input"
                />
              </div>

              <div className="fc-templates-form-group">
                <label htmlFor="tpl-tool">Associated Tool</label>
                <select
                  id="tpl-tool"
                  value={formTool}
                  onChange={(e) => setFormTool(e.target.value)}
                  className="fc-templates-select"
                >
                  <option value="circle">Circle Tool</option>
                  <option value="rectangle">Rectangle Tool</option>
                  <option value="arrow">Arrow Tool</option>
                  <option value="line">Line Tool</option>
                  <option value="polygon">Polygon Tool</option>
                  <option value="cloud">Cloud Tool</option>
                  <option value="pencil">Pencil Tool</option>
                  <option value="callout">Callout Tool</option>
                  <option value="textbox">Text Box Tool</option>
                  <option value="blur">Blur / Redaction</option>
                  <option value="marker">Marker / Stamp</option>
                </select>
              </div>

              <div className="fc-templates-form-group fc-templates-full-width">
                <label htmlFor="tpl-desc">Description</label>
                <input
                  id="tpl-desc"
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Short note on when to use this template"
                  className="fc-templates-input"
                />
              </div>

              <div className="fc-templates-form-group">
                <label>Color</label>
                <div className="fc-templates-color-picker">
                  {ANNOTATION_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className={`fc-templates-color-btn ${formColor === c.value ? 'is-active' : ''}`}
                      style={{ backgroundColor: c.value }}
                      onClick={() => setFormColor(c.value)}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              <div className="fc-templates-form-group">
                <label htmlFor="tpl-stroke">Stroke Width</label>
                <select
                  id="tpl-stroke"
                  value={formStrokeWidth}
                  onChange={(e) => setFormStrokeWidth(Number(e.target.value))}
                  className="fc-templates-select"
                >
                  {STROKE_WIDTH_OPTIONS.map((sw) => (
                    <option key={sw.value} value={sw.value}>
                      {sw.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fc-templates-form-group">
                <label htmlFor="tpl-linestyle">Line Style</label>
                <select
                  id="tpl-linestyle"
                  value={formLineStyle}
                  onChange={(e) => setFormLineStyle(e.target.value)}
                  className="fc-templates-select"
                >
                  {LINE_STYLES.map((ls) => (
                    <option key={ls.value} value={ls.value}>
                      {ls.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fc-templates-form-group">
                <label htmlFor="tpl-marker">Marker Icon</label>
                <select
                  id="tpl-marker"
                  value={formMarker}
                  onChange={(e) => setFormMarker(e.target.value)}
                  className="fc-templates-select"
                >
                  <option value="">None</option>
                  {ANNOTATION_MARKERS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fc-templates-form-group">
                <label htmlFor="tpl-stamp">Status Stamp</label>
                <select
                  id="tpl-stamp"
                  value={formStamp}
                  onChange={(e) => setFormStamp(e.target.value)}
                  className="fc-templates-select"
                >
                  <option value="">None</option>
                  {ANNOTATION_STAMPS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fc-templates-form-group fc-templates-full-width">
                <label htmlFor="tpl-labels">Labels (comma-separated)</label>
                <input
                  id="tpl-labels"
                  type="text"
                  value={formLabelsStr}
                  onChange={(e) => setFormLabelsStr(e.target.value)}
                  placeholder="Bug, P0, Critical, Design"
                  className="fc-templates-input"
                />
              </div>

              <div className="fc-templates-form-group fc-templates-full-width">
                <label htmlFor="tpl-props">Custom Properties (key: value per line)</label>
                <textarea
                  id="tpl-props"
                  rows={2}
                  value={formPropsStr}
                  onChange={(e) => setFormPropsStr(e.target.value)}
                  placeholder="severity: critical&#10;component: navigation"
                  className="fc-templates-textarea"
                />
              </div>
            </div>

            <div className="fc-preferences-footer">
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm"
                onClick={() => setActiveTab('browse')}
              >
                Cancel
              </button>
              <button type="submit" className="fc-btn fc-btn-primary fc-btn-sm">
                Save Reusable Template
              </button>
            </div>
          </form>
        )}
    </div>,
    document.body
  );
}

