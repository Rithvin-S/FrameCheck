import { useEffect, useState } from 'react';
import {
  DEFAULT_REVIEWER_PREFERENCES,
  TOOLBAR_DENSITY_OPTIONS,
  TOOLBAR_POSITION_OPTIONS,
  ZOOM_PREFERENCE_OPTIONS,
  THEME_PREFERENCE_OPTIONS,
} from '../services/reviewerPreferencesService.js';
import { ANNOTATION_COLORS, ANNOTATION_PRIORITIES } from '../services/annotationState.js';
import { useTheme } from '../context/ThemeContext.jsx';
import './ReviewerPreferencesModal.css';

const AVAILABLE_TOOLS = [
  { id: 'circle', label: 'Circle (C)' },
  { id: 'select', label: 'Select / Move (V)' },
  { id: 'arrow', label: 'Arrow (A)' },
  { id: 'line', label: 'Straight Line (L)' },
  { id: 'rectangle', label: 'Rectangle (R)' },
  { id: 'polygon', label: 'Polygon (G)' },
  { id: 'cloud', label: 'Revision Cloud (U)' },
  { id: 'freehand', label: 'Freehand Pen (P)' },
  { id: 'highlighter', label: 'Highlighter (I)' },
  { id: 'callout', label: 'Callout Text (T)' },
  { id: 'textbox', label: 'Text Box (X)' },
  { id: 'blur', label: 'Blur / Redact (B)' },
  { id: 'marker', label: 'Numbered Marker (M)' },
];

const STROKE_WIDTHS = [1, 2, 3, 5, 8];

export function ReviewerPreferencesModal({
  isOpen,
  onClose,
  preferences = DEFAULT_REVIEWER_PREFERENCES,
  onSavePreferences,
  displayName = 'Reviewer',
  onRelaunchOnboarding = null,
}) {
  const { setTheme } = useTheme();
  const [draftPrefs, setDraftPrefs] = useState({ ...DEFAULT_REVIEWER_PREFERENCES });
  const [customHex, setCustomHex] = useState('');
  const [hexError, setHexError] = useState('');
  const [activeTab, setActiveTab] = useState('annotations');

  // Synchronize when opened with current preferences
  useEffect(() => {
    if (isOpen) {
      setDraftPrefs({ ...preferences });
      setCustomHex(preferences.defaultColor || '#dc2626');
      setHexError('');
      setActiveTab('annotations');
    }
  }, [isOpen, preferences]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleColorPick = (colorVal) => {
    setDraftPrefs((prev) => ({ ...prev, defaultColor: colorVal }));
    setCustomHex(colorVal);
    setHexError('');
  };

  const handleHexChange = (e) => {
    const val = e.target.value.trim();
    setCustomHex(val);
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) {
      setDraftPrefs((prev) => ({ ...prev, defaultColor: val }));
      setHexError('');
    } else if (val.length >= 4) {
      setHexError('Must be valid hex (e.g., #ef4444)');
    }
  };

  const handleResetDefaults = () => {
    setDraftPrefs({ ...DEFAULT_REVIEWER_PREFERENCES });
    setCustomHex(DEFAULT_REVIEWER_PREFERENCES.defaultColor);
    setHexError('');
  };

  const handleSave = () => {
    onSavePreferences(draftPrefs);
    onClose();
  };

  return (
    <div
      className="fc-modal-overlay fc-preferences-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fc-pref-modal-title"
    >
      <div className="fc-preferences-modal">
        <div className="fc-preferences-header">
          <div className="fc-preferences-header-left">
            <h2 id="fc-pref-modal-title" className="fc-preferences-title">
              Reviewer Workspace Preferences
            </h2>
            <p className="fc-preferences-subtitle">
              Personalized settings for <strong>{displayName}</strong>. These preferences apply only to your account.
            </p>
          </div>
          <button
            type="button"
            className="fc-preferences-close-btn"
            onClick={onClose}
            aria-label="Close preferences"
          >
            ×
          </button>
        </div>

        {/* Tab navigation */}
        <div className="fc-preferences-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'annotations'}
            className={`fc-preferences-tab${activeTab === 'annotations' ? ' fc-preferences-tab-active' : ''}`}
            onClick={() => setActiveTab('annotations')}
          >
            Annotation Defaults
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'canvas'}
            className={`fc-preferences-tab${activeTab === 'canvas' ? ' fc-preferences-tab-active' : ''}`}
            onClick={() => setActiveTab('canvas')}
          >
            Canvas & Zoom
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'toolbar'}
            className={`fc-preferences-tab${activeTab === 'toolbar' ? ' fc-preferences-tab-active' : ''}`}
            onClick={() => setActiveTab('toolbar')}
          >
            Toolbar & Workspace
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'appearance'}
            className={`fc-preferences-tab${activeTab === 'appearance' ? ' fc-preferences-tab-active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            Theme & Appearance
          </button>
        </div>

        <div className="fc-preferences-body">
          {/* TAB 1: Annotation Defaults */}
          {activeTab === 'annotations' && (
            <div className="fc-preferences-section">
              {/* Default Color */}
              <div className="fc-preference-field">
                <label className="fc-field-label">
                  Default Annotation Color
                  <span className="fc-field-hint">Initial color used when creating new annotations</span>
                </label>
                <div className="fc-color-picker-row">
                  <div className="fc-swatch-list">
                    {ANNOTATION_COLORS.map((c) => {
                      const isSelected = draftPrefs.defaultColor?.toLowerCase() === c.value.toLowerCase();
                      return (
                        <button
                          key={c.value}
                          type="button"
                          className={`fc-pref-swatch${isSelected ? ' fc-pref-swatch-selected' : ''}`}
                          style={{ backgroundColor: c.value }}
                          onClick={() => handleColorPick(c.value)}
                          title={`${c.name} (${c.value})`}
                          aria-label={`${c.name} ${c.value}`}
                        >
                          {isSelected ? <span className="fc-swatch-check">✓</span> : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="fc-custom-hex-wrap">
                    <input
                      type="text"
                      className={`fc-hex-input${hexError ? ' fc-hex-error' : ''}`}
                      placeholder="#dc2626"
                      maxLength={7}
                      value={customHex}
                      onChange={handleHexChange}
                    />
                    <span
                      className="fc-hex-preview"
                      style={{ backgroundColor: draftPrefs.defaultColor }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
                {hexError ? <div className="fc-field-error">{hexError}</div> : null}
              </div>

              {/* Default Tool */}
              <div className="fc-preference-field">
                <label className="fc-field-label">
                  Default Drawing Tool
                  <span className="fc-field-hint">Active drawing tool when opening the Review Workspace</span>
                </label>
                <select
                  className="fc-select-input"
                  value={draftPrefs.defaultTool}
                  onChange={(e) => setDraftPrefs((prev) => ({ ...prev, defaultTool: e.target.value }))}
                >
                  {AVAILABLE_TOOLS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Default Priority */}
              <div className="fc-preference-field">
                <label className="fc-field-label">
                  Default Annotation Priority
                  <span className="fc-field-hint">Priority level assigned to your newly created annotations</span>
                </label>
                <select
                  className="fc-select-input"
                  value={draftPrefs.defaultPriority}
                  onChange={(e) => setDraftPrefs((prev) => ({ ...prev, defaultPriority: e.target.value }))}
                >
                  {ANNOTATION_PRIORITIES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Default Stroke Width */}
              <div className="fc-preference-field">
                <label className="fc-field-label">
                  Default Stroke Width
                  <span className="fc-field-hint">Line thickness for newly drawn geometric shapes</span>
                </label>
                <div className="fc-stroke-buttons">
                  {STROKE_WIDTHS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      className={`fc-btn fc-btn-sm ${
                        draftPrefs.defaultStrokeWidth === w ? 'fc-btn-primary' : 'fc-btn-secondary'
                      }`}
                      onClick={() => setDraftPrefs((prev) => ({ ...prev, defaultStrokeWidth: w }))}
                    >
                      {w}px
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Canvas & Zoom */}
          {activeTab === 'canvas' && (
            <div className="fc-preferences-section">
              <div className="fc-preference-field">
                <label className="fc-field-label">
                  Zoom Behavior on Image Navigation
                  <span className="fc-field-hint">Controls how canvas zoom behaves when switching between batch images</span>
                </label>
                <div className="fc-radio-cards">
                  {ZOOM_PREFERENCE_OPTIONS.map((opt) => {
                    const isSelected = draftPrefs.zoomPreference === opt.id;
                    return (
                      <label
                        key={opt.id}
                        className={`fc-radio-card${isSelected ? ' fc-radio-card-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="zoomPreference"
                          value={opt.id}
                          checked={isSelected}
                          onChange={() => setDraftPrefs((prev) => ({ ...prev, zoomPreference: opt.id }))}
                        />
                        <div className="fc-radio-card-content">
                          <span className="fc-radio-card-title">{opt.label}</span>
                          <span className="fc-radio-card-desc">{opt.description}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Toolbar & Workspace */}
          {activeTab === 'toolbar' && (
            <div className="fc-preferences-section">
              {/* Toolbar Position */}
              <div className="fc-preference-field">
                <label className="fc-field-label">
                  Toolbar Position
                  <span className="fc-field-hint">Choose where the annotation drawing toolbar is docked</span>
                </label>
                <div className="fc-radio-cards">
                  {TOOLBAR_POSITION_OPTIONS.map((opt) => {
                    const isSelected = draftPrefs.toolbarPosition === opt.id;
                    return (
                      <label
                        key={opt.id}
                        className={`fc-radio-card${isSelected ? ' fc-radio-card-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="toolbarPosition"
                          value={opt.id}
                          checked={isSelected}
                          onChange={() => setDraftPrefs((prev) => ({ ...prev, toolbarPosition: opt.id }))}
                        />
                        <div className="fc-radio-card-content">
                          <span className="fc-radio-card-title">{opt.label}</span>
                          <span className="fc-radio-card-desc">{opt.description}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Toolbar Density */}
              <div className="fc-preference-field">
                <label className="fc-field-label">
                  Toolbar Layout Density
                  <span className="fc-field-hint">Button padding and sizing in the annotation toolbar</span>
                </label>
                <div className="fc-radio-cards">
                  {TOOLBAR_DENSITY_OPTIONS.map((opt) => {
                    const isSelected = draftPrefs.toolbarDensity === opt.id;
                    return (
                      <label
                        key={opt.id}
                        className={`fc-radio-card${isSelected ? ' fc-radio-card-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="toolbarDensity"
                          value={opt.id}
                          checked={isSelected}
                          onChange={() => setDraftPrefs((prev) => ({ ...prev, toolbarDensity: opt.id }))}
                        />
                        <div className="fc-radio-card-content">
                          <span className="fc-radio-card-title">{opt.label}</span>
                          <span className="fc-radio-card-desc">{opt.description}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Workspace Settings Toggles */}
              <div className="fc-preference-field">
                <label className="fc-field-label">
                  Reviewer Workspace Settings
                  <span className="fc-field-hint">Collaboration and interaction options</span>
                </label>
                <div className="fc-checkbox-stack">
                  <label className="fc-checkbox-item">
                    <input
                      type="checkbox"
                      checked={draftPrefs.showLiveCursors}
                      onChange={(e) => setDraftPrefs((prev) => ({ ...prev, showLiveCursors: e.target.checked }))}
                    />
                    <span className="fc-checkbox-item-label">
                      <strong>Show live coworker cursors</strong>
                      <span>Display real-time cursor pointers of other reviewers active in this batch</span>
                    </span>
                  </label>

                  <label className="fc-checkbox-item">
                    <input
                      type="checkbox"
                      checked={draftPrefs.autoSelectNewAnnotation}
                      onChange={(e) => setDraftPrefs((prev) => ({ ...prev, autoSelectNewAnnotation: e.target.checked }))}
                    />
                    <span className="fc-checkbox-item-label">
                      <strong>Auto-select newly drafted annotations</strong>
                      <span>Automatically select and highlight annotations immediately after creation</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Theme & Appearance (Phase 22D) */}
          {activeTab === 'appearance' && (
            <div className="fc-preferences-section">
              {/* Color Theme */}
              <div className="fc-preference-field">
                <label className="fc-field-label">
                  Display Appearance Theme
                  <span className="fc-field-hint">Select your preferred color scheme across all FrameCheck pages</span>
                </label>
                <div className="fc-radio-cards">
                  {THEME_PREFERENCE_OPTIONS.map((opt) => {
                    const isSelected = (draftPrefs.theme || 'system') === opt.id;
                    return (
                      <label
                        key={opt.id}
                        className={`fc-radio-card${isSelected ? ' fc-radio-card-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="theme"
                          value={opt.id}
                          checked={isSelected}
                          onChange={() => {
                            setDraftPrefs((prev) => ({ ...prev, theme: opt.id }));
                            setTheme(opt.id);
                          }}
                        />
                        <div className="fc-radio-card-content">
                          <span className="fc-radio-card-title">{opt.label}</span>
                          <span className="fc-radio-card-desc">{opt.description}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Onboarding Guide Relaunch */}
              <div className="fc-preference-field" style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--fc-border-subtle)' }}>
                <label className="fc-field-label">
                  Onboarding & Feature Walkthrough
                  <span className="fc-field-hint">Need a refresher on FrameCheck tools, shortcuts, and review workflow?</span>
                </label>
                <div style={{ marginTop: '8px' }}>
                  <button
                    type="button"
                    className="fc-btn fc-btn-secondary fc-btn-sm"
                    onClick={() => {
                      onClose();
                      onRelaunchOnboarding?.();
                    }}
                  >
                    📖 Relaunch Onboarding Guide
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="fc-preferences-footer">
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-sm"
            onClick={handleResetDefaults}
          >
            Reset Defaults
          </button>
          <div className="fc-preferences-footer-actions">
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="fc-btn fc-btn-primary fc-btn-sm"
              onClick={handleSave}
            >
              Save Preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
