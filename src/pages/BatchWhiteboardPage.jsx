import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { NotificationBell } from '../components/NotificationBell.jsx';
import { WhiteboardCanvas } from '../components/WhiteboardCanvas.jsx';
import { WhiteboardToolbar } from '../components/WhiteboardToolbar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getReviewerColor } from '../services/annotationState.js';
import { getBatchById } from '../services/batchService.js';
import { ROLES } from '../services/profileService.js';
import {
  createWhiteboardElement,
  deleteWhiteboardElement,
  listBatchWhiteboardElements,
  subscribeToBatchWhiteboardRealtime,
  updateWhiteboardElement,
} from '../services/whiteboardService.js';
import {
  DEFAULT_STICKY_COLOR,
  WHITEBOARD_TOOL_MODES,
  getWhiteboardElementsBoundingBox,
} from '../services/whiteboardState.js';
import './BatchWhiteboardPage.css';

/**
 * Dedicated collaborative Miro-inspired whiteboard workspace for each batch.
 * Operates independently from image annotations, with full Supabase persistence,
 * real-time synchronization, zoom/pan navigation, and live reviewer cursors.
 */
export function BatchWhiteboardPage() {
  const { batchId } = useParams();
  const [searchParams] = useSearchParams();
  const targetElementId = searchParams.get('element');
  const { user, profile, loading: authLoading } = useAuth();

  const currentUserId = user?.id ?? null;
  const canReview = Boolean(
    currentUserId &&
      (profile?.role === ROLES.REVIEWER || profile?.role === ROLES.ADMIN)
  );
  const isReadOnlyMode = !canReview;
  const creatorNameFallback =
    profile?.display_name || user?.email || 'Reviewer';

  const [batch, setBatch] = useState(null);
  const [elements, setElements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [realtimeNotice, setRealtimeNotice] = useState('');

  const [activeTool, setActiveTool] = useState(WHITEBOARD_TOOL_MODES.SELECT);
  const [activeColor, setActiveColor] = useState(DEFAULT_STICKY_COLOR);
  const [selectedElementId, setSelectedElementId] = useState(null);

  // Zoom and pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 100, y: 100 });

  // Presence and live collaboration
  const [activeCollaborators, setActiveCollaborators] = useState([]);
  const [remoteCursors, setRemoteCursors] = useState({});

  const localSessionIdRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  );
  const realtimeSubRef = useRef(null);

  const userColor = useMemo(
    () => getReviewerColor(currentUserId || creatorNameFallback),
    [currentUserId, creatorNameFallback]
  );

  // Load batch metadata and whiteboard elements
  useEffect(() => {
    let disposed = false;

    async function loadData() {
      setLoading(true);
      setErrorMessage('');
      try {
        const [batchRow, initialElements] = await Promise.all([
          getBatchById(batchId),
          listBatchWhiteboardElements(batchId),
        ]);

        if (disposed) return;

        if (!batchRow) {
          setBatch(null);
          setErrorMessage('Batch not found or you do not have permission to access it.');
          return;
        }

        setBatch(batchRow);
        setElements(initialElements);

        // Center canvas around existing elements if available
        if (initialElements.length > 0) {
          const bbox = getWhiteboardElementsBoundingBox(initialElements);
          if (bbox && typeof window !== 'undefined') {
            const viewportW = window.innerWidth;
            const viewportH = window.innerHeight;
            setPan({
              x: viewportW / 2 - bbox.centerX,
              y: viewportH / 2 - bbox.centerY,
            });
          }
        }
      } catch (err) {
        if (!disposed) {
          setErrorMessage(err?.message || 'Unable to load whiteboard.');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      disposed = true;
    };
  }, [batchId]);

  // Focus and center element if requested via URL search param ?element=<elementId>
  useEffect(() => {
    if (!targetElementId || elements.length === 0) return;
    const target = elements.find((el) => el.id === targetElementId);
    if (target) {
      setSelectedElementId(target.id);
      const elW = target.width || 180;
      const elH = target.height || 140;
      const targetCenterX = target.x + elW / 2;
      const targetCenterY = target.y + elH / 2;
      const viewportW = window.innerWidth || 1200;
      const viewportH = window.innerHeight || 800;
      setPan({
        x: viewportW / 2 - targetCenterX * zoom,
        y: viewportH / 2 - targetCenterY * zoom,
      });
    }
  }, [targetElementId, elements, zoom]);

  // Subscribe to Supabase Realtime for live changes, presence, and cursors
  useEffect(() => {
    if (!batchId || !batch) return;

    let disposed = false;

    const presenceUser = canReview
      ? {
          user_id: currentUserId,
          sessionId: localSessionIdRef.current,
          display_name: creatorNameFallback,
          role: profile?.role,
          color: userColor,
        }
      : null;

    const unsubscribe = subscribeToBatchWhiteboardRealtime({
      batchId,
      presenceUser,
      onPresenceSync: (collaborators) => {
        if (!disposed) {
          setActiveCollaborators(collaborators);
        }
      },
      onElementUpsert: (upsertedElement) => {
        if (disposed || !upsertedElement) return;
        setElements((prev) => {
          const index = prev.findIndex((el) => el.id === upsertedElement.id);
          if (index >= 0) {
            const next = [...prev];
            next[index] = { ...prev[index], ...upsertedElement };
            return next;
          }
          // If this is our own element that replaced an optimistic temp element
          const tempIndex = prev.findIndex(
            (el) =>
              typeof el.id === 'string' &&
              el.id.startsWith('temp-') &&
              el.createdBy === upsertedElement.createdBy &&
              el.type === upsertedElement.type
          );
          if (tempIndex >= 0) {
            const next = [...prev];
            next[tempIndex] = upsertedElement;
            return next;
          }
          return [...prev, upsertedElement];
        });
      },
      onElementDelete: (deletedElementId) => {
        if (disposed || !deletedElementId) return;
        setElements((prev) => prev.filter((el) => el.id !== deletedElementId));
        setSelectedElementId((prevId) =>
          prevId === deletedElementId ? null : prevId
        );
      },
      onCursorBroadcast: (payload) => {
        if (disposed || !payload || !payload.userId) return;
        if (
          payload.userId === currentUserId &&
          payload.sessionId === localSessionIdRef.current
        ) {
          return;
        }
        setRemoteCursors((prev) => ({
          ...prev,
          [payload.sessionId || payload.userId]: {
            userId: payload.userId,
            sessionId: payload.sessionId,
            displayName: payload.displayName || 'Reviewer',
            color: payload.color || getReviewerColor(payload.userId || payload.displayName),
            x: payload.x,
            y: payload.y,
            timestamp: Date.now(),
          },
        }));
      },
      onCursorLeave: (payload) => {
        if (disposed || !payload) return;
        const key = payload.sessionId || payload.userId;
        if (!key) return;
        setRemoteCursors((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      },
      onStatusChange: (status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          setRealtimeNotice('');
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          setRealtimeNotice(
            'Live whiteboard connection interrupted. Attempting to reconnect…'
          );
        }
      },
    });

    realtimeSubRef.current = unsubscribe;

    return () => {
      disposed = true;
      realtimeSubRef.current = null;
      unsubscribe();
    };
  }, [batchId, batch, canReview, currentUserId, creatorNameFallback, profile?.role, userColor]);

  // Purge idle remote cursors
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        let changed = false;
        const next = {};
        for (const [key, cursor] of Object.entries(prev)) {
          if (now - cursor.timestamp < 4500) {
            next[key] = cursor;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard shortcut listener for tools
  useEffect(() => {
    if (isReadOnlyMode) return;

    const handleKeyDown = (e) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 'v':
          setActiveTool(WHITEBOARD_TOOL_MODES.SELECT);
          break;
        case 'h':
          setActiveTool(WHITEBOARD_TOOL_MODES.PAN);
          break;
        case 's':
          setActiveTool(WHITEBOARD_TOOL_MODES.STICKY);
          break;
        case 't':
          setActiveTool(WHITEBOARD_TOOL_MODES.TEXT);
          break;
        case 'r':
          setActiveTool(WHITEBOARD_TOOL_MODES.RECTANGLE);
          break;
        case 'o':
          setActiveTool(WHITEBOARD_TOOL_MODES.CIRCLE);
          break;
        case 'a':
          setActiveTool(WHITEBOARD_TOOL_MODES.ARROW);
          break;
        case 'p':
          setActiveTool(WHITEBOARD_TOOL_MODES.PENCIL);
          break;
        case 'delete':
        case 'backspace':
          if (selectedElementId) {
            handleDeleteSelected();
          }
          break;
        case 'escape':
          setSelectedElementId(null);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReadOnlyMode, selectedElementId]);

  // Whiteboard Element Mutations
  const handleCreateElement = useCallback(
    async (elementDraft) => {
      if (!canReview || !currentUserId) return;
      try {
        const optimisticId = `temp-${Date.now()}`;
        const optimisticElement = {
          ...elementDraft,
          id: optimisticId,
          batchId,
          createdBy: currentUserId,
          creatorName: creatorNameFallback,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          zIndex: elements.length,
        };

        setElements((prev) => [...prev, optimisticElement]);
        setSelectedElementId(optimisticId);

        const saved = await createWhiteboardElement({
          ...elementDraft,
          batchId,
          createdBy: currentUserId,
          creatorNameFallback,
          zIndex: elements.length,
        });

        setElements((prev) => {
          const alreadyAdded = prev.some((el) => el.id === saved.id);
          if (alreadyAdded) {
            return prev.filter((el) => el.id !== optimisticId);
          }
          return prev.map((el) => (el.id === optimisticId ? saved : el));
        });
        setSelectedElementId(saved.id);
      } catch (err) {
        console.error('Failed to create whiteboard element:', err);
      }
    },
    [batchId, canReview, creatorNameFallback, currentUserId, elements.length]
  );

  const handleUpdateElement = useCallback(
    async (elementId, updates) => {
      if (!canReview || !elementId) return;

      // Optimistic update
      setElements((prev) =>
        prev.map((el) => (el.id === elementId ? { ...el, ...updates } : el))
      );

      // Do not attempt to update unsaved optimistic elements in Supabase
      if (typeof elementId === 'string' && elementId.startsWith('temp-')) {
        return;
      }

      try {
        await updateWhiteboardElement(elementId, updates, creatorNameFallback);
      } catch (err) {
        console.error('Failed to update whiteboard element:', err);
      }
    },
    [canReview, creatorNameFallback]
  );

  const handleDeleteElement = useCallback(
    async (elementId) => {
      if (!canReview || !elementId) return;

      setElements((prev) => prev.filter((el) => el.id !== elementId));
      if (selectedElementId === elementId) {
        setSelectedElementId(null);
      }

      if (typeof elementId === 'string' && elementId.startsWith('temp-')) {
        return;
      }

      try {
        await deleteWhiteboardElement(elementId);
      } catch (err) {
        console.error('Failed to delete whiteboard element:', err);
      }
    },
    [canReview, selectedElementId]
  );

  const handleSelectColor = useCallback(
    (color) => {
      setActiveColor(color);
      if (selectedElementId && canReview) {
        handleUpdateElement(selectedElementId, { color });
      }
    },
    [canReview, handleUpdateElement, selectedElementId]
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedElementId) {
      handleDeleteElement(selectedElementId);
    }
  }, [handleDeleteElement, selectedElementId]);

  // Cursors
  const handleCursorMove = useCallback(
    ({ x, y }) => {
      if (!canReview || !realtimeSubRef.current) return;
      realtimeSubRef.current.sendCursor({
        userId: currentUserId,
        sessionId: localSessionIdRef.current,
        displayName: creatorNameFallback,
        color: userColor,
        x,
        y,
      });
    },
    [canReview, creatorNameFallback, currentUserId, userColor]
  );

  const handleCursorLeave = useCallback(() => {
    if (!canReview || !realtimeSubRef.current) return;
    realtimeSubRef.current.sendCursorLeave({
      userId: currentUserId,
      sessionId: localSessionIdRef.current,
    });
  }, [canReview, currentUserId]);

  // Zoom controls
  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.25, 3.0));
  const handleZoomOut = () => setZoom((z) => Math.max(z * 0.8, 0.15));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 100, y: 100 });
  };
  const handleFitElements = () => {
    if (elements.length === 0) {
      handleResetZoom();
      return;
    }
    const bbox = getWhiteboardElementsBoundingBox(elements);
    if (!bbox || typeof window === 'undefined') return;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const padding = 120;
    const scaleX = (viewportW - padding * 2) / Math.max(bbox.width, 100);
    const scaleY = (viewportH - padding * 2) / Math.max(bbox.height, 100);
    const nextZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.5);

    setZoom(nextZoom);
    setPan({
      x: viewportW / 2 - bbox.centerX * nextZoom,
      y: viewportH / 2 - bbox.centerY * nextZoom,
    });
  };

  const selectedElement = useMemo(
    () => elements.find((el) => el.id === selectedElementId) || null,
    [elements, selectedElementId]
  );

  // Sync toolbar color swatch with selected element
  useEffect(() => {
    if (selectedElement?.color) {
      setActiveColor(selectedElement.color);
    }
  }, [selectedElement?.id, selectedElement?.color]);

  if (loading || authLoading) {
    return (
      <div className="fc-whiteboard-page">
        <header className="fc-whiteboard-header">
          <div className="fc-wb-header-left">
            <Link to="/dashboard" className="fc-brand">
              <span className="fc-brand-mark" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
                </svg>
              </span>
              <span className="fc-brand-name">FrameCheck</span>
            </Link>
          </div>
        </header>
        <main className="fc-whiteboard-state-container" aria-busy="true">
          <div className="fc-spinner-row">
            <span className="fc-spinner" aria-hidden="true" />
            <span>Loading collaborative whiteboard…</span>
          </div>
        </main>
      </div>
    );
  }

  if (errorMessage || !batch) {
    return (
      <div className="fc-whiteboard-page">
        <header className="fc-whiteboard-header">
          <div className="fc-wb-header-left">
            <Link to="/dashboard" className="fc-brand">
              <span className="fc-brand-mark" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
                </svg>
              </span>
              <span className="fc-brand-name">FrameCheck</span>
            </Link>
          </div>
        </header>
        <main className="fc-whiteboard-state-container">
          <div className="fc-alert fc-alert-error" role="alert">
            {errorMessage || 'Batch not found.'}
          </div>
          <div style={{ marginTop: '16px' }}>
            <Link to="/dashboard" className="fc-btn fc-btn-primary">
              Back to Batches
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="fc-whiteboard-page">
      {/* Top Header */}
      <header className="fc-whiteboard-header">
        <div className="fc-wb-header-left">
          <Link to="/dashboard" className="fc-brand" title="Dashboard">
            <span className="fc-brand-mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
            <span className="fc-brand-name">FrameCheck</span>
          </Link>

          <span className="fc-wb-header-divider" aria-hidden="true" />

          <Link
            to={`/batches/${batch.id}/review`}
            className="fc-btn fc-btn-secondary fc-btn-sm"
          >
            ← Review Workspace
          </Link>

          <Link
            to={`/batches/${batch.id}`}
            className="fc-btn fc-btn-secondary fc-btn-sm"
          >
            Batch Details
          </Link>

          <span className="fc-wb-header-divider" aria-hidden="true" />

          <h1 className="fc-wb-batch-title" title={batch.name}>
            {batch.name}
          </h1>
          <span className="fc-wb-badge">Whiteboard</span>
        </div>

        <div className="fc-wb-header-right">
          <NotificationBell />
          {activeCollaborators.length > 0 && (
            <div
              className="fc-wb-collaborators-bar"
              title={`Collaborating now: ${activeCollaborators.map((c) => c.displayName).join(', ')}`}
            >
              <span className="fc-presence-dot" aria-hidden="true" />
              <div className="fc-wb-collaborator-avatars">
                {activeCollaborators.map((collab) => {
                  const isSelf = collab.userId === currentUserId;
                  const initials = (collab.displayName || 'R').slice(0, 2).toUpperCase();
                  return (
                    <span
                      key={collab.userId}
                      className="fc-wb-collab-avatar"
                      style={{ backgroundColor: collab.color }}
                      title={`${collab.displayName}${isSelf ? ' (You)' : ''}`}
                    >
                      {initials}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Disconnection Banner */}
      {realtimeNotice && (
        <div className="fc-realtime-banner" role="status">
          {realtimeNotice}
        </div>
      )}

      {/* Main Canvas Workspace */}
      <main className="fc-whiteboard-main">
        <WhiteboardCanvas
          elements={elements}
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          activeColor={activeColor}
          selectedElementId={selectedElementId}
          onSelectElement={setSelectedElementId}
          onCreateElement={handleCreateElement}
          onUpdateElement={handleUpdateElement}
          onDeleteElement={handleDeleteElement}
          currentUserId={currentUserId}
          readOnly={isReadOnlyMode}
          liveCursors={Object.values(remoteCursors)}
          onCursorMove={handleCursorMove}
          onCursorLeave={handleCursorLeave}
          zoom={zoom}
          setZoom={setZoom}
          pan={pan}
          setPan={setPan}
        />

        {/* Empty State Banner (Miro-inspired) */}
        {elements.length === 0 && !isReadOnlyMode && (
          <div className="fc-wb-empty-prompt">
            <div className="fc-wb-empty-icon">💡</div>
            <div className="fc-wb-empty-text">
              <strong>Your shared batch whiteboard is ready!</strong>
              <p>Pick a sticky note, shape, connector, or pencil from the toolbar below to start brainstorming.</p>
            </div>
          </div>
        )}

        {/* Read-Only Notice for Uploaders */}
        {isReadOnlyMode && (
          <div className="fc-wb-readonly-banner" role="status">
            <span>Viewing Mode — Reviewers and Admins collaborate here to discuss and plan feedback.</span>
          </div>
        )}

        {/* Floating Element Toolbar */}
        <WhiteboardToolbar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          activeColor={activeColor}
          onSelectColor={handleSelectColor}
          selectedElement={selectedElement}
          canEditSelected={!isReadOnlyMode}
          onDeleteSelected={handleDeleteSelected}
          readOnly={isReadOnlyMode}
        />

        {/* Floating Zoom Controls */}
        <div className="fc-wb-zoom-controls">
          <button
            type="button"
            className="fc-wb-zoom-btn"
            onClick={handleZoomIn}
            title="Zoom In"
            aria-label="Zoom in"
          >
            +
          </button>
          <span className="fc-wb-zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="fc-wb-zoom-btn"
            onClick={handleZoomOut}
            title="Zoom Out"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="fc-wb-zoom-btn fc-wb-zoom-btn-text"
            onClick={handleFitElements}
            title="Fit to Content"
          >
            Fit
          </button>
          <button
            type="button"
            className="fc-wb-zoom-btn fc-wb-zoom-btn-text"
            onClick={handleResetZoom}
            title="Reset Zoom (100%)"
          >
            100%
          </button>
        </div>
      </main>
    </div>
  );
}
