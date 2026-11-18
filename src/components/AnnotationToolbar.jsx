import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ANNOTATION_COLORS,
  ANNOTATION_MARKERS,
  ANNOTATION_PRIORITIES,
  ANNOTATION_STAMPS,
  ARROW_HEAD_STYLES,
  DEFAULT_ANNOTATION_STYLE,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  LINE_STYLES,
  PRIORITY_CONFIG,
  STROKE_WIDTH_OPTIONS,
  getReviewerColor,
} from '../services/annotationState.js';
import './AnnotationToolbar.css';

function getInitials(name) {
  if (!name) return 'R';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * 14 annotation tools supported by FrameCheck 2.0.
 * Preserves all tool IDs, shortcuts, and default labels.
 */
export const ANNOTATION_TOOLS = [
  // --- Group A: Selection & Navigation ---
  {
    id: 'select',
    label: 'Select',
    shortcut: 'V',
    title: 'Select / Move (V)',
    group: 'select',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M3 2l10 6-5.5 1.5L6 14.5 3 2z" />
      </svg>
    ),
  },
  {
    id: 'pan',
    label: 'Pan',
    shortcut: 'H',
    title: 'Pan View (H or hold Space)',
    group: 'select',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4.5 7.5V3a1 1 0 0 1 2 0v4m0-3a1 1 0 0 1 2 0v3.5m0-3a1 1 0 0 1 2 0v4.5m0-1a1 1 0 0 1 2 0V11a4 4 0 0 1-4 4H7.5A4.5 4.5 0 0 1 3 10.5V7a1 1 0 0 1 1.5-.86" />
      </svg>
    ),
  },

  // --- Group B: Drawing Tools ---
  {
    id: 'rectangle',
    label: 'Rect',
    shortcut: 'R',
    title: 'Draw Rectangle (R)',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'circle',
    label: 'Circle',
    shortcut: 'C',
    title: 'Draw Circle (C)',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
      </svg>
    ),
  },
  {
    id: 'arrow',
    label: 'Arrow',
    shortcut: 'A',
    title: 'Draw Arrow (A)',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="3" y1="13" x2="13" y2="3" />
        <polyline points="6 3 13 3 13 10" />
      </svg>
    ),
  },
  {
    id: 'line',
    label: 'Line',
    shortcut: 'L',
    title: 'Straight Line (L)',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <line x1="3" y1="13" x2="13" y2="3" />
      </svg>
    ),
  },
  {
    id: 'pencil',
    label: 'Pencil',
    shortcut: 'P',
    title: 'Freehand Pencil (P)',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H2.5v-2.5l8.5-8.5z" />
      </svg>
    ),
  },
  {
    id: 'highlighter',
    label: 'Highlight',
    shortcut: 'I',
    title: 'Freehand Highlighter (I)',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9.5 2.5l4 4L6 14H2v-4L9.5 2.5z" />
        <line x1="2" y1="14" x2="8" y2="14" strokeWidth="2.5" />
      </svg>
    ),
  },
  {
    id: 'polygon',
    label: 'Polygon',
    shortcut: 'G',
    title: 'Draw Polygon (G) - Click points, click start or double-click to close',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="8 2 14 6 12 13 4 13 2 6" />
      </svg>
    ),
  },
  {
    id: 'cloud',
    label: 'Cloud',
    shortcut: 'U',
    title: 'Revision Cloud (U)',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4.5 13h8a3.5 3.5 0 0 0 1.2-6.8A4.5 4.5 0 0 0 5 5a3.5 3.5 0 0 0-.5 8z" />
      </svg>
    ),
  },
  {
    id: 'callout',
    label: 'Callout',
    shortcut: 'T',
    title: 'Text Callout (T)',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 3h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3.5 3v-3H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      </svg>
    ),
  },
  {
    id: 'textbox',
    label: 'Text',
    shortcut: 'X',
    title: 'Text Box (X)',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" rx="2" strokeDasharray="3 2" />
        <path d="M5.5 5.5h5M8 5.5v6" />
      </svg>
    ),
  },
  {
    id: 'marker',
    label: 'Marker',
    shortcut: 'M',
    title: 'Numbered Marker Pin (M) - Click on image to place marker',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 9.5 4.5 9.5s4.5-6.3 4.5-9.5A4.5 4.5 0 0 0 8 1zm0 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
      </svg>
    ),
  },
  {
    id: 'blur',
    label: 'Blur',
    shortcut: 'B',
    title: 'Blur / Pixelate Area (B)',
    group: 'draw',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" rx="2" />
        <circle cx="5.5" cy="5.5" r="1" fill="currentColor" />
        <circle cx="10.5" cy="5.5" r="1" fill="currentColor" />
        <circle cx="5.5" cy="10.5" r="1" fill="currentColor" />
        <circle cx="10.5" cy="10.5" r="1" fill="currentColor" />
        <circle cx="8" cy="8" r="1" fill="currentColor" />
      </svg>
    ),
  },
];

export const SELECTION_TOOLS = ANNOTATION_TOOLS.filter((t) => t.group === 'select');
export const DRAWING_TOOLS = ANNOTATION_TOOLS.filter((t) => t.group === 'draw');

export const SHAPE_TOOLS = DRAWING_TOOLS.filter((t) => ['rectangle', 'circle', 'polygon', 'cloud'].includes(t.id));
export const LINE_TOOLS = DRAWING_TOOLS.filter((t) => ['arrow', 'line'].includes(t.id));
export const FREEHAND_TOOLS = DRAWING_TOOLS.filter((t) => ['pencil', 'highlighter'].includes(t.id));
export const TEXT_TOOLS = DRAWING_TOOLS.filter((t) => ['callout', 'textbox'].includes(t.id));
export const PIN_TOOLS = DRAWING_TOOLS.filter((t) => ['marker', 'blur'].includes(t.id));

export const QUICK_SWATCH_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];

/**
 * Built-in style presets for rapid reviewer styling.
 */
export const ANNOTATION_STYLE_PRESETS = [
  {
    id: 'default',
    label: 'Default',
    title: 'Standard 3px solid line',
    style: { strokeWidth: 3, lineStyle: 'solid', strokeOpacity: 1, fillEnabled: false },
  },
  {
    id: 'subtle',
    label: 'Subtle',
    title: 'Light 1.5px semi-transparent outline',
    style: { strokeWidth: 1.5, lineStyle: 'solid', strokeOpacity: 0.7, fillEnabled: false },
  },
  {
    id: 'highlight',
    label: 'Filled Area',
    title: '2px border with 20% transparent color fill',
    style: { strokeWidth: 2, lineStyle: 'solid', strokeOpacity: 1, fillEnabled: true, fillOpacity: 0.2 },
  },
  {
    id: 'dashed',
    label: 'Dashed',
    title: '2.5px dashed border for revisions',
    style: { strokeWidth: 2.5, lineStyle: 'dashed', strokeOpacity: 1, fillEnabled: false },
  },
];

/**
 * Polished, compact creative-application annotation toolbar for FrameCheck 2.0.
 * Inspired by Figma, Linear, and modern canvas tools.
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
  zoom = 1,
  zoomPercent = 100,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onActualSize,
  onResetView,
  isAtMinZoom = false,
  isAtMaxZoom = false,
  isFocusMode = false,
  onToggleFocusMode = null,
  activeDrawStyle = DEFAULT_ANNOTATION_STYLE,
  onStyleChange = null,
  activeLayerId = 'default',
  onActiveLayerChange = null,
  layers = [],
  lockedLayerIds = new Set(),
  selectedAnnotationIds = [],
  onOpenLayerManager = null,
  onOpenPropertiesModal = null,
  onMoveAnnotationLayer = null,
  onBulkMoveLayer = null,
  onBulkDelete = null,
  onUpdateAnnotationAssignment = null,
  onUpdateAnnotationPriority = null,
  mentionableUsers = [],
  toolbarPosition = 'top',
  toolbarDensity = 'comfortable',
  rotation = 0,
  onRotateCW = null,
  onRotateCCW = null,
  onResetRotation = null,
  isMagnifierActive = false,
  onToggleMagnifier = null,
  autosaveStatus = 'saved',
  onRetryAutosave = null,
  onOpenTemplates = null,
  onOpenShortcuts = null,
  shortcuts = {},
}) {
  const [dragPosition, setDragPosition] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isColorOpen, setIsColorOpen] = useState(false);
  const [isStyleOpen, setIsStyleOpen] = useState(false);
  const [isLayerMenuOpen, setIsLayerMenuOpen] = useState(false);
  const [isPriorityOpen, setIsPriorityOpen] = useState(false);
  const [isAssigneeOpen, setIsAssigneeOpen] = useState(false);

  const [colorCoords, setColorCoords] = useState(null);
  const [styleCoords, setStyleCoords] = useState(null);
  const [layerCoords, setLayerCoords] = useState(null);

  const toolbarRef = useRef(null);
  const dragStartRef = useRef(null);
  const colorBtnRef = useRef(null);
  const styleBtnRef = useRef(null);
  const layerBtnRef = useRef(null);
  const priorityBtnRef = useRef(null);
  const assigneeBtnRef = useRef(null);

  const colorPopoverRef = useRef(null);
  const stylePopoverRef = useRef(null);
  const layerPopoverRef = useRef(null);

  // Reset initial scroll position to start so all tools remain accessible
  useLayoutEffect(() => {
    if (toolbarRef.current) {
      toolbarRef.current.scrollLeft = 0;
    }
  }, []);

  // Smooth intentional horizontal scrolling on mouse wheel if content exceeds container width
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const handleWheel = (e) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) && el.scrollWidth > el.clientWidth) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Calculate viewport-aware coordinates for Color Popover
  const updateColorCoords = useCallback(() => {
    if (!colorBtnRef.current) return;
    const btnRect = colorBtnRef.current.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const spaceBelow = window.innerHeight - btnRect.bottom - margin;
    const spaceAbove = btnRect.top - margin;

    const openUpward = spaceBelow < 250 && spaceAbove > spaceBelow;
    const popoverWidth = Math.min(240, window.innerWidth - (margin * 2));
    const left = Math.max(margin, Math.min(btnRect.left, window.innerWidth - popoverWidth - margin));

    setColorCoords({
      left: Math.round(left),
      top: openUpward ? 'auto' : Math.round(btnRect.bottom + gap),
      bottom: openUpward ? Math.round(window.innerHeight - btnRect.top + gap) : 'auto',
      maxHeight: Math.round(Math.min(360, Math.max(160, openUpward ? spaceAbove - gap : spaceBelow - gap))),
      width: Math.round(popoverWidth),
    });
  }, []);

  // Calculate viewport-aware coordinates for Style Popover
  const updateStyleCoords = useCallback(() => {
    if (!styleBtnRef.current) return;
    const btnRect = styleBtnRef.current.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const spaceBelow = window.innerHeight - btnRect.bottom - margin;
    const spaceAbove = btnRect.top - margin;

    const openUpward = spaceBelow < 340 && spaceAbove > spaceBelow;
    const popoverWidth = Math.min(300, window.innerWidth - (margin * 2));
    const left = Math.max(margin, Math.min(btnRect.left, window.innerWidth - popoverWidth - margin));

    setStyleCoords({
      left: Math.round(left),
      top: openUpward ? 'auto' : Math.round(btnRect.bottom + gap),
      bottom: openUpward ? Math.round(window.innerHeight - btnRect.top + gap) : 'auto',
      maxHeight: Math.round(Math.min(520, Math.max(180, openUpward ? spaceAbove - gap : spaceBelow - gap))),
      width: Math.round(popoverWidth),
    });
  }, []);

  // Calculate viewport-aware coordinates for Layer Dropdown Popover
  const updateLayerCoords = useCallback(() => {
    if (!layerBtnRef.current) return;
    const btnRect = layerBtnRef.current.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const spaceBelow = window.innerHeight - btnRect.bottom - margin;
    const spaceAbove = btnRect.top - margin;

    const openUpward = spaceBelow < 220 && spaceAbove > spaceBelow;
    const popoverWidth = Math.min(220, window.innerWidth - (margin * 2));
    const left = Math.max(margin, Math.min(btnRect.left, window.innerWidth - popoverWidth - margin));

    setLayerCoords({
      left: Math.round(left),
      top: openUpward ? 'auto' : Math.round(btnRect.bottom + gap),
      bottom: openUpward ? Math.round(window.innerHeight - btnRect.top + gap) : 'auto',
      maxHeight: Math.round(Math.min(420, Math.max(140, openUpward ? spaceAbove - gap : spaceBelow - gap))),
      width: Math.round(popoverWidth),
    });
  }, []);

  const handleToggleColor = useCallback(() => {
    if (!isColorOpen) {
      updateColorCoords();
    }
    setIsColorOpen((prev) => !prev);
    setIsStyleOpen(false);
    setIsLayerMenuOpen(false);
    setIsPriorityOpen(false);
    setIsAssigneeOpen(false);
  }, [isColorOpen, updateColorCoords]);

  const handleToggleStyle = useCallback(() => {
    if (!isStyleOpen) {
      updateStyleCoords();
    }
    setIsStyleOpen((prev) => !prev);
    setIsColorOpen(false);
    setIsLayerMenuOpen(false);
    setIsPriorityOpen(false);
    setIsAssigneeOpen(false);
  }, [isStyleOpen, updateStyleCoords]);

  const handleToggleLayerMenu = useCallback(() => {
    if (!isLayerMenuOpen) {
      updateLayerCoords();
    }
    setIsLayerMenuOpen((prev) => !prev);
    setIsColorOpen(false);
    setIsStyleOpen(false);
    setIsPriorityOpen(false);
    setIsAssigneeOpen(false);
  }, [isLayerMenuOpen, updateLayerCoords]);

  // Keep popovers positioned correctly on resize, scroll, or toolbar drag
  useLayoutEffect(() => {
    if (!isColorOpen && !isStyleOpen && !isLayerMenuOpen) return;
    const handleUpdate = () => {
      if (isColorOpen) updateColorCoords();
      if (isStyleOpen) updateStyleCoords();
      if (isLayerMenuOpen) updateLayerCoords();
    };
    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [isColorOpen, isStyleOpen, isLayerMenuOpen, updateColorCoords, updateStyleCoords, updateLayerCoords, dragPosition]);

  // Close popovers on click outside
  useEffect(() => {
    if (!isColorOpen && !isStyleOpen && !isLayerMenuOpen && !isPriorityOpen && !isAssigneeOpen) return;
    const handleClickOutside = (e) => {
      if (
        isColorOpen &&
        colorPopoverRef.current &&
        !colorPopoverRef.current.contains(e.target) &&
        !colorBtnRef.current?.contains(e.target) &&
        !e.target.closest('.fc-ann-color-btn')
      ) {
        setIsColorOpen(false);
      }
      if (
        isStyleOpen &&
        stylePopoverRef.current &&
        !stylePopoverRef.current.contains(e.target) &&
        !styleBtnRef.current?.contains(e.target) &&
        !e.target.closest('.fc-ann-style-btn')
      ) {
        setIsStyleOpen(false);
      }
      if (
        isLayerMenuOpen &&
        layerPopoverRef.current &&
        !layerPopoverRef.current.contains(e.target) &&
        !layerBtnRef.current?.contains(e.target) &&
        !e.target.closest('.fc-ann-layer-btn')
      ) {
        setIsLayerMenuOpen(false);
      }
      if (isPriorityOpen && priorityBtnRef.current && !priorityBtnRef.current.contains(e.target)) {
        setIsPriorityOpen(false);
      }
      if (isAssigneeOpen && assigneeBtnRef.current && !assigneeBtnRef.current.contains(e.target)) {
        setIsAssigneeOpen(false);
      }
    };
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, [isColorOpen, isStyleOpen, isLayerMenuOpen, isPriorityOpen, isAssigneeOpen]);

  // Close popovers on Escape key
  useEffect(() => {
    if (!isColorOpen && !isStyleOpen && !isLayerMenuOpen && !isPriorityOpen && !isAssigneeOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsColorOpen(false);
        setIsStyleOpen(false);
        setIsLayerMenuOpen(false);
        setIsPriorityOpen(false);
        setIsAssigneeOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isColorOpen, isStyleOpen, isLayerMenuOpen, isPriorityOpen, isAssigneeOpen]);

  // Reset position to default docked coordinates whenever Focus Mode or toolbarPosition changes
  useEffect(() => {
    setDragPosition(null);
    setIsDragging(false);
    dragStartRef.current = null;
  }, [isFocusMode, toolbarPosition]);

  // Window resize listener to re-clamp custom dragPosition within viewport
  useEffect(() => {
    if (!dragPosition) return;
    const handleResize = () => {
      if (!toolbarRef.current) return;
      const rect = toolbarRef.current.getBoundingClientRect();
      const margin = 12;
      const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxY = Math.max(margin, window.innerHeight - rect.height - margin);

      setDragPosition((prev) => {
        if (!prev) return prev;
        const nextX = Math.round(Math.max(margin, Math.min(prev.x, maxX)));
        const nextY = Math.round(Math.max(margin, Math.min(prev.y, maxY)));
        if (nextX === prev.x && nextY === prev.y) return prev;
        return { x: nextX, y: nextY };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [dragPosition]);

  // Global window pointermove and pointerup listeners while dragging
  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e) => {
      if (!dragStartRef.current) return;
      e.preventDefault();

      const newLeft = e.clientX - dragStartRef.current.grabOffsetX;
      const newTop = e.clientY - dragStartRef.current.grabOffsetY;

      const margin = 12;
      const maxLeft = Math.max(margin, window.innerWidth - dragStartRef.current.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - dragStartRef.current.height - margin);

      const clampedLeft = Math.min(Math.max(margin, newLeft), maxLeft);
      const clampedTop = Math.min(Math.max(margin, newTop), maxTop);

      setDragPosition({ x: Math.round(clampedLeft), y: Math.round(clampedTop) });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging]);

  const handleDragPointerDown = useCallback((e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();

    setIsColorOpen(false);
    setIsStyleOpen(false);
    setIsLayerMenuOpen(false);
    setIsPriorityOpen(false);
    setIsAssigneeOpen(false);

    const toolbarEl = toolbarRef.current;
    if (!toolbarEl) return;

    const rect = toolbarEl.getBoundingClientRect();
    dragStartRef.current = {
      grabOffsetX: e.clientX - rect.left,
      grabOffsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };

    // Immediately anchor dragPosition to match the toolbar's exact current screen coordinates.
    // This transitions the toolbar to position:fixed and margin:0 before any pointer movement,
    // completely eliminating the initial jump or offset.
    setDragPosition({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
    });

    setIsDragging(true);
  }, []);

  const floatingStyle = useMemo(() => {
    if (!dragPosition) return undefined;
    return {
      position: 'fixed',
      left: `${dragPosition.x}px`,
      top: `${dragPosition.y}px`,
      bottom: 'auto',
      right: 'auto',
      transform: 'none',
      margin: '0',
      zIndex: 42,
    };
  }, [dragPosition]);

  const handleCollapseToolbar = useCallback(() => {
    setIsColorOpen(false);
    setIsStyleOpen(false);
    setIsLayerMenuOpen(false);
    setIsPriorityOpen(false);
    setIsAssigneeOpen(false);
    setIsCollapsed(true);
  }, []);

  const handleExpandToolbar = useCallback(() => {
    setIsCollapsed(false);
    if (dragPosition) {
      const margin = 12;
      const estimatedWidth = 720;
      const maxX = Math.max(margin, window.innerWidth - estimatedWidth - margin);
      if (dragPosition.x > maxX) {
        setDragPosition((prev) => (prev ? { ...prev, x: maxX } : prev));
      }
    }
  }, [dragPosition]);

  const dragHandle = (
    <div
      className={`fc-ann-drag-handle${isDragging ? ' is-dragging' : ''}`}
      onPointerDown={handleDragPointerDown}
      role="button"
      tabIndex={-1}
      aria-label="Drag toolbar"
      title="Drag to reposition toolbar"
    >
      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
        <circle cx="3" cy="3" r="1.5" />
        <circle cx="7" cy="3" r="1.5" />
        <circle cx="3" cy="8" r="1.5" />
        <circle cx="7" cy="8" r="1.5" />
        <circle cx="3" cy="13" r="1.5" />
        <circle cx="7" cy="13" r="1.5" />
      </svg>
    </div>
  );

  const effectiveColor = selectedAnnotation ? selectedAnnotation.color : activeDrawColor;
  const isSelectedResolved = selectedAnnotation?.status === 'resolved';
  const isSelectedLayerLocked = selectedAnnotation
    ? lockedLayerIds.has(selectedAnnotation.layerId || 'default')
    : false;
  const isMultiSelected = selectedAnnotationIds.length > 1;

  const tbEligibleReviewers = useMemo(() => {
    return (mentionableUsers || []).filter(
      (u) => u.role === 'reviewer' || u.role === 'admin'
    );
  }, [mentionableUsers]);

  const selectedAssignee = tbEligibleReviewers.find(
    (u) => u.id === selectedAnnotation?.assignedTo
  );
  const selectedAssigneeName =
    selectedAssignee?.displayName ||
    selectedAnnotation?.assigneeName ||
    (selectedAnnotation?.assignedTo ? 'Reviewer' : 'Unassigned');

  const colorLocked =
    disabled ||
    isSyncing ||
    Boolean(selectedAnnotation && (!canEditSelected || isSelectedResolved || isSelectedLayerLocked));
  const deleteLocked = isMultiSelected
    ? disabled || isSyncing
    : disabled || isSyncing || !selectedAnnotation || !canEditSelected || isSelectedLayerLocked;

  const currentToolType = useMemo(() => {
    if (selectedAnnotation) {
      return (
        selectedAnnotation.type ||
        selectedAnnotation.geometry?.type ||
        selectedAnnotation.geometry?.tool ||
        'circle'
      );
    }
    return toolMode === 'draw' ? 'circle' : toolMode;
  }, [selectedAnnotation, toolMode]);

  const supportsLineStyle = currentToolType !== 'highlighter';
  const supportsFill = [
    'circle',
    'rectangle',
    'polygon',
    'cloud',
    'textbox',
    'callout',
  ].includes(currentToolType);
  const supportsArrowHead = currentToolType === 'arrow';
  const supportsTypography =
    currentToolType === 'textbox' || currentToolType === 'callout';

  // Canvas Viewport & Zoom Controls
  const zoomControls = (
    <div className="fc-ann-zoom-group" role="group" aria-label="Image zoom and navigation controls">
      <button
        type="button"
        className="fc-ann-zoom-btn"
        onClick={onZoomOut}
        disabled={isAtMinZoom || !onZoomOut}
        title="Zoom Out (-)"
        aria-label="Zoom Out"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
      </button>
      <span className="fc-ann-zoom-value" title={`Current Zoom: ${zoomPercent}%`}>
        {zoomPercent}%
      </span>
      <button
        type="button"
        className="fc-ann-zoom-btn"
        onClick={onZoomIn}
        disabled={isAtMaxZoom || !onZoomIn}
        title="Zoom In (+)"
        aria-label="Zoom In"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="8" y1="3" x2="8" y2="13" />
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
      </button>
      <button
        type="button"
        className="fc-btn fc-btn-secondary fc-btn-xs"
        onClick={onFitToScreen}
        disabled={!onFitToScreen}
        title="Fit entire image to screen"
      >
        Fit
      </button>
      <button
        type="button"
        className="fc-btn fc-btn-secondary fc-btn-xs fc-ann-btn-responsive-hide"
        onClick={onActualSize}
        disabled={!onActualSize}
        title="Actual size (100% native image resolution)"
      >
        100%
      </button>
      <button
        type="button"
        className="fc-btn fc-btn-secondary fc-btn-xs fc-ann-btn-responsive-hide"
        onClick={onResetView}
        disabled={!onResetView}
        title="Reset view to default fitted position"
      >
        Reset
      </button>

      {/* Image Rotation Controls */}
      {onRotateCCW ? (
        <button
          type="button"
          className="fc-ann-zoom-btn fc-ann-btn-responsive-hide"
          onClick={onRotateCCW}
          title="Rotate 90° CCW ([)"
          aria-label="Rotate 90 degrees counter-clockwise"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
      ) : null}
      {onRotateCW ? (
        <button
          type="button"
          className="fc-ann-zoom-btn fc-ann-btn-responsive-hide"
          onClick={onRotateCW}
          title="Rotate 90° CW (])"
          aria-label="Rotate 90 degrees clockwise"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      ) : null}
      {rotation % 360 !== 0 && onResetRotation ? (
        <button
          type="button"
          className="fc-btn fc-btn-secondary fc-btn-xs fc-ann-rotation-badge"
          onClick={onResetRotation}
          title="Reset rotation to 0°"
          aria-label="Reset rotation to 0 degrees"
        >
          {rotation}° ✕
        </button>
      ) : null}

      {/* Magnifier Loupe Toggle */}
      {onToggleMagnifier ? (
        <button
          type="button"
          className={`fc-btn fc-btn-xs ${
            isMagnifierActive ? 'fc-btn-primary fc-ann-magnifier-active' : 'fc-btn-secondary'
          }`}
          onClick={onToggleMagnifier}
          title="Magnifier Loupe (Z)"
          aria-label="Toggle Magnifier Lens"
          aria-pressed={isMagnifierActive}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" />
          </svg>
          <span className="fc-ann-btn-label">Loupe</span>
        </button>
      ) : null}
    </div>
  );

  // Tool button renderer helper for consistent UI across tool groups
  const renderToolButton = useCallback(
    (tool) => {
      const isActive =
        toolMode === tool.id || (tool.id === 'circle' && toolMode === 'draw');
      const shortcutKey = shortcuts[`tool_${tool.id}`] || tool.shortcut;
      const displayTitle = shortcutKey ? `${tool.label} (${shortcutKey})` : tool.title;
      return (
        <button
          key={tool.id}
          type="button"
          className={`fc-ann-mode-btn${isActive ? ' fc-ann-mode-btn-active' : ''}`}
          onClick={() => onToolModeChange(tool.id)}
          disabled={disabled}
          title={displayTitle}
          aria-label={displayTitle}
          aria-pressed={isActive}
        >
          <span className="fc-ann-tool-icon">{tool.icon}</span>
        </button>
      );
    },
    [toolMode, shortcuts, onToolModeChange, disabled]
  );

  // READ-ONLY REVIEWER VARIANT
  if (readOnly) {
    if (isCollapsed) {
      return (
        <div
          ref={toolbarRef}
          style={floatingStyle}
          className={`fc-ann-toolbar fc-ann-toolbar-collapsed${
            isFocusMode ? ' fc-ann-toolbar-floating' : ''
          }${isDragging ? ' fc-ann-toolbar-dragging' : ''}${
            !isFocusMode && toolbarPosition === 'bottom'
              ? ' fc-ann-toolbar-bottom'
              : !isFocusMode
              ? ' fc-ann-toolbar-top'
              : ''
          }`}
          role="toolbar"
          aria-label="Collapsed read-only tools"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {dragHandle}
          <span className="fc-ann-sep" aria-hidden="true" />
          <button
            type="button"
            className="fc-ann-collapsed-expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleExpandToolbar();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Show review tools"
            aria-label="Expand read-only review tools"
          >
            <span className="fc-ann-collapsed-text">Review Tools</span>
            <span className="fc-ann-collapsed-action-hint">Show</span>
            <span className="fc-ann-collapsed-chevron" aria-hidden="true">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 6 8 10 12 6" />
              </svg>
            </span>
          </button>
        </div>
      );
    }

    return (
      <div
        ref={toolbarRef}
        style={floatingStyle}
        className={`fc-ann-toolbar fc-ann-toolbar-readonly${
          isFocusMode ? ' fc-ann-toolbar-floating' : ''
        }${isDragging ? ' fc-ann-toolbar-dragging' : ''}${
          !isFocusMode && toolbarPosition === 'bottom'
            ? ' fc-ann-toolbar-bottom'
            : !isFocusMode
            ? ' fc-ann-toolbar-top'
            : ''
        }${toolbarDensity === 'compact' ? ' fc-ann-toolbar-compact' : ''}`}
        role="toolbar"
        aria-label="Read-only review tools"
      >
        {dragHandle}
        <span className="fc-ann-sep" aria-hidden="true" />
        <span className="fc-ann-readonly-pill">Read-only mode</span>

        <span className="fc-ann-sep" aria-hidden="true" />

        <div className="fc-ann-group" role="group" aria-label="Navigation tools">
          {SELECTION_TOOLS.map((tool) => {
            const isActive = toolMode === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                className={`fc-ann-mode-btn${isActive ? ' fc-ann-mode-btn-active' : ''}`}
                onClick={() => onToolModeChange(tool.id)}
                title={tool.title}
                aria-label={tool.title}
                aria-pressed={isActive}
              >
                <span className="fc-ann-tool-icon">{tool.icon}</span>
              </button>
            );
          })}
        </div>

        <span className="fc-ann-sep" aria-hidden="true" />

        {zoomControls}

        {onToggleFocusMode && !isFocusMode ? (
          <>
            <span className="fc-ann-sep" aria-hidden="true" />
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-xs fc-ann-focus-btn"
              onClick={onToggleFocusMode}
              title="Full-Screen Focus Mode (F)"
              aria-label="Full-Screen Focus Mode"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 6V2h4m8 4V2h-4M2 10v4h4m8-4v4h-4" />
              </svg>
              <span>Focus</span>
            </button>
          </>
        ) : null}

        {onOpenShortcuts ? (
          <>
            <span className="fc-ann-sep" aria-hidden="true" />
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-xs fc-ann-shortcuts-btn"
              onClick={(e) => onOpenShortcuts(e.currentTarget)}
              title="Keyboard Shortcuts"
              aria-label="Keyboard Shortcuts"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M6 16h12" />
              </svg>
              <span>Shortcuts</span>
            </button>
          </>
        ) : null}

        <span className="fc-ann-sep" aria-hidden="true" />
        <span className="fc-ann-hint">Drag image to pan. Wheel to zoom. Uploaders can monitor annotations and review status.</span>

        {/* Compact Hide/Collapse Toolbar Toggle */}
        <button
          type="button"
          className="fc-ann-collapse-toggle-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleCollapseToolbar();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Hide toolbar"
          aria-label="Collapse toolbar"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="4 10 8 6 12 10" />
          </svg>
          <span className="fc-ann-collapse-toggle-text">Hide</span>
        </button>
      </div>
    );
  }

  // COLLAPSED EDITING TOOLBAR VARIANT (MINIMAL NON-OBSTRUCTIVE PILL)
  if (isCollapsed) {
    const currentToolObj =
      ANNOTATION_TOOLS.find((t) => t.id === toolMode) ||
      ANNOTATION_TOOLS.find((t) => t.id === 'circle') ||
      ANNOTATION_TOOLS[0];

    return (
      <div
        ref={toolbarRef}
        style={floatingStyle}
        className={`fc-ann-toolbar fc-ann-toolbar-collapsed${
          isFocusMode ? ' fc-ann-toolbar-floating' : ''
        }${isDragging ? ' fc-ann-toolbar-dragging' : ''}${
          !isFocusMode && toolbarPosition === 'bottom'
            ? ' fc-ann-toolbar-bottom'
            : !isFocusMode
            ? ' fc-ann-toolbar-top'
            : ''
        }${toolbarDensity === 'compact' ? ' fc-ann-toolbar-compact' : ''}`}
        role="toolbar"
        aria-label="Collapsed annotation toolbar"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {dragHandle}
        <span className="fc-ann-sep" aria-hidden="true" />
        <button
          type="button"
          className="fc-ann-collapsed-expand-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleExpandToolbar();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title={`Show toolbar (Active tool: ${currentToolObj.label})`}
          aria-label="Expand annotation toolbar"
        >
          <span className="fc-ann-collapsed-icon" aria-hidden="true">
            {currentToolObj.icon}
          </span>
          <span
            className="fc-ann-collapsed-dot"
            style={{ backgroundColor: effectiveColor }}
            aria-hidden="true"
          />
          <span className="fc-ann-collapsed-text">{currentToolObj.label}</span>
          <span className="fc-ann-collapsed-action-hint">Show Tools</span>
          <span className="fc-ann-collapsed-chevron" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 6 8 10 12 6" />
            </svg>
          </span>
        </button>
      </div>
    );
  }

  // STANDARD EDITING TOOLBAR VARIANT (MULTI-ROW ARCHITECTURE)
  return (
    <div
      ref={toolbarRef}
      style={floatingStyle}
      className={`fc-ann-toolbar fc-ann-toolbar-multirow${
        isFocusMode ? ' fc-ann-toolbar-floating' : ''
      }${isDragging ? ' fc-ann-toolbar-dragging' : ''}${
        !isFocusMode && toolbarPosition === 'bottom'
          ? ' fc-ann-toolbar-bottom'
          : !isFocusMode
          ? ' fc-ann-toolbar-top'
          : ''
      }${toolbarDensity === 'compact' ? ' fc-ann-toolbar-compact' : ''}`}
      role="toolbar"
      aria-label="Annotation and review tools"
    >
      {/* ===================================================================
          ROW 1: TOOLS (Selection, Shapes, Lines, Freehand, Text, Pins)
          =================================================================== */}
      <div className="fc-tb-row fc-tb-row-tools">
        {/* Drag Handle positioned inside Row 1 before Select and Pan */}
        {dragHandle}
        <span className="fc-ann-sep" aria-hidden="true" />

        {/* Selection & Navigation */}
        <div className="fc-ann-group fc-ann-group-select" role="group" aria-label="Selection & navigation tools">
          {SELECTION_TOOLS.map(renderToolButton)}
        </div>

        <span className="fc-ann-sep" aria-hidden="true" />

        {/* Shapes (Rect, Circle, Polygon, Cloud) */}
        <div className="fc-ann-group fc-ann-group-shapes" role="group" aria-label="Shape tools">
          {SHAPE_TOOLS.map(renderToolButton)}
        </div>

        <span className="fc-ann-sep" aria-hidden="true" />

        {/* Lines (Arrow, Line) */}
        <div className="fc-ann-group fc-ann-group-lines" role="group" aria-label="Line tools">
          {LINE_TOOLS.map(renderToolButton)}
        </div>

        <span className="fc-ann-sep" aria-hidden="true" />

        {/* Freehand (Pencil, Highlighter) */}
        <div className="fc-ann-group fc-ann-group-freehand" role="group" aria-label="Freehand drawing tools">
          {FREEHAND_TOOLS.map(renderToolButton)}
        </div>

        <span className="fc-ann-sep" aria-hidden="true" />

        {/* Text (Callout, Textbox) */}
        <div className="fc-ann-group fc-ann-group-text" role="group" aria-label="Text tools">
          {TEXT_TOOLS.map(renderToolButton)}
        </div>

        <span className="fc-ann-sep" aria-hidden="true" />

        {/* Pins & Privacy (Marker, Blur) */}
        <div className="fc-ann-group fc-ann-group-pins" role="group" aria-label="Pins and privacy tools">
          {PIN_TOOLS.map(renderToolButton)}
        </div>

        {/* Contextual Active Tool Drawing Hint */}
        <div className="fc-tb-active-hint" aria-live="polite">
          {toolMode === 'draw' || toolMode === 'circle'
            ? 'Drag on image to draw a circle (C)'
            : toolMode === 'arrow'
              ? 'Drag on image to draw an arrow (A)'
              : toolMode === 'line'
                ? 'Drag on image to draw a straight line (L)'
                : toolMode === 'rectangle'
                  ? 'Drag on image to draw a rectangle (R)'
                  : toolMode === 'polygon'
                    ? 'Click to add polygon vertices; click start or double-click to close (G)'
                    : toolMode === 'cloud'
                      ? 'Drag on image to draw a revision cloud (U)'
                      : toolMode === 'pencil'
                        ? 'Click and drag to draw freehand pencil (P)'
                        : toolMode === 'highlighter'
                          ? 'Click and drag to highlight freehand (I)'
                          : toolMode === 'callout'
                            ? 'Click to place a text callout with pointer (T)'
                            : toolMode === 'textbox'
                              ? 'Drag to place an editable text box (X)'
                              : toolMode === 'blur'
                                ? 'Drag on image to blur or pixelate a sensitive area (B)'
                                : toolMode === 'marker'
                                  ? 'Click on image to place a numbered marker pin (M)'
                                  : toolMode === 'pan'
                                    ? 'Drag image to pan • Wheel to zoom (or hold Space)'
                                    : 'Click an annotation to inspect, move, or resize (V)'}
        </div>

        {/* Compact Hide/Collapse Toolbar Toggle */}
        <button
          type="button"
          className="fc-ann-collapse-toggle-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleCollapseToolbar();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Hide toolbar to clear canvas view (draw tool remains active)"
          aria-label="Collapse toolbar"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="4 10 8 6 12 10" />
          </svg>
          <span className="fc-ann-collapse-toggle-text">Hide</span>
        </button>
      </div>

      <div className="fc-tb-row-sep" aria-hidden="true" />

      {/* ===================================================================
          ROW 2: APPEARANCE & CUSTOMIZATION
          =================================================================== */}
      <div className="fc-tb-row fc-tb-row-appearance">
        {/* GROUP C: Annotation Appearance (Color & Style Settings) */}
        <div className="fc-ann-group fc-ann-group-appearance" role="group" aria-label="Annotation appearance">
        {/* Color Popover Trigger */}
        <div className="fc-ann-popover-anchor">
          <button
            ref={colorBtnRef}
            type="button"
            className={`fc-btn fc-btn-secondary fc-btn-sm fc-ann-color-btn${isColorOpen ? ' fc-btn-active' : ''}`}
            onClick={handleToggleColor}
            disabled={colorLocked}
            title={
              selectedAnnotation
                ? canEditSelected && !isSelectedResolved
                  ? `Change color for #${selectedAnnotation.displayNumber}`
                  : 'Annotation color (read-only)'
                : 'Drawing stroke & fill color'
            }
            aria-label="Annotation color settings"
            aria-expanded={isColorOpen}
          >
            <span
              className="fc-ann-color-chip"
              style={{ backgroundColor: effectiveColor }}
              aria-hidden="true"
            />
            <span className="fc-ann-color-label fc-ann-btn-label">Color</span>
            <span className="fc-ann-caret">▾</span>
          </button>

          {/* Color Popover via Portal */}
          {isColorOpen && typeof document !== 'undefined' && document.body
            ? createPortal(
                <div
                  ref={colorPopoverRef}
                  className="fc-ann-popover fc-ann-color-popover"
                  role="dialog"
                  aria-label="Annotation Color Options"
                  style={{
                    position: 'fixed',
                    left: colorCoords ? `${colorCoords.left}px` : undefined,
                    top: colorCoords?.top !== 'auto' && colorCoords?.top != null ? `${colorCoords.top}px` : 'auto',
                    bottom: colorCoords?.bottom !== 'auto' && colorCoords?.bottom != null ? `${colorCoords.bottom}px` : 'auto',
                    maxHeight: colorCoords ? `${colorCoords.maxHeight}px` : '360px',
                    width: colorCoords ? `${colorCoords.width}px` : '240px',
                    zIndex: 1050,
                    visibility: colorCoords ? 'visible' : 'hidden',
                  }}
                >
                  <div className="fc-popover-header">
                    <span className="fc-popover-title">
                      {selectedAnnotation
                        ? `Color: #${selectedAnnotation.displayNumber}`
                        : 'Drawing Color'}
                    </span>
                    <button
                      type="button"
                      className="fc-popover-close-btn"
                      onClick={() => setIsColorOpen(false)}
                      aria-label="Close color options"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="fc-popover-body">
                    {/* Swatches Grid */}
                    <div className="fc-color-grid">
                      {ANNOTATION_COLORS.map((swatch) => {
                        const isCurrent = effectiveColor === swatch.value;
                        return (
                          <button
                            key={swatch.value}
                            type="button"
                            className={`fc-color-swatch-item${isCurrent ? ' is-active' : ''}`}
                            onClick={() => {
                              onColorSelect(swatch.value);
                              setIsColorOpen(false);
                            }}
                            title={`Select ${swatch.name} (${swatch.value})`}
                          >
                            <span
                              className="fc-color-swatch-dot"
                              style={{ backgroundColor: swatch.value }}
                            />
                            <span className="fc-color-swatch-name">{swatch.name}</span>
                            {isCurrent ? <span className="fc-color-swatch-check">✓</span> : null}
                          </button>
                        );
                      })}
                    </div>

                    <div className="fc-popover-divider" />

                    {/* Custom Hex / Color Input */}
                    <div className="fc-custom-color-row">
                      <div className="fc-custom-color-input-wrap">
                        <input
                          type="color"
                          className="fc-custom-color-input"
                          value={effectiveColor}
                          onChange={(e) => onColorSelect(e.target.value)}
                          aria-label="Custom color picker"
                        />
                      </div>
                      <input
                        type="text"
                        className="fc-custom-hex-input"
                        value={effectiveColor.toUpperCase()}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                            if (val.length === 7) onColorSelect(val);
                          }
                        }}
                        placeholder="#000000"
                        maxLength={7}
                      />
                    </div>
                  </div>
                </div>,
                document.body
              )
            : null}
        </div>

        {/* Quick Color Swatches */}
        <div className="fc-quick-swatches" role="group" aria-label="Quick color swatches">
          {QUICK_SWATCH_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`fc-quick-swatch-dot${effectiveColor.toLowerCase() === c.toLowerCase() ? ' is-active' : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => onColorSelect(c)}
              disabled={colorLocked}
              title={`Set color to ${c}`}
              aria-label={`Color swatch ${c}`}
            ></button>
          ))}
        </div>

        <span className="fc-ann-sep" aria-hidden="true" />

        {/* Style Popover Trigger */}
        <div className="fc-ann-popover-anchor">
          <button
            ref={styleBtnRef}
            type="button"
            className={`fc-btn fc-btn-secondary fc-btn-sm fc-ann-style-btn${isStyleOpen ? ' fc-btn-active' : ''}`}
            onClick={handleToggleStyle}
            disabled={disabled || Boolean(selectedAnnotation && (!canEditSelected || isSelectedResolved || isSelectedLayerLocked))}
            title={isSelectedLayerLocked ? 'Layer is locked. Modifications are disabled.' : 'Drawing style settings (stroke, line style, fill, arrowheads, typography, markers)'}
            aria-label="Drawing style settings"
            aria-expanded={isStyleOpen}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="2" y1="4" x2="14" y2="4" />
              <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="3 2" />
              <line x1="2" y1="12" x2="14" y2="12" strokeWidth="2.5" />
            </svg>
            <span className="fc-ann-btn-label">Style</span>
            <span className="fc-ann-caret">▾</span>
          </button>

          {/* Style Popover via Portal */}
          {isStyleOpen && typeof document !== 'undefined' && document.body
            ? createPortal(
                <div
                  ref={stylePopoverRef}
                  className="fc-ann-popover fc-ann-style-popover"
                  role="dialog"
                  aria-label="Drawing Style Options"
                  style={{
                    position: 'fixed',
                    left: styleCoords ? `${styleCoords.left}px` : undefined,
                    top: styleCoords?.top !== 'auto' && styleCoords?.top != null ? `${styleCoords.top}px` : 'auto',
                    bottom: styleCoords?.bottom !== 'auto' && styleCoords?.bottom != null ? `${styleCoords.bottom}px` : 'auto',
                    maxHeight: styleCoords ? `${styleCoords.maxHeight}px` : '520px',
                    width: styleCoords ? `${styleCoords.width}px` : '300px',
                    zIndex: 1050,
                    visibility: styleCoords ? 'visible' : 'hidden',
                  }}
                >
                  <div className="fc-popover-header">
                    <span className="fc-popover-title">
                      {selectedAnnotation
                        ? `Style: #${selectedAnnotation.displayNumber} (${currentToolType})`
                        : `Drawing Style: ${currentToolType}`}
                    </span>
                    <button
                      type="button"
                      className="fc-popover-close-btn"
                      onClick={() => setIsStyleOpen(false)}
                      aria-label="Close style options"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="fc-popover-body">
                    {/* Style Presets */}
                    <div className="fc-style-pop-section">
                      <div className="fc-style-sec-label">
                        <span>Style Presets</span>
                      </div>
                      <div className="fc-style-presets-row">
                        {ANNOTATION_STYLE_PRESETS.map((pst) => (
                          <button
                            key={pst.id}
                            type="button"
                            className="fc-style-preset-btn"
                            onClick={() => {
                              if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                onStyleChange?.(pst.style, selectedAnnotation.id);
                              } else {
                                onStyleChange?.(pst.style, null);
                              }
                            }}
                            title={pst.title}
                          >
                            {pst.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="fc-popover-divider" />

                    {/* 1. Stroke Thickness */}
                    <div className="fc-style-pop-section">
                      <div className="fc-style-sec-label">
                        <span>Stroke Thickness</span>
                        <span className="fc-style-sec-val">
                          {selectedAnnotation?.style?.strokeWidth ?? activeDrawStyle.strokeWidth ?? 3}px
                        </span>
                      </div>
                      <div className="fc-style-presets-row">
                        {STROKE_WIDTH_OPTIONS.map((w) => {
                          const currentW = selectedAnnotation?.style?.strokeWidth ?? activeDrawStyle.strokeWidth ?? 3;
                          return (
                            <button
                              key={w}
                              type="button"
                              className={`fc-style-preset-btn${currentW === w ? ' fc-style-preset-active' : ''}`}
                              onClick={() => {
                                const changes = { strokeWidth: w };
                                if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                  onStyleChange?.(changes, selectedAnnotation.id);
                                } else {
                                  onStyleChange?.(changes, null);
                                }
                              }}
                            >
                              {w}px
                            </button>
                          );
                        })}
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="20"
                        step="1"
                        className="fc-style-range"
                        value={selectedAnnotation?.style?.strokeWidth ?? activeDrawStyle.strokeWidth ?? 3}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          const changes = { strokeWidth: val };
                          if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                            onStyleChange?.(changes, selectedAnnotation.id);
                          } else {
                            onStyleChange?.(changes, null);
                          }
                        }}
                      />
                    </div>

                    {/* 2. Stroke Opacity */}
                    <div className="fc-style-pop-section">
                      <div className="fc-style-sec-label">
                        <span>Stroke Opacity</span>
                        <span className="fc-style-sec-val">
                          {Math.round(
                            (selectedAnnotation?.style?.strokeOpacity ?? activeDrawStyle.strokeOpacity ?? 1) * 100
                          )}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        className="fc-style-range"
                        value={selectedAnnotation?.style?.strokeOpacity ?? activeDrawStyle.strokeOpacity ?? 1}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          const changes = { strokeOpacity: val };
                          if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                            onStyleChange?.(changes, selectedAnnotation.id);
                          } else {
                            onStyleChange?.(changes, null);
                          }
                        }}
                      />
                    </div>

                    {/* 3. Stroke Color */}
                    <div className="fc-style-pop-section">
                      <div className="fc-style-sec-label">
                        <span>Stroke Color</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {(selectedAnnotation?.style?.strokeColor || activeDrawStyle.strokeColor) ? (
                            <button
                              type="button"
                              className="fc-style-preset-btn"
                              style={{ fontSize: '10.5px', padding: '1px 5px' }}
                              onClick={() => {
                                const changes = { strokeColor: null };
                                if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                  onStyleChange?.(changes, selectedAnnotation.id);
                                } else {
                                  onStyleChange?.(changes, null);
                                }
                              }}
                              title="Reset stroke color to inherit primary annotation color"
                            >
                              Default
                            </button>
                          ) : null}
                          <input
                            type="color"
                            className="fc-style-color-pick-sm"
                            value={
                              selectedAnnotation?.style?.strokeColor ||
                              activeDrawStyle.strokeColor ||
                              effectiveColor
                            }
                            onChange={(e) => {
                              const changes = { strokeColor: e.target.value };
                              if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                onStyleChange?.(changes, selectedAnnotation.id);
                              } else {
                                onStyleChange?.(changes, null);
                              }
                            }}
                            title="Custom Stroke Color"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 4. Line Style (Solid, Dashed, Dotted) */}
                    {supportsLineStyle ? (
                      <div className="fc-style-pop-section">
                        <div className="fc-style-sec-label">
                          <span>Line Style</span>
                        </div>
                        <div className="fc-style-presets-row">
                          {LINE_STYLES.map((ls) => {
                            const currentLS = selectedAnnotation?.style?.lineStyle ?? activeDrawStyle.lineStyle ?? 'solid';
                            return (
                              <button
                                key={ls.id}
                                type="button"
                                className={`fc-style-preset-btn${currentLS === ls.id ? ' fc-style-preset-active' : ''}`}
                                onClick={() => {
                                  const changes = { lineStyle: ls.id };
                                  if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                    onStyleChange?.(changes, selectedAnnotation.id);
                                  } else {
                                    onStyleChange?.(changes, null);
                                  }
                                }}
                              >
                                {ls.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* 5. Fill Customization */}
                    {supportsFill ? (
                      <div className="fc-style-pop-section">
                        <div className="fc-style-sec-label">
                          <label className="fc-style-checkbox-label">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedAnnotation?.style?.fillEnabled ?? activeDrawStyle.fillEnabled)}
                              onChange={(e) => {
                                const changes = { fillEnabled: e.target.checked };
                                if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                  onStyleChange?.(changes, selectedAnnotation.id);
                                } else {
                                  onStyleChange?.(changes, null);
                                }
                              }}
                            />
                            <span>Fill Background</span>
                          </label>
                          {(selectedAnnotation?.style?.fillEnabled ?? activeDrawStyle.fillEnabled) ? (
                            <input
                              type="color"
                              className="fc-style-color-pick-sm"
                              value={
                                selectedAnnotation?.style?.fillColor ??
                                activeDrawStyle.fillColor ??
                                effectiveColor
                              }
                              onChange={(e) => {
                                const changes = { fillColor: e.target.value };
                                if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                  onStyleChange?.(changes, selectedAnnotation.id);
                                } else {
                                  onStyleChange?.(changes, null);
                                }
                              }}
                              title="Fill Color"
                            />
                          ) : null}
                        </div>
                        {(selectedAnnotation?.style?.fillEnabled ?? activeDrawStyle.fillEnabled) ? (
                          <div className="fc-style-sub-slider">
                            <div className="fc-style-sec-label">
                              <span>Fill Opacity</span>
                              <span className="fc-style-sec-val">
                                {Math.round(
                                  (selectedAnnotation?.style?.fillOpacity ?? activeDrawStyle.fillOpacity ?? 0.2) * 100
                                )}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0.05"
                              max="1.0"
                              step="0.05"
                              className="fc-style-range"
                              value={selectedAnnotation?.style?.fillOpacity ?? activeDrawStyle.fillOpacity ?? 0.2}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const changes = { fillOpacity: val };
                                if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                  onStyleChange?.(changes, selectedAnnotation.id);
                                } else {
                                  onStyleChange?.(changes, null);
                                }
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* 6. Arrowhead Options */}
                    {supportsArrowHead ? (
                      <div className="fc-style-pop-section">
                        <div className="fc-style-sec-label">
                          <span>Arrowhead Style</span>
                        </div>
                        <div className="fc-style-presets-row">
                          {ARROW_HEAD_STYLES.map((ah) => {
                            const currentAH = selectedAnnotation?.style?.arrowHead ?? activeDrawStyle.arrowHead ?? 'standard';
                            return (
                              <button
                                key={ah.id}
                                type="button"
                                className={`fc-style-preset-btn${currentAH === ah.id ? ' fc-style-preset-active' : ''}`}
                                onClick={() => {
                                  const changes = { arrowHead: ah.id };
                                  if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                    onStyleChange?.(changes, selectedAnnotation.id);
                                  } else {
                                    onStyleChange?.(changes, null);
                                  }
                                }}
                              >
                                {ah.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* 7. Typography Customization */}
                    {supportsTypography ? (
                      <div className="fc-style-pop-section">
                        <div className="fc-style-sec-label">
                          <span>Typography</span>
                          <span className="fc-style-sec-val">
                            {selectedAnnotation?.style?.fontSize ?? activeDrawStyle.fontSize ?? 14}px
                          </span>
                        </div>
                        <div className="fc-style-presets-row">
                          {FONT_SIZE_OPTIONS.map((sz) => {
                            const currentSz = selectedAnnotation?.style?.fontSize ?? activeDrawStyle.fontSize ?? 14;
                            return (
                              <button
                                key={sz}
                                type="button"
                                className={`fc-style-preset-btn${currentSz === sz ? ' fc-style-preset-active' : ''}`}
                                onClick={() => {
                                  const changes = { fontSize: sz };
                                  if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                    onStyleChange?.(changes, selectedAnnotation.id);
                                  } else {
                                    onStyleChange?.(changes, null);
                                  }
                                }}
                              >
                                {sz}px
                              </button>
                            );
                          })}
                        </div>
                        <div className="fc-style-typography-row" style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <button
                            type="button"
                            className={`fc-style-preset-btn${(selectedAnnotation?.style?.fontWeight ?? activeDrawStyle.fontWeight) === 'bold' ? ' fc-style-preset-active' : ''}`}
                            style={{ fontWeight: 'bold', minWidth: '30px' }}
                            onClick={() => {
                              const isBold = (selectedAnnotation?.style?.fontWeight ?? activeDrawStyle.fontWeight) === 'bold';
                              const changes = { fontWeight: isBold ? 'normal' : 'bold' };
                              if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                onStyleChange?.(changes, selectedAnnotation.id);
                              } else {
                                onStyleChange?.(changes, null);
                              }
                            }}
                            title="Bold text"
                          >
                            B
                          </button>
                          <button
                            type="button"
                            className={`fc-style-preset-btn${(selectedAnnotation?.style?.fontStyle ?? activeDrawStyle.fontStyle) === 'italic' ? ' fc-style-preset-active' : ''}`}
                            style={{ fontStyle: 'italic', minWidth: '30px' }}
                            onClick={() => {
                              const isItalic = (selectedAnnotation?.style?.fontStyle ?? activeDrawStyle.fontStyle) === 'italic';
                              const changes = { fontStyle: isItalic ? 'normal' : 'italic' };
                              if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                onStyleChange?.(changes, selectedAnnotation.id);
                              } else {
                                onStyleChange?.(changes, null);
                              }
                            }}
                            title="Italic text"
                          >
                            I
                          </button>
                          <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
                            {FONT_FAMILY_OPTIONS.map((fam) => {
                              const currentFam = selectedAnnotation?.style?.fontFamily ?? activeDrawStyle.fontFamily ?? 'sans-serif';
                              return (
                                <button
                                  key={fam.id}
                                  type="button"
                                  className={`fc-style-preset-btn${currentFam === fam.id ? ' fc-style-preset-active' : ''}`}
                                  style={{ fontFamily: fam.font, flex: 1, fontSize: '11px', padding: '3px 4px' }}
                                  onClick={() => {
                                    const changes = { fontFamily: fam.id };
                                    if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                      onStyleChange?.(changes, selectedAnnotation.id);
                                    } else {
                                      onStyleChange?.(changes, null);
                                    }
                                  }}
                                  title={`${fam.label} font family`}
                                >
                                  {fam.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* 8. Visual Marker Selection */}
                    <div className="fc-style-pop-section">
                      <div className="fc-style-sec-label">
                        <span>Visual Marker Tag</span>
                        {(selectedAnnotation?.style?.marker ?? activeDrawStyle.marker) ? (
                          <input
                            type="color"
                            className="fc-style-color-pick-sm"
                            value={selectedAnnotation?.style?.markerColor ?? activeDrawStyle.markerColor ?? '#f59e0b'}
                            onChange={(e) => {
                              const changes = { markerColor: e.target.value };
                              if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                onStyleChange?.(changes, selectedAnnotation.id);
                              } else {
                                onStyleChange?.(changes, null);
                              }
                            }}
                            title="Marker Color"
                          />
                        ) : null}
                      </div>
                      <div className="fc-style-presets-row">
                        <button
                          type="button"
                          className={`fc-style-preset-btn${!(selectedAnnotation?.style?.marker ?? activeDrawStyle.marker) ? ' fc-style-preset-active' : ''}`}
                          onClick={() => {
                            const changes = { marker: null };
                            if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                              onStyleChange?.(changes, selectedAnnotation.id);
                            } else {
                              onStyleChange?.(changes, null);
                            }
                          }}
                        >
                          None
                        </button>
                        {ANNOTATION_MARKERS.map((m) => {
                          const currentM = selectedAnnotation?.style?.marker ?? activeDrawStyle.marker;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              className={`fc-style-preset-btn${currentM === m.id ? ' fc-style-preset-active' : ''}`}
                              onClick={() => {
                                const changes = { marker: m.id };
                                if (selectedAnnotation && canEditSelected && !isSelectedResolved) {
                                  onStyleChange?.(changes, selectedAnnotation.id);
                                } else {
                                  onStyleChange?.(changes, null);
                                }
                              }}
                              title={m.label}
                            >
                              {m.icon} {m.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>,
                document.body
              )
            : null}
        </div>
      </div>

      <span className="fc-ann-sep" aria-hidden="true" />

      {/* ===================================================================
          GROUP D: Organization (Layers, Properties, Priority, Assignee)
          =================================================================== */}
      <div className="fc-ann-group fc-ann-group-org" role="group" aria-label="Annotation organization">
        {/* Layer Selector Dropdown */}
        <div className="fc-ann-popover-anchor">
          {(() => {
            const effectiveLayerId = selectedAnnotation ? (selectedAnnotation.layerId || 'default') : activeLayerId;
            const currentLayer = layers.find((l) => l.id === effectiveLayerId) || layers[0] || { name: 'Default Layer', color: '#6366f1' };
            const isEffectiveLayerLocked = lockedLayerIds.has(effectiveLayerId);

            return (
              <>
                <button
                  ref={layerBtnRef}
                  type="button"
                  className={`fc-btn fc-btn-secondary fc-btn-sm fc-ann-layer-btn${isLayerMenuOpen ? ' fc-btn-active' : ''}`}
                  onClick={handleToggleLayerMenu}
                  disabled={disabled}
                  title={`Active annotation layer: ${currentLayer.name}${isEffectiveLayerLocked ? ' (Locked)' : ''}`}
                  aria-label="Annotation layer selection"
                  aria-expanded={isLayerMenuOpen}
                >
                  <span className="fc-ann-layer-btn-dot" style={{ backgroundColor: currentLayer.color || '#6366f1' }} />
                  <span className="fc-ann-layer-btn-text">
                    {currentLayer.name}
                    {isEffectiveLayerLocked ? ' 🔒' : ''}
                  </span>
                  <span className="fc-ann-caret">▾</span>
                </button>

                {isLayerMenuOpen && typeof document !== 'undefined' && document.body
                  ? createPortal(
                      <div
                        ref={layerPopoverRef}
                        className="fc-ann-popover fc-ann-layer-popover"
                        role="menu"
                        style={{
                          position: 'fixed',
                          left: layerCoords ? `${layerCoords.left}px` : undefined,
                          top: layerCoords?.top !== 'auto' && layerCoords?.top != null ? `${layerCoords.top}px` : 'auto',
                          bottom: layerCoords?.bottom !== 'auto' && layerCoords?.bottom != null ? `${layerCoords.bottom}px` : 'auto',
                          maxHeight: layerCoords ? `${layerCoords.maxHeight}px` : '420px',
                          width: layerCoords ? `${layerCoords.width}px` : '220px',
                          zIndex: 1050,
                          visibility: layerCoords ? 'visible' : 'hidden',
                          overflowY: 'auto',
                        }}
                      >
                        <div className="fc-layer-pop-section-title">
                          {isMultiSelected
                            ? `Move ${selectedAnnotationIds.length} annotations to layer:`
                            : selectedAnnotation
                              ? `Move #${selectedAnnotation.displayNumber} to layer:`
                              : 'Drawing Layer:'}
                        </div>
                        {layers.map((l) => {
                          const isSelectedLayer = effectiveLayerId === l.id;
                          const isTargetLocked = lockedLayerIds.has(l.id);
                          return (
                            <button
                              key={l.id}
                              type="button"
                              className={`fc-layer-pop-item${isSelectedLayer ? ' fc-layer-pop-item-active' : ''}`}
                              disabled={isTargetLocked}
                              title={isTargetLocked ? 'Layer is locked' : undefined}
                              onClick={() => {
                                if (isMultiSelected) {
                                  onBulkMoveLayer?.(selectedAnnotationIds, l.id);
                                } else if (selectedAnnotation && canEditSelected && !isSelectedResolved && !isSelectedLayerLocked) {
                                  onMoveAnnotationLayer?.(selectedAnnotation.id, l.id);
                                } else {
                                  onActiveLayerChange?.(l.id);
                                }
                                setIsLayerMenuOpen(false);
                              }}
                            >
                              <span className="fc-layer-pop-dot" style={{ backgroundColor: l.color || '#6366f1' }} />
                              <span className="fc-layer-pop-name">
                                {l.name}
                                {isTargetLocked ? ' 🔒' : ''}
                              </span>
                              {isSelectedLayer ? <span className="fc-layer-pop-check">✓</span> : null}
                            </button>
                          );
                        })}

                        <div className="fc-layer-pop-divider" />
                        <button
                          type="button"
                          className="fc-layer-pop-manage-btn"
                          onClick={() => {
                            setIsLayerMenuOpen(false);
                            onOpenLayerManager?.();
                          }}
                        >
                          ⚙️ Manage Layers…
                        </button>
                      </div>,
                      document.body
                    )
                  : null}
              </>
            );
          })()}
        </div>

        {/* Custom Properties modal trigger (when annotation is selected) */}
        {selectedAnnotation ? (
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-sm fc-ann-props-btn"
            onClick={() => onOpenPropertiesModal?.(selectedAnnotation)}
            title="View and edit structured metadata properties"
          >
            <span>📋 Props</span>
            {Array.isArray(selectedAnnotation.customProperties) && selectedAnnotation.customProperties.length > 0 ? (
              <span className="fc-ann-props-badge">
                {selectedAnnotation.customProperties.length}
              </span>
            ) : null}
          </button>
        ) : null}

        {/* Priority Selector (when annotation is selected) */}
        {selectedAnnotation ? (
          <div className="fc-ann-popover-anchor" ref={priorityBtnRef}>
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm fc-ann-tb-priority-btn"
              onClick={() => canEditSelected && !isSelectedResolved && !isSelectedLayerLocked && setIsPriorityOpen(!isPriorityOpen)}
              disabled={disabled || !canEditSelected || isSelectedResolved || isSelectedLayerLocked}
              title={
                !canEditSelected
                  ? 'Only creator or Admin can change priority'
                  : isSelectedLayerLocked
                    ? 'Layer is locked'
                    : `Priority: ${PRIORITY_CONFIG[selectedAnnotation.priority || 'medium']?.label} (click to change)`
              }
              style={{
                color: PRIORITY_CONFIG[selectedAnnotation.priority || 'medium']?.color,
                borderColor: isPriorityOpen ? PRIORITY_CONFIG[selectedAnnotation.priority || 'medium']?.color : undefined,
              }}
            >
              <span className="fc-ann-tb-icon">{PRIORITY_CONFIG[selectedAnnotation.priority || 'medium']?.icon}</span>
              <span>{PRIORITY_CONFIG[selectedAnnotation.priority || 'medium']?.label}</span>
              {canEditSelected && !isSelectedResolved && !isSelectedLayerLocked ? <span className="fc-ann-dropdown-arrow">▾</span> : null}
            </button>

            {isPriorityOpen && canEditSelected && !isSelectedResolved && !isSelectedLayerLocked ? (
              <div className="fc-tb-dropdown-menu fc-tb-priority-dropdown">
                <div className="fc-tb-dropdown-title">Priority</div>
                {ANNOTATION_PRIORITIES.map((pId) => {
                  const cfg = PRIORITY_CONFIG[pId];
                  const isCurrent = (selectedAnnotation.priority || 'medium') === pId;
                  return (
                    <button
                      key={pId}
                      type="button"
                      className={`fc-tb-dropdown-item${isCurrent ? ' fc-tb-dropdown-item-active' : ''}`}
                      onClick={() => {
                        onUpdateAnnotationPriority?.(selectedAnnotation.id, pId);
                        setIsPriorityOpen(false);
                      }}
                    >
                      <span style={{ marginRight: '6px' }}>{cfg.icon}</span>
                      <span>{cfg.label}</span>
                      {isCurrent ? <span className="fc-tb-dropdown-check">✓</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Assignee Selector (when annotation is selected) */}
        {selectedAnnotation ? (
          <div className="fc-ann-popover-anchor" ref={assigneeBtnRef}>
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm fc-ann-tb-assignee-btn"
              onClick={() => canEditSelected && !isSelectedResolved && !isSelectedLayerLocked && setIsAssigneeOpen(!isAssigneeOpen)}
              disabled={disabled || !canEditSelected || isSelectedResolved || isSelectedLayerLocked}
              title={
                !canEditSelected
                  ? 'Only creator or Admin can assign reviewer'
                  : isSelectedLayerLocked
                    ? 'Layer is locked'
                    : selectedAnnotation.assignedTo
                      ? `Assigned to ${selectedAssigneeName} (click to change)`
                      : 'Unassigned (click to assign)'
              }
            >
              {selectedAnnotation.assignedTo ? (
                <>
                  <span
                    className="fc-ann-tb-avatar"
                    style={{ backgroundColor: getReviewerColor(selectedAnnotation.assignedTo || selectedAssigneeName) }}
                  >
                    {getInitials(selectedAssigneeName)}
                  </span>
                  <span className="fc-ann-tb-assignee-text">{selectedAssigneeName}</span>
                </>
              ) : (
                <span className="fc-ann-tb-unassigned-text">👤 Unassigned</span>
              )}
              {canEditSelected && !isSelectedResolved && !isSelectedLayerLocked ? <span className="fc-ann-dropdown-arrow">▾</span> : null}
            </button>

            {isAssigneeOpen && canEditSelected && !isSelectedResolved && !isSelectedLayerLocked ? (
              <div className="fc-tb-dropdown-menu fc-tb-assignee-dropdown">
                <div className="fc-tb-dropdown-title">Assign Reviewer</div>
                <button
                  type="button"
                  className={`fc-tb-dropdown-item${!selectedAnnotation.assignedTo ? ' fc-tb-dropdown-item-active' : ''}`}
                  onClick={() => {
                    onUpdateAnnotationAssignment?.(selectedAnnotation.id, null);
                    setIsAssigneeOpen(false);
                  }}
                >
                  <span className="fc-tb-unassigned-dot" />
                  <span>Unassigned</span>
                  {!selectedAnnotation.assignedTo ? <span className="fc-tb-dropdown-check">✓</span> : null}
                </button>
                {tbEligibleReviewers.map((rev) => {
                  const isCurrent = selectedAnnotation.assignedTo === rev.id;
                  return (
                    <button
                      key={rev.id}
                      type="button"
                      className={`fc-tb-dropdown-item${isCurrent ? ' fc-tb-dropdown-item-active' : ''}`}
                      onClick={() => {
                        onUpdateAnnotationAssignment?.(selectedAnnotation.id, rev.id);
                        setIsAssigneeOpen(false);
                      }}
                    >
                      <span
                        className="fc-ann-tb-avatar-sm"
                        style={{ backgroundColor: getReviewerColor(rev.id || rev.displayName) }}
                      >
                        {getInitials(rev.displayName)}
                      </span>
                      <span className="fc-tb-dropdown-item-name">{rev.displayName}</span>
                      {isCurrent ? <span className="fc-tb-dropdown-check">✓</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      </div>

      <div className="fc-tb-row-sep" aria-hidden="true" />

      {/* ===================================================================
          ROW 3: EDITING, ZOOM & ACTIONS (Undo, Redo, Delete, Zoom, Utilities, Status)
          =================================================================== */}
      <div className="fc-tb-row fc-tb-row-actions">
        {/* GROUP E: History & Delete (Undo, Redo, Delete) */}
        <div className="fc-ann-group fc-ann-group-history" role="group" aria-label="History and actions">
        <button
          type="button"
          className="fc-btn fc-btn-secondary fc-btn-sm fc-ann-action-btn"
          onClick={onUndo}
          disabled={disabled || isSyncing || !canUndo}
          title="Undo last action (Ctrl+Z)"
          aria-label="Undo last action"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="4 7 1 4 4 1" />
            <path d="M1 4h9a4 4 0 0 1 4 4v2" />
          </svg>
          <span className="fc-ann-btn-label">Undo</span>
        </button>

        <button
          type="button"
          className="fc-btn fc-btn-secondary fc-btn-sm fc-ann-action-btn"
          onClick={onRedo}
          disabled={disabled || isSyncing || !canRedo}
          title="Redo last undone action (Ctrl+Y)"
          aria-label="Redo last undone action"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="12 7 15 4 12 1" />
            <path d="M15 4H6a4 4 0 0 0-4 4v2" />
          </svg>
          <span className="fc-ann-btn-label">Redo</span>
        </button>

        {(selectedAnnotation || isMultiSelected) ? (
          <button
            type="button"
            className="fc-btn fc-btn-danger-outline fc-btn-sm fc-ann-action-btn"
            onClick={() => {
              if (isMultiSelected) {
                onBulkDelete?.(selectedAnnotationIds);
              } else {
                onDeleteSelected?.();
              }
            }}
            disabled={deleteLocked}
            title={
              isSelectedLayerLocked
                ? 'Layer is locked. Deletion is disabled.'
                : isMultiSelected
                  ? `Delete ${selectedAnnotationIds.length} selected annotations (Delete / Backspace)`
                  : selectedAnnotation && !canEditSelected
                    ? 'Only the creator can delete this annotation'
                    : 'Delete selected annotation (Delete / Backspace)'
            }
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="2 4 14 4" />
              <path d="M5 4V2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5V4" />
              <path d="M13 4v9.5A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5V4" />
            </svg>
            <span className="fc-ann-btn-label">
              {isMultiSelected
                ? `Delete (${selectedAnnotationIds.length})`
                : selectedAnnotation
                  ? `Delete #${selectedAnnotation.displayNumber}`
                  : 'Delete'}
            </span>
          </button>
        ) : null}
      </div>

      <span className="fc-ann-sep" aria-hidden="true" />

      {/* ===================================================================
          AUXILIARY CONTROLS: Zoom, Templates, Shortcuts, Focus Mode
          =================================================================== */}
      <div className="fc-ann-group fc-ann-group-aux" role="group" aria-label="Canvas zoom and view controls">
        {zoomControls}

        {onToggleFocusMode && !isFocusMode ? (
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-xs fc-ann-focus-btn"
            onClick={onToggleFocusMode}
            title={`Full-Screen Focus Mode (${shortcuts.view_focus_mode || 'F'})`}
            aria-label="Full-Screen Focus Mode"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 6V2h4m8 4V2h-4M2 10v4h4m8-4v4h-4" />
            </svg>
            <span className="fc-ann-btn-label">Focus</span>
          </button>
        ) : null}

        {onOpenTemplates ? (
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-xs fc-ann-templates-btn fc-ann-btn-responsive-hide"
            onClick={(e) => onOpenTemplates(e.currentTarget)}
            title="Annotation Templates (Reusable styles & properties)"
            aria-label="Annotation Templates"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
            <span className="fc-ann-btn-label">Templates</span>
          </button>
        ) : null}

        {onOpenShortcuts ? (
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-xs fc-ann-shortcuts-btn fc-ann-btn-responsive-hide"
            onClick={(e) => onOpenShortcuts(e.currentTarget)}
            title="Keyboard Shortcuts & Keybindings"
            aria-label="Keyboard Shortcuts"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M6 16h12" />
            </svg>
            <span className="fc-ann-btn-label">Shortcuts</span>
          </button>
        ) : null}
      </div>

      {/* ===================================================================
          STATUS SECTION: Autosave indicator, Selected annotation badge / Hint
          =================================================================== */}
      <div className="fc-ann-status">
        {/* Autosave Indicator */}
        <div className="fc-ann-autosave-indicator">
          {autosaveStatus === 'saving' || isSyncing ? (
            <span className="fc-ann-autosave-badge is-saving" aria-live="polite" title="Saving changes to cloud">
              <span className="fc-ann-spinner" aria-hidden="true" />
              <span>Saving…</span>
            </span>
          ) : autosaveStatus === 'failed' ? (
            <span className="fc-ann-autosave-badge is-failed" role="alert" title="Save failed due to network error">
              <span aria-hidden="true">⚠️</span>
              <span>Save Failed</span>
              {onRetryAutosave ? (
                <button
                  type="button"
                  className="fc-ann-retry-btn"
                  onClick={onRetryAutosave}
                  title="Retry pending saves"
                >
                  Retry
                </button>
              ) : null}
            </span>
          ) : (
            <span className="fc-ann-autosave-badge is-saved" title="All annotation edits saved">
              <span aria-hidden="true">✓</span>
              <span>Saved</span>
            </span>
          )}
        </div>

        {hasDraft ? (
          <span className="fc-ann-hint">Add a comment in the sidebar to save draft circle</span>
        ) : isMultiSelected ? (
          <span className="fc-ann-selected-pill">
            <span className="fc-ann-selected-dot" aria-hidden="true" />
            <span>Selected: {selectedAnnotationIds.length} items</span>
          </span>
        ) : selectedAnnotation ? (
          <span
            className="fc-ann-selected-pill"
            style={{ '--fc-selected-color': selectedAnnotation.color }}
          >
            <span className="fc-ann-selected-dot" aria-hidden="true" />
            <span>Selected: #{selectedAnnotation.displayNumber}</span>
            {isSelectedLayerLocked ? (
              <span className="fc-ann-readonly-tag" title="Layer is locked">🔒 Locked</span>
            ) : !canEditSelected ? (
              <span className="fc-ann-readonly-tag">Read-only</span>
            ) : isSelectedResolved ? (
              <span className="fc-ann-readonly-tag">Resolved</span>
            ) : null}
          </span>
        ) : null}
        </div>
      </div>
    </div>
  );
}
