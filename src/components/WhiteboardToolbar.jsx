import {
  WHITEBOARD_SHAPE_COLORS,
  WHITEBOARD_STICKY_COLORS,
  WHITEBOARD_TOOL_MODES,
} from '../services/whiteboardState.js';
import './WhiteboardToolbar.css';

/**
 * Compact floating toolbar for whiteboard tools, colors, and element actions.
 */
export function WhiteboardToolbar({
  activeTool,
  onSelectTool,
  activeColor,
  onSelectColor,
  selectedElement,
  canEditSelected,
  onDeleteSelected,
  readOnly = false,
}) {
  const isStickyOrText =
    selectedElement?.type === 'sticky' ||
    selectedElement?.type === 'text' ||
    activeTool === WHITEBOARD_TOOL_MODES.STICKY ||
    activeTool === WHITEBOARD_TOOL_MODES.TEXT;

  const colorPalette = isStickyOrText
    ? WHITEBOARD_STICKY_COLORS
    : WHITEBOARD_SHAPE_COLORS;

  return (
    <aside
      className="fc-whiteboard-toolbar-container"
      role="toolbar"
      aria-label="Whiteboard tools"
    >
      <div className="fc-whiteboard-toolbar">
        {/* Navigation & Selection Tools */}
        <div className="fc-toolbar-btn-group">
          <button
            type="button"
            className={`fc-wb-tool-btn ${
              activeTool === WHITEBOARD_TOOL_MODES.SELECT ? 'active' : ''
            }`}
            onClick={() => onSelectTool(WHITEBOARD_TOOL_MODES.SELECT)}
            title="Select tool (V)"
            aria-label="Select tool"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 4l7 17 2.5-6.5L20 12 4 4z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <button
            type="button"
            className={`fc-wb-tool-btn ${
              activeTool === WHITEBOARD_TOOL_MODES.PAN ? 'active' : ''
            }`}
            onClick={() => onSelectTool(WHITEBOARD_TOOL_MODES.PAN)}
            title="Pan / Hand tool (H or Spacebar)"
            aria-label="Pan tool"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M8 13V6a2 2 0 114 0v5m0-3a2 2 0 114 0v3m0-1a2 2 0 114 0v6a7 7 0 11-14 0v-4a2 2 0 114 0v2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {!readOnly ? (
          <>
            <span className="fc-wb-divider" aria-hidden="true" />

            {/* Creation Tools */}
            <div className="fc-toolbar-btn-group">
              <button
                type="button"
                className={`fc-wb-tool-btn ${
                  activeTool === WHITEBOARD_TOOL_MODES.STICKY ? 'active' : ''
                }`}
                onClick={() => onSelectTool(WHITEBOARD_TOOL_MODES.STICKY)}
                title="Sticky Note (S)"
                aria-label="Sticky note tool"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h9l6-6V5a2 2 0 00-2-2z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 21v-5a1 1 0 011-1h5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              <button
                type="button"
                className={`fc-wb-tool-btn ${
                  activeTool === WHITEBOARD_TOOL_MODES.TEXT ? 'active' : ''
                }`}
                onClick={() => onSelectTool(WHITEBOARD_TOOL_MODES.TEXT)}
                title="Text box (T)"
                aria-label="Text tool"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 7V4h16v3M12 4v16m-3 0h6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              <button
                type="button"
                className={`fc-wb-tool-btn ${
                  activeTool === WHITEBOARD_TOOL_MODES.RECTANGLE ? 'active' : ''
                }`}
                onClick={() => onSelectTool(WHITEBOARD_TOOL_MODES.RECTANGLE)}
                title="Rectangle (R)"
                aria-label="Rectangle tool"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect
                    x="3"
                    y="5"
                    width="18"
                    height="14"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </button>

              <button
                type="button"
                className={`fc-wb-tool-btn ${
                  activeTool === WHITEBOARD_TOOL_MODES.CIRCLE ? 'active' : ''
                }`}
                onClick={() => onSelectTool(WHITEBOARD_TOOL_MODES.CIRCLE)}
                title="Circle / Shape (O)"
                aria-label="Circle tool"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </button>

              <button
                type="button"
                className={`fc-wb-tool-btn ${
                  activeTool === WHITEBOARD_TOOL_MODES.ARROW ? 'active' : ''
                }`}
                onClick={() => onSelectTool(WHITEBOARD_TOOL_MODES.ARROW)}
                title="Arrow / Connector (A)"
                aria-label="Arrow tool"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 19L19 5M9 5h10v10"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              <button
                type="button"
                className={`fc-wb-tool-btn ${
                  activeTool === WHITEBOARD_TOOL_MODES.PENCIL ? 'active' : ''
                }`}
                onClick={() => onSelectTool(WHITEBOARD_TOOL_MODES.PENCIL)}
                title="Pencil / Draw (P)"
                aria-label="Pencil tool"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            <span className="fc-wb-divider" aria-hidden="true" />

            {/* Color Palette Selector */}
            <div className="fc-wb-color-chips" role="radiogroup" aria-label="Color options">
              {colorPalette.map((col) => (
                <button
                  key={col.value}
                  type="button"
                  className={`fc-wb-color-swatch ${
                    activeColor === col.value ? 'active' : ''
                  }`}
                  style={{ backgroundColor: col.value }}
                  onClick={() => onSelectColor(col.value)}
                  title={col.label}
                  aria-label={col.label}
                />
              ))}
            </div>

            {selectedElement && canEditSelected ? (
              <>
                <span className="fc-wb-divider" aria-hidden="true" />
                <button
                  type="button"
                  className="fc-wb-tool-btn fc-wb-tool-delete"
                  onClick={onDeleteSelected}
                  title="Delete element (Del / Backspace)"
                  aria-label="Delete selected element"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6m4-6v6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </>
            ) : null}
          </>
        ) : (
          <div className="fc-wb-readonly-badge">
            <span>Viewing only</span>
          </div>
        )}
      </div>
    </aside>
  );
}

