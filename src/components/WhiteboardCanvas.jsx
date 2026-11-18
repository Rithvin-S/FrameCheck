import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SHAPE_COLOR,
  DEFAULT_STICKY_COLOR,
  DEFAULT_STICKY_HEIGHT,
  DEFAULT_STICKY_WIDTH,
  MIN_SHAPE_SIZE,
  MIN_STICKY_HEIGHT,
  MIN_STICKY_WIDTH,
  WHITEBOARD_TOOL_MODES,
  calculateWhiteboardArrowhead,
  getWhiteboardElementsBoundingBox,
  pointsToSmoothSvgPath,
  screenToWorld,
} from '../services/whiteboardState.js';
import './WhiteboardCanvas.css';

/**
 * Shared infinite-feeling collaborative canvas with pan, zoom, element manipulation,
 * sticky notes, text, shapes, arrows, freehand drawings, and live cursors.
 */
export function WhiteboardCanvas({
  elements = [],
  activeTool = WHITEBOARD_TOOL_MODES.SELECT,
  onSelectTool,
  activeColor = DEFAULT_STICKY_COLOR,
  selectedElementId = null,
  onSelectElement,
  onCreateElement,
  onUpdateElement,
  onDeleteElement,
  currentUserId,
  readOnly = false,
  liveCursors = [],
  onCursorMove,
  onCursorLeave,
  zoom,
  setZoom,
  pan,
  setPan,
}) {
  const containerRef = useRef(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [activeGesture, setActiveGesture] = useState(null); // { type: 'pan' | 'draw' | 'move' | 'resize', ... }
  const [editingTextElementId, setEditingTextElementId] = useState(null);
  const lastCursorSentRef = useRef(0);

  // Keyboard listener for Spacebar panning shortcut
  useEffect(() => {
    const handleKeyDown = (e) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const selectedElement = useMemo(
    () => elements.find((el) => el.id === selectedElementId) || null,
    [elements, selectedElementId]
  );

  const canEditSelected = Boolean(
    !readOnly &&
      currentUserId &&
      selectedElement &&
      (selectedElement.createdBy === currentUserId || true) // Reviewers and Admins can collaborate
  );

  // Wheel zoom handler centered around mouse position
  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      // Trackpad pinch or mouse wheel
      const zoomFactor = e.ctrlKey ? 0.05 : 0.0015;
      const delta = -e.deltaY * zoomFactor;
      const scaleMultiplier = Math.exp(delta);

      setZoom((prevZoom) => {
        const nextZoom = Math.min(Math.max(prevZoom * scaleMultiplier, 0.15), 3.0);
        if (nextZoom === prevZoom) return prevZoom;

        // Keep point under mouse fixed in world coordinates
        const worldX = (screenX - pan.x) / prevZoom;
        const worldY = (screenY - pan.y) / prevZoom;

        setPan({
          x: screenX - worldX * nextZoom,
          y: screenY - worldY * nextZoom,
        });

        return nextZoom;
      });
    },
    [pan.x, pan.y, setPan, setZoom]
  );

  const getWorldCoordinates = useCallback(
    (e) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      return screenToWorld({ x: screenX, y: screenY }, { zoom, pan });
    },
    [pan, zoom]
  );

  // Pointer down on canvas background or element
  const handlePointerDown = (e) => {
    // If clicking inside an active textarea, don't initiate canvas gestures
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
      return;
    }

    const isPanMode =
      activeTool === WHITEBOARD_TOOL_MODES.PAN ||
      isSpacePressed ||
      e.button === 1 || // Middle mouse button
      readOnly;

    if (isPanMode) {
      setActiveGesture({
        type: 'pan',
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      });
      containerRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    if (readOnly) return;

    const world = getWorldCoordinates(e);

    // Creating Sticky Note
    if (activeTool === WHITEBOARD_TOOL_MODES.STICKY) {
      onCreateElement?.({
        type: 'sticky',
        x: Math.round(world.x - DEFAULT_STICKY_WIDTH / 2),
        y: Math.round(world.y - DEFAULT_STICKY_HEIGHT / 2),
        width: DEFAULT_STICKY_WIDTH,
        height: DEFAULT_STICKY_HEIGHT,
        color: activeColor || DEFAULT_STICKY_COLOR,
        text: '',
        geometry: {},
      });
      onSelectTool?.(WHITEBOARD_TOOL_MODES.SELECT);
      return;
    }

    // Creating Text Element
    if (activeTool === WHITEBOARD_TOOL_MODES.TEXT) {
      onCreateElement?.({
        type: 'text',
        x: Math.round(world.x),
        y: Math.round(world.y),
        width: 220,
        height: 48,
        color: activeColor || '#0f172a',
        text: 'Type text here…',
        geometry: {},
      });
      onSelectTool?.(WHITEBOARD_TOOL_MODES.SELECT);
      return;
    }

    // Creating Shapes or Connectors (Rectangle, Circle, Arrow, Pencil)
    if (
      activeTool === WHITEBOARD_TOOL_MODES.RECTANGLE ||
      activeTool === WHITEBOARD_TOOL_MODES.CIRCLE ||
      activeTool === WHITEBOARD_TOOL_MODES.ARROW ||
      activeTool === WHITEBOARD_TOOL_MODES.PENCIL
    ) {
      setActiveGesture({
        type: 'draw',
        tool: activeTool,
        startX: world.x,
        startY: world.y,
        currentX: world.x,
        currentY: world.y,
        points: [{ x: world.x, y: world.y }],
        color: activeColor || DEFAULT_SHAPE_COLOR,
      });
      containerRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // If clicked on canvas background in Select mode, deselect
    if (
      e.target === containerRef.current ||
      e.target?.classList?.contains('fc-whiteboard-canvas-viewport') ||
      e.target?.classList?.contains('fc-wb-svg-layer') ||
      e.target?.classList?.contains('fc-wb-grid-svg')
    ) {
      onSelectElement?.(null);
      setEditingTextElementId(null);
    }
  };

  // Pointer move
  const handlePointerMove = (e) => {
    // Broadcast live cursor in world coordinates (throttled to ~45ms)
    const now = Date.now();
    if (now - lastCursorSentRef.current > 45 && onCursorMove) {
      lastCursorSentRef.current = now;
      const world = getWorldCoordinates(e);
      onCursorMove({ x: world.x, y: world.y });
    }

    if (!activeGesture) return;

    if (activeGesture.type === 'pan') {
      const dx = e.clientX - activeGesture.startScreenX;
      const dy = e.clientY - activeGesture.startScreenY;
      setPan({
        x: activeGesture.startPanX + dx,
        y: activeGesture.startPanY + dy,
      });
      return;
    }

    const world = getWorldCoordinates(e);

    if (activeGesture.type === 'draw') {
      if (activeGesture.tool === WHITEBOARD_TOOL_MODES.PENCIL) {
        setActiveGesture((prev) => ({
          ...prev,
          points: [...prev.points, { x: world.x, y: world.y }],
          currentX: world.x,
          currentY: world.y,
        }));
      } else {
        setActiveGesture((prev) => ({
          ...prev,
          currentX: world.x,
          currentY: world.y,
        }));
      }
      return;
    }

    if (activeGesture.type === 'move') {
      const dx = world.x - activeGesture.startWorldX;
      const dy = world.y - activeGesture.startWorldY;
      setActiveGesture((prev) => ({
        ...prev,
        currentX: activeGesture.origX + dx,
        currentY: activeGesture.origY + dy,
      }));
      return;
    }

    if (activeGesture.type === 'resize') {
      const dx = world.x - activeGesture.startWorldX;
      const dy = world.y - activeGesture.startWorldY;
      setActiveGesture((prev) => ({
        ...prev,
        currentW: Math.max(activeGesture.origW + dx, MIN_STICKY_WIDTH),
        currentH: Math.max(activeGesture.origH + dy, MIN_STICKY_HEIGHT),
      }));
      return;
    }

    if (activeGesture.type === 'arrow_endpoint') {
      setActiveGesture((prev) => ({
        ...prev,
        endpointX: world.x,
        endpointY: world.y,
      }));
    }
  };

  // Pointer up
  const handlePointerUp = (e) => {
    if (!activeGesture) return;

    if (activeGesture.type === 'draw') {
      const { tool, startX, startY, currentX, currentY, points, color } = activeGesture;

      if (tool === WHITEBOARD_TOOL_MODES.RECTANGLE) {
        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const width = Math.max(Math.abs(currentX - startX), 0);
        const height = Math.max(Math.abs(currentY - startY), 0);
        const finalW = width >= MIN_SHAPE_SIZE ? width : 120;
        const finalH = height >= MIN_SHAPE_SIZE ? height : 80;
        onCreateElement?.({
          type: 'rectangle',
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(finalW),
          height: Math.round(finalH),
          color,
          text: '',
          geometry: {},
        });
      } else if (tool === WHITEBOARD_TOOL_MODES.CIRCLE) {
        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const size = Math.max(Math.abs(currentX - startX), Math.abs(currentY - startY), 0);
        const finalSize = size >= MIN_SHAPE_SIZE ? size : 100;
        onCreateElement?.({
          type: 'circle',
          x: Math.round(x + finalSize / 2),
          y: Math.round(y + finalSize / 2),
          width: Math.round(finalSize),
          height: Math.round(finalSize),
          color,
          text: '',
          geometry: { r: Math.round(finalSize / 2) },
        });
      } else if (tool === WHITEBOARD_TOOL_MODES.ARROW) {
        const dist = Math.hypot(currentX - startX, currentY - startY);
        const x2 = dist >= 15 ? currentX : startX + 120;
        const y2 = dist >= 15 ? currentY : startY;
        onCreateElement?.({
          type: 'arrow',
          x: Math.round(startX),
          y: Math.round(startY),
          width: Math.round(x2 - startX),
          height: Math.round(y2 - startY),
          color,
          text: '',
          geometry: {
            x1: Math.round(startX),
            y1: Math.round(startY),
            x2: Math.round(x2),
            y2: Math.round(y2),
          },
        });
      } else if (tool === WHITEBOARD_TOOL_MODES.PENCIL) {
        if (points && points.length >= 1) {
          const finalPoints =
            points.length === 1
              ? [points[0], { x: points[0].x + 1, y: points[0].y + 1 }]
              : points;
          onCreateElement?.({
            type: 'pencil',
            x: Math.round(startX),
            y: Math.round(startY),
            width: null,
            height: null,
            color,
            text: '',
            geometry: { points: finalPoints },
          });
        }
      }

      onSelectTool?.(WHITEBOARD_TOOL_MODES.SELECT);
    } else if (activeGesture.type === 'move') {
      if (
        activeGesture.currentX !== undefined &&
        (activeGesture.currentX !== activeGesture.origX || activeGesture.currentY !== activeGesture.origY)
      ) {
        const nextX = Math.round(activeGesture.currentX);
        const nextY = Math.round(activeGesture.currentY);
        const dx = nextX - activeGesture.origX;
        const dy = nextY - activeGesture.origY;
        const element = elements.find((el) => el.id === activeGesture.elementId);

        const updates = { x: nextX, y: nextY };
        if (element?.type === 'pencil' && Array.isArray(element.geometry?.points)) {
          updates.geometry = {
            ...element.geometry,
            points: element.geometry.points.map((pt) => ({
              x: Math.round(pt.x + dx),
              y: Math.round(pt.y + dy),
            })),
          };
        } else if (element?.type === 'arrow' && element.geometry) {
          updates.geometry = {
            ...element.geometry,
            x1: Math.round((element.geometry.x1 ?? element.x) + dx),
            y1: Math.round((element.geometry.y1 ?? element.y) + dy),
            x2: Math.round((element.geometry.x2 ?? element.x + (element.width || 100)) + dx),
            y2: Math.round((element.geometry.y2 ?? element.y + (element.height || 0)) + dy),
          };
        }

        onUpdateElement?.(activeGesture.elementId, updates);
      }
    } else if (activeGesture.type === 'resize') {
      if (
        activeGesture.currentW !== undefined &&
        (activeGesture.currentW !== activeGesture.origW || activeGesture.currentH !== activeGesture.origH)
      ) {
        const element = elements.find((el) => el.id === activeGesture.elementId);
        const updates = {
          width: Math.round(activeGesture.currentW),
          height: Math.round(activeGesture.currentH),
        };
        if (element?.type === 'circle') {
          updates.geometry = {
            ...element.geometry,
            r: Math.round(activeGesture.currentW / 2),
          };
        }
        onUpdateElement?.(activeGesture.elementId, updates);
      }
    } else if (activeGesture.type === 'arrow_endpoint') {
      const { elementId, which, origGeometry, endpointX, endpointY } = activeGesture;
      if (endpointX !== undefined && endpointY !== undefined) {
        const nextGeom = {
          ...origGeometry,
          [which === 'start' ? 'x1' : 'x2']: Math.round(endpointX),
          [which === 'start' ? 'y1' : 'y2']: Math.round(endpointY),
        };
        onUpdateElement?.(elementId, { geometry: nextGeom });
      }
    }

    try {
      containerRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    setActiveGesture(null);
  };

  const handlePointerLeave = () => {
    onCursorLeave?.();
  };

  // Start moving an element
  const handleStartMoveElement = (e, element) => {
    if (readOnly || activeTool === WHITEBOARD_TOOL_MODES.PAN || isSpacePressed) {
      return;
    }
    e.stopPropagation();
    onSelectElement?.(element.id);

    const world = getWorldCoordinates(e);
    setActiveGesture({
      type: 'move',
      elementId: element.id,
      startWorldX: world.x,
      startWorldY: world.y,
      origX: element.x,
      origY: element.y,
      currentX: element.x,
      currentY: element.y,
    });
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  // Start resizing an element
  const handleStartResize = (e, element) => {
    e.stopPropagation();
    const world = getWorldCoordinates(e);
    setActiveGesture({
      type: 'resize',
      elementId: element.id,
      startWorldX: world.x,
      startWorldY: world.y,
      origW: element.width || DEFAULT_STICKY_WIDTH,
      origH: element.height || DEFAULT_STICKY_HEIGHT,
      currentW: element.width || DEFAULT_STICKY_WIDTH,
      currentH: element.height || DEFAULT_STICKY_HEIGHT,
    });
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  // Start dragging arrow endpoint
  const handleStartArrowEndpointDrag = (e, element, which) => {
    e.stopPropagation();
    const world = getWorldCoordinates(e);
    setActiveGesture({
      type: 'arrow_endpoint',
      elementId: element.id,
      which,
      origGeometry: element.geometry || {},
      endpointX: which === 'start' ? (element.geometry?.x1 ?? element.x) : (element.geometry?.x2 ?? element.x + 100),
      endpointY: which === 'start' ? (element.geometry?.y1 ?? element.y) : (element.geometry?.y2 ?? element.y),
    });
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  // Cursor style determination
  const cursorStyle = useMemo(() => {
    if (activeGesture?.type === 'pan') return 'grabbing';
    if (isSpacePressed || activeTool === WHITEBOARD_TOOL_MODES.PAN) return 'grab';
    if (activeTool === WHITEBOARD_TOOL_MODES.STICKY || activeTool === WHITEBOARD_TOOL_MODES.TEXT) return 'crosshair';
    if (
      activeTool === WHITEBOARD_TOOL_MODES.RECTANGLE ||
      activeTool === WHITEBOARD_TOOL_MODES.CIRCLE ||
      activeTool === WHITEBOARD_TOOL_MODES.ARROW ||
      activeTool === WHITEBOARD_TOOL_MODES.PENCIL
    ) {
      return 'crosshair';
    }
    return 'default';
  }, [activeGesture?.type, activeTool, isSpacePressed]);

  return (
    <div
      ref={containerRef}
      className="fc-whiteboard-canvas-viewport"
      style={{ cursor: cursorStyle }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {/* Infinite Grid Background */}
      <svg className="fc-wb-grid-svg" width="100%" height="100%">
        <defs>
          <pattern
            id="fc-wb-dots-pattern"
            width={28}
            height={28}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
          >
            <circle cx="14" cy="14" r="1.2" fill="#cbd5e1" opacity="0.85" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#fc-wb-dots-pattern)" />
      </svg>

      {/* SVG Drawing Layer: Shapes, Arrows, Freehand Strokes, Live Cursors */}
      <svg className="fc-wb-svg-layer" width="100%" height="100%">
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {elements.map((el) => {
            const isSelected = el.id === selectedElementId;
            const isMoving = activeGesture?.type === 'move' && activeGesture.elementId === el.id;
            const curX = isMoving ? activeGesture.currentX : el.x;
            const curY = isMoving ? activeGesture.currentY : el.y;

            if (el.type === 'rectangle') {
              const isResizing = activeGesture?.type === 'resize' && activeGesture.elementId === el.id;
              const w = isResizing ? activeGesture.currentW : el.width || 120;
              const h = isResizing ? activeGesture.currentH : el.height || 80;

              return (
                <g key={el.id} className="fc-wb-shape-group">
                  <rect
                    x={curX}
                    y={curY}
                    width={w}
                    height={h}
                    rx="4"
                    fill={el.color}
                    fillOpacity="0.12"
                    stroke={el.color}
                    strokeWidth="2.5"
                    className="fc-wb-interactive-shape"
                    onPointerDown={(e) => handleStartMoveElement(e, el)}
                  />
                  {isSelected && (
                    <rect
                      x={curX - 4}
                      y={curY - 4}
                      width={w + 8}
                      height={h + 8}
                      rx="6"
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      pointerEvents="none"
                    />
                  )}
                  {isSelected && !readOnly && (
                    <circle
                      cx={curX + w}
                      cy={curY + h}
                      r={6}
                      fill="#ffffff"
                      stroke="#2563eb"
                      strokeWidth="2"
                      className="fc-wb-handle"
                      onPointerDown={(e) => handleStartResize(e, el)}
                      title="Resize rectangle"
                    />
                  )}
                </g>
              );
            }

            if (el.type === 'circle') {
              const isResizing = activeGesture?.type === 'resize' && activeGesture.elementId === el.id;
              const r = isResizing
                ? Math.round(activeGesture.currentW / 2)
                : el.geometry?.r || Math.round((el.width || 100) / 2);
              return (
                <g key={el.id} className="fc-wb-shape-group">
                  <circle
                    cx={curX}
                    cy={curY}
                    r={r}
                    fill={el.color}
                    fillOpacity="0.12"
                    stroke={el.color}
                    strokeWidth="2.5"
                    className="fc-wb-interactive-shape"
                    onPointerDown={(e) => handleStartMoveElement(e, el)}
                  />
                  {isSelected && (
                    <circle
                      cx={curX}
                      cy={curY}
                      r={r + 5}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      pointerEvents="none"
                    />
                  )}
                  {isSelected && !readOnly && (
                    <circle
                      cx={curX + r}
                      cy={curY}
                      r={6}
                      fill="#ffffff"
                      stroke="#2563eb"
                      strokeWidth="2"
                      className="fc-wb-handle"
                      onPointerDown={(e) => handleStartResize(e, el)}
                      title="Resize circle"
                    />
                  )}
                </g>
              );
            }

            if (el.type === 'arrow') {
              const isDraggingEndpoint =
                activeGesture?.type === 'arrow_endpoint' && activeGesture.elementId === el.id;
              const moveDx = isMoving ? activeGesture.currentX - activeGesture.origX : 0;
              const moveDy = isMoving ? activeGesture.currentY - activeGesture.origY : 0;

              const x1 =
                isDraggingEndpoint && activeGesture.which === 'start'
                  ? activeGesture.endpointX
                  : (el.geometry?.x1 ?? el.x);
              const y1 =
                isDraggingEndpoint && activeGesture.which === 'start'
                  ? activeGesture.endpointY
                  : (el.geometry?.y1 ?? el.y);
              const x2 =
                isDraggingEndpoint && activeGesture.which === 'end'
                  ? activeGesture.endpointX
                  : (el.geometry?.x2 ?? el.x + (el.width || 100));
              const y2 =
                isDraggingEndpoint && activeGesture.which === 'end'
                  ? activeGesture.endpointY
                  : (el.geometry?.y2 ?? el.y + (el.height || 0));

              const head = calculateWhiteboardArrowhead(x1, y1, x2, y2, 14, 28);

              return (
                <g
                  key={el.id}
                  className="fc-wb-arrow-group"
                  transform={moveDx || moveDy ? `translate(${moveDx}, ${moveDy})` : undefined}
                >
                  {/* Invisible thicker hit-box line */}
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="transparent"
                    strokeWidth="16"
                    className="fc-wb-interactive-shape"
                    onPointerDown={(e) => handleStartMoveElement(e, el)}
                  />
                  {/* Rendered Arrow Line */}
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={el.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                  {/* Arrowhead */}
                  <path
                    d={head.pathData}
                    stroke={el.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    pointerEvents="none"
                  />

                  {/* Endpoint Drag Handles when Selected */}
                  {isSelected && !readOnly && (
                    <>
                      <circle
                        cx={x1}
                        cy={y1}
                        r={6}
                        fill="#ffffff"
                        stroke="#2563eb"
                        strokeWidth="2"
                        className="fc-wb-handle"
                        onPointerDown={(e) => handleStartArrowEndpointDrag(e, el, 'start')}
                      />
                      <circle
                        cx={x2}
                        cy={y2}
                        r={6}
                        fill="#ffffff"
                        stroke="#2563eb"
                        strokeWidth="2"
                        className="fc-wb-handle"
                        onPointerDown={(e) => handleStartArrowEndpointDrag(e, el, 'end')}
                      />
                    </>
                  )}
                </g>
              );
            }

            if (el.type === 'pencil') {
              const points = Array.isArray(el.geometry?.points) ? el.geometry.points : [];
              const pathData = pointsToSmoothSvgPath(points);
              const moveDx = isMoving ? activeGesture.currentX - activeGesture.origX : 0;
              const moveDy = isMoving ? activeGesture.currentY - activeGesture.origY : 0;

              return (
                <g
                  key={el.id}
                  className="fc-wb-pencil-group"
                  transform={moveDx || moveDy ? `translate(${moveDx}, ${moveDy})` : undefined}
                >
                  <path
                    d={pathData}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="18"
                    className="fc-wb-interactive-shape"
                    onPointerDown={(e) => handleStartMoveElement(e, el)}
                  />
                  <path
                    d={pathData}
                    fill="none"
                    stroke={el.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                  {isSelected && (
                    <path
                      d={pathData}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            }

            return null;
          })}

          {/* Active Drawing Preview (Shapes, Arrow, Pencil) */}
          {activeGesture?.type === 'draw' && (
            <g className="fc-wb-drawing-preview" pointerEvents="none">
              {activeGesture.tool === WHITEBOARD_TOOL_MODES.RECTANGLE && (
                <rect
                  x={Math.min(activeGesture.startX, activeGesture.currentX)}
                  y={Math.min(activeGesture.startY, activeGesture.currentY)}
                  width={Math.abs(activeGesture.currentX - activeGesture.startX)}
                  height={Math.abs(activeGesture.currentY - activeGesture.startY)}
                  rx="4"
                  fill={activeGesture.color}
                  fillOpacity="0.15"
                  stroke={activeGesture.color}
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
              )}
              {activeGesture.tool === WHITEBOARD_TOOL_MODES.CIRCLE && (
                <circle
                  cx={(activeGesture.startX + activeGesture.currentX) / 2}
                  cy={(activeGesture.startY + activeGesture.currentY) / 2}
                  r={
                    Math.max(
                      Math.abs(activeGesture.currentX - activeGesture.startX),
                      Math.abs(activeGesture.currentY - activeGesture.startY)
                    ) / 2
                  }
                  fill={activeGesture.color}
                  fillOpacity="0.15"
                  stroke={activeGesture.color}
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
              )}
              {activeGesture.tool === WHITEBOARD_TOOL_MODES.ARROW && (
                <>
                  <line
                    x1={activeGesture.startX}
                    y1={activeGesture.startY}
                    x2={activeGesture.currentX}
                    y2={activeGesture.currentY}
                    stroke={activeGesture.color}
                    strokeWidth="2.5"
                    strokeDasharray="4 4"
                  />
                  <path
                    d={
                      calculateWhiteboardArrowhead(
                        activeGesture.startX,
                        activeGesture.startY,
                        activeGesture.currentX,
                        activeGesture.currentY
                      ).pathData
                    }
                    stroke={activeGesture.color}
                    strokeWidth="2.5"
                    fill="none"
                  />
                </>
              )}
              {activeGesture.tool === WHITEBOARD_TOOL_MODES.PENCIL && (
                <path
                  d={pointsToSmoothSvgPath(activeGesture.points)}
                  fill="none"
                  stroke={activeGesture.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </g>
          )}

          {/* Live Collaborator Cursors in World Space */}
          {liveCursors.map((cursor) => {
            const invScale = zoom > 0 ? 1 / zoom : 1;
            return (
              <g
                key={cursor.sessionId || cursor.userId}
                transform={`translate(${cursor.x}, ${cursor.y})`}
                pointerEvents="none"
              >
                <g transform={`scale(${invScale})`}>
                  {/* Cursor Arrow */}
                  <path
                    d="M0,0 L0,18 L4.5,14 L8.5,22 L11.5,20.5 L7.5,12.5 L13,12.5 Z"
                    fill={cursor.color || '#2563eb'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  {/* Collaborator Name Tag */}
                  <g transform="translate(14, 14)">
                    <rect
                      x="0"
                      y="-12"
                      width={Math.max((cursor.displayName || 'Reviewer').length * 7.5 + 12, 40)}
                      height="20"
                      rx="4"
                      fill={cursor.color || '#2563eb'}
                    />
                    <text
                      x="6"
                      y="2"
                      fill="#ffffff"
                      fontSize="11"
                      fontWeight="600"
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      {cursor.displayName || 'Reviewer'}
                    </text>
                  </g>
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* HTML Layer: Sticky Notes & Text Boxes (Transformed via Pan and Zoom) */}
      <div
        className="fc-wb-world"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {elements.map((el) => {
          const isSelected = el.id === selectedElementId;
          const isMoving = activeGesture?.type === 'move' && activeGesture.elementId === el.id;
          const isResizing = activeGesture?.type === 'resize' && activeGesture.elementId === el.id;

          const curX = isMoving ? activeGesture.currentX : el.x;
          const curY = isMoving ? activeGesture.currentY : el.y;
          const curW = isResizing ? activeGesture.currentW : el.width || DEFAULT_STICKY_WIDTH;
          const curH = isResizing ? activeGesture.currentH : el.height || DEFAULT_STICKY_HEIGHT;

          if (el.type === 'sticky') {
            return (
              <div
                key={el.id}
                className={`fc-wb-sticky-note ${isSelected ? 'selected' : ''}`}
                style={{
                  transform: `translate(${curX}px, ${curY}px)`,
                  width: `${curW}px`,
                  height: `${curH}px`,
                  backgroundColor: el.color || DEFAULT_STICKY_COLOR,
                }}
                onPointerDown={(e) => handleStartMoveElement(e, el)}
              >
                <textarea
                  className="fc-wb-sticky-textarea"
                  value={el.text || ''}
                  placeholder="Take a note…"
                  readOnly={readOnly}
                  onChange={(e) => {
                    onUpdateElement?.(el.id, { text: e.target.value });
                  }}
                  onFocus={() => onSelectElement?.(el.id)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectElement?.(el.id);
                  }}
                />
                <div className="fc-wb-sticky-footer">
                  <span className="fc-wb-creator-tag">{el.creatorName || 'Reviewer'}</span>
                </div>

                {isSelected && !readOnly && (
                  <div
                    className="fc-wb-resize-handle"
                    onPointerDown={(e) => handleStartResize(e, el)}
                    title="Resize note"
                  />
                )}
              </div>
            );
          }

          if (el.type === 'text') {
            return (
              <div
                key={el.id}
                className={`fc-wb-text-box ${isSelected ? 'selected' : ''}`}
                style={{
                  transform: `translate(${curX}px, ${curY}px)`,
                  width: `${curW}px`,
                  minHeight: `${curH}px`,
                }}
                onPointerDown={(e) => handleStartMoveElement(e, el)}
              >
                <textarea
                  className="fc-wb-plain-textarea"
                  style={{ color: el.color || '#0f172a' }}
                  value={el.text || ''}
                  placeholder="Type text…"
                  readOnly={readOnly}
                  rows={Math.max((el.text || '').split('\n').length, 1)}
                  onChange={(e) => {
                    onUpdateElement?.(el.id, { text: e.target.value });
                  }}
                  onFocus={() => onSelectElement?.(el.id)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectElement?.(el.id);
                  }}
                />

                {isSelected && !readOnly && (
                  <div
                    className="fc-wb-resize-handle"
                    onPointerDown={(e) => handleStartResize(e, el)}
                  />
                )}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

