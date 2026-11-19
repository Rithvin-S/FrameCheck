import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnnotationLayer } from '../components/AnnotationLayer.jsx';
import { AnnotationToolbar } from '../components/AnnotationToolbar.jsx';
import { ImagePreview } from '../components/ImagePreview.jsx';
import { ReviewHeader } from '../components/ReviewHeader.jsx';
import { DraftCommentComposer, ReviewSidebar } from '../components/ReviewSidebar.jsx';
import { ImageThumbnailsPanel } from '../components/ImageThumbnailsPanel.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  createAnnotation,
  createBatchLayer,
  deleteBatchLayer,
  fetchCreatorDisplayName,
  listBatchAnnotations,
  listBatchLayers,
  mapAnnotationRow,
  restoreAnnotation,
  setAnnotationStatus,
  softDeleteAnnotation,
  subscribeToBatchReviewRealtime,
  updateAnnotationAssignment,
  updateAnnotationColor,
  updateAnnotationComment,
  updateAnnotationCustomProperties,
  updateAnnotationGeometry,
  updateAnnotationLabels,
  updateAnnotationLayer,
  updateAnnotationPriority,
  updateAnnotationStyle,
  updateBatchLayer,
} from '../services/annotationService.js';
import { downloadImageReviewReport } from '../services/imagePdfReportService.js';
import {
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_LAYERS,
  annotationsReducer,
  getImageAnnotationState,
  getReviewerColor,
  hasGeometryChanged,
  translateAnnotationGeometry,
} from '../services/annotationState.js';
import {
  REVIEW_STATUSES,
  deriveBatchReviewStatus,
  getBatchById,
  listBatchImages,
  updateBatchImageCompletion,
} from '../services/batchService.js';
import {
  extractMentionedUserIds,
  listBatchMentionableUsers,
  listBatchReactions,
  syncAnnotationMentions,
  toggleAnnotationReaction,
} from '../services/mentionReactionService.js';
import {
  deduplicateAndSortActivities,
  fetchBatchActivityFeed,
  recordActivityEvent,
  recordHandoffActivity,
} from '../services/activityService.js';
import {
  addCustomChecklistItem,
  deleteChecklistItem,
  fetchBatchChecklists,
  toggleChecklistItem,
} from '../services/checklistService.js';
import { ROLES } from '../services/profileService.js';
import { ReferenceViewerModal } from '../components/ReferenceViewerModal.jsx';
import { ReferenceComparisonModal } from '../components/ReferenceComparisonModal.jsx';
import { AnnotationPropertiesModal } from '../components/AnnotationPropertiesModal.jsx';
import { LayerManagerModal } from '../components/LayerManagerModal.jsx';
import {
  canManageReference,
  deleteReferenceImage,
  listImageReferences,
  replaceReferenceImage,
  updateReferenceComment,
  uploadReferenceImage,
} from '../services/referenceImageService.js';
import {
  createDiscussionMessage,
  deleteDiscussionMessage,
  listBatchDiscussions,
} from '../services/discussionService.js';
import { WorkspaceResizeHandle } from '../components/WorkspaceResizeHandle.jsx';
import {
  BUILTIN_PRESETS,
  DEFAULT_LAYOUT,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_THUMBNAILS_WIDTH,
  MIN_CANVAS_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MIN_THUMBNAILS_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MAX_THUMBNAILS_WIDTH,
  deleteUserLayout,
  fetchUserSavedLayouts,
  getActiveLayoutPreference,
  saveActiveLayoutPreference,
  saveUserLayout,
  sanitizeLayoutData,
} from '../services/workspaceLayoutService.js';
import {
  DEFAULT_REVIEWER_PREFERENCES,
  fetchReviewerPreferences,
  getCachedReviewerPreferences,
  saveReviewerPreferences,
} from '../services/reviewerPreferencesService.js';
import { ReviewerPreferencesModal } from '../components/ReviewerPreferencesModal.jsx';
import {
  getStoredShortcuts,
  saveStoredShortcuts,
  resetStoredShortcuts,
  matchesShortcut,
  DEFAULT_SHORTCUTS,
} from '../services/keyboardShortcutsService.js';
import { KeyboardShortcutsModal } from '../components/KeyboardShortcutsModal.jsx';
import { AnnotationTemplatesModal } from '../components/AnnotationTemplatesModal.jsx';
import { PresentationModeOverlay } from '../components/PresentationModeOverlay.jsx';
import { ImageExportModal } from '../components/ImageExportModal.jsx';
import { OnboardingModal } from '../components/OnboardingModal.jsx';
import {
  applyTemplateToAnnotation,
} from '../services/annotationTemplateService.js';
import {
  listBatchPendingReplacements,
  subscribeToBatchVersionEvents,
} from '../services/imageVersioningService.js';
import { ReplacementApprovalModal } from '../components/ReplacementApprovalModal.jsx';
import { VersionHistoryModal } from '../components/VersionHistoryModal.jsx';
import { ReviewMoreActionsMenu } from '../components/ReviewMoreActionsMenu.jsx';
import './ReviewWorkspacePage.css';

/**
 * Dedicated desktop-first image review workspace with persisted Supabase annotations,
 * required mistake explanation comments, creator-only edit/resolve/delete controls,
 * and command-based undo/redo synchronized with PostgreSQL.
 */
export function ReviewWorkspacePage() {
  const { batchId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const currentUserId = user?.id ?? null;
  const canReview = Boolean(
    currentUserId &&
      (profile?.role === ROLES.REVIEWER || profile?.role === ROLES.ADMIN)
  );
  const isReadOnlyMode = !canReview;
  const creatorNameFallback =
    profile?.display_name || user?.email || 'Reviewer';

  const [batch, setBatch] = useState(null);
  const [images, setImages] = useState([]);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [actionError, setActionError] = useState('');

  const [annotationsByImage, dispatchAnnotations] = useReducer(
    annotationsReducer,
    {}
  );
  const annotationsByImageRef = useRef(annotationsByImage);
  annotationsByImageRef.current = annotationsByImage;

  const [reviewerPreferences, setReviewerPreferences] = useState(() =>
    getCachedReviewerPreferences(currentUserId || 'guest')
  );
  const [isPreferencesModalOpen, setIsPreferencesModalOpen] = useState(false);
  const [toolMode, setToolMode] = useState(
    reviewerPreferences.defaultTool || 'circle'
  );
  const [activeDrawColor, setActiveDrawColor] = useState(
    reviewerPreferences.defaultColor || DEFAULT_ANNOTATION_COLOR
  );
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState([]);
  const selectedAnnotationId = selectedAnnotationIds[0] || null;
  const setSelectedAnnotationId = useCallback((idOrFn) => {
    setSelectedAnnotationIds((prev) => {
      const nextId = typeof idOrFn === 'function' ? idOrFn(prev[0] || null) : idOrFn;
      return nextId ? [nextId] : [];
    });
  }, []);
  const [draftAnnotation, setDraftAnnotation] = useState(null);
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [busyAnnotationIds, setBusyAnnotationIds] = useState([]);
  const [updatingCompletionId, setUpdatingCompletionId] = useState(null);
  const [generatingImageReport, setGeneratingImageReport] = useState(false);
  const [realtimeNotice, setRealtimeNotice] = useState('');
  const [activeReviewers, setActiveReviewers] = useState([]);
  const [followingUserId, setFollowingUserId] = useState(null);
  const [externalViewport, setExternalViewport] = useState(null);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [actionNotice, setActionNotice] = useState('');
  const [initialLayout] = useState(() =>
    getActiveLayoutPreference(currentUserId || 'guest')
  );
  const [thumbnailsWidth, setThumbnailsWidth] = useState(initialLayout.thumbnailsWidth);
  const [sidebarWidth, setSidebarWidth] = useState(initialLayout.sidebarWidth);
  const [panelLayout, setPanelLayout] = useState(initialLayout.panelLayout);
  const [isThumbnailsCollapsed, setIsThumbnailsCollapsed] = useState(
    initialLayout.isThumbnailsCollapsed
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    initialLayout.isSidebarCollapsed
  );
  const [isThumbnailsVisible, setIsThumbnailsVisible] = useState(
    initialLayout.isThumbnailsVisible
  );
  const [isSidebarVisible, setIsSidebarVisible] = useState(
    initialLayout.isSidebarVisible
  );
  const [activeLayoutId, setActiveLayoutId] = useState(
    initialLayout.id || 'preset-default'
  );
  const [activeLayoutName, setActiveLayoutName] = useState(
    initialLayout.name || 'Default'
  );
  const [savedLayouts, setSavedLayouts] = useState([]);

  // Load saved custom layouts and reviewer preferences for the current authenticated user
  useEffect(() => {
    let isMounted = true;
    fetchUserSavedLayouts(currentUserId || 'guest').then((list) => {
      if (isMounted) {
        setSavedLayouts(list);
      }
    });

    fetchReviewerPreferences(currentUserId || 'guest').then((prefs) => {
      if (isMounted && prefs) {
        setReviewerPreferences(prefs);
        setActiveDrawColor((prev) =>
          prev === DEFAULT_ANNOTATION_COLOR ? prefs.defaultColor : prev
        );
        setToolMode((prev) => (prev === 'circle' ? prefs.defaultTool : prev));
        setActiveDrawStyle((prev) => ({
          ...prev,
          strokeWidth: prefs.defaultStrokeWidth || prev.strokeWidth,
        }));
      }
    });

    return () => {
      isMounted = false;
    };
  }, [currentUserId]);

  const handleSaveReviewerPreferences = useCallback(
    async (nextPrefs) => {
      const saved = await saveReviewerPreferences(
        currentUserId || 'guest',
        nextPrefs
      );
      setReviewerPreferences(saved);
      setActiveDrawColor(saved.defaultColor);
      setActiveDrawStyle((prev) => ({
        ...prev,
        strokeWidth: saved.defaultStrokeWidth || prev.strokeWidth,
      }));
      setActionNotice('Reviewer workspace preferences saved.');
    },
    [currentUserId]
  );

  // Phase 22C: Autosave state and mutation queue tracking
  const [autosaveStatus, setAutosaveStatus] = useState('saved'); // 'saved' | 'saving' | 'failed'
  const failedSyncTasksRef = useRef([]);
  const lastMutationTimestampRef = useRef(new Map());

  // Phase 22C: Toolbar popups common state ('shortcuts' | 'templates' | null) ensuring opening one closes the other
  const [activeToolbarPopup, setActiveToolbarPopup] = useState(null);
  const [toolbarPopupAnchor, setToolbarPopupAnchor] = useState(null);

  const isShortcutsModalOpen = activeToolbarPopup === 'shortcuts';
  const isTemplatesModalOpen = activeToolbarPopup === 'templates';

  const handleOpenShortcuts = useCallback((anchorEl) => {
    setActiveToolbarPopup((prev) => {
      if (prev === 'shortcuts') {
        setToolbarPopupAnchor(null);
        return null;
      }
      setToolbarPopupAnchor(anchorEl || document.querySelector('.fc-ann-shortcuts-btn'));
      return 'shortcuts';
    });
  }, []);

  const handleOpenTemplates = useCallback((anchorEl) => {
    setActiveToolbarPopup((prev) => {
      if (prev === 'templates') {
        setToolbarPopupAnchor(null);
        return null;
      }
      setToolbarPopupAnchor(anchorEl || document.querySelector('.fc-ann-templates-btn'));
      return 'templates';
    });
  }, []);

  const handleCloseToolbarPopup = useCallback(() => {
    setActiveToolbarPopup(null);
    setToolbarPopupAnchor(null);
  }, []);
  const [userShortcuts, setUserShortcuts] = useState(() =>
    getStoredShortcuts(currentUserId || 'guest')
  );

  // Sync user shortcuts on user change
  useEffect(() => {
    setUserShortcuts(getStoredShortcuts(currentUserId || 'guest'));
  }, [currentUserId]);

  const handleSaveCustomShortcuts = useCallback(
    (nextShortcuts) => {
      saveStoredShortcuts(currentUserId || 'guest', nextShortcuts);
      setUserShortcuts(nextShortcuts);
      setActionNotice('Custom keyboard shortcuts saved.');
    },
    [currentUserId]
  );

  const handleResetCustomShortcuts = useCallback(() => {
    const defaults = resetStoredShortcuts(currentUserId || 'guest');
    setUserShortcuts(defaults);
    setActionNotice('Keyboard shortcuts reset to defaults.');
    return defaults;
  }, [currentUserId]);

  // Phase 17C / Phase 22D: Full-Screen Focus Mode & Presentation Mode
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [showPresentationAnnotations, setShowPresentationAnnotations] = useState(true);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);
  const [pendingReplacements, setPendingReplacements] = useState([]);
  const [isReplacementModalOpen, setIsReplacementModalOpen] = useState(false);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const hasAutoCheckedOnboardingRef = useRef(false);

  // Auto-launch onboarding on first visit if not yet completed
  useEffect(() => {
    if (loading || hasAutoCheckedOnboardingRef.current) return;
    hasAutoCheckedOnboardingRef.current = true;

    const userId = currentUserId || 'guest';
    let isDone = false;
    try {
      isDone = window.localStorage.getItem(`fc_onboarding_completed_${userId}`) === 'true';
    } catch {}

    if (!isDone && !reviewerPreferences.onboardingCompleted) {
      setIsOnboardingModalOpen(true);
    }
  }, [loading, currentUserId, reviewerPreferences.onboardingCompleted]);

  const handleOnboardingComplete = useCallback(
    (dontShowAgain) => {
      if (dontShowAgain) {
        const nextPrefs = {
          ...reviewerPreferences,
          onboardingCompleted: true,
        };
        setReviewerPreferences(nextPrefs);
        saveReviewerPreferences(currentUserId || 'guest', nextPrefs);
      }
      setIsOnboardingModalOpen(false);
    },
    [currentUserId, reviewerPreferences]
  );

  // Phase 22C: Safe navigation guard during active autosave sync
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (pendingSyncCount > 0 || autosaveStatus === 'saving') {
        e.preventDefault();
        e.returnValue = 'You have unsaved annotation changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [pendingSyncCount, autosaveStatus]);

  // Persist the user's active workspace layout configuration
  useEffect(() => {
    saveActiveLayoutPreference(currentUserId || 'guest', {
      id: activeLayoutId,
      name: activeLayoutName,
      thumbnailsWidth,
      sidebarWidth,
      panelLayout,
      isThumbnailsCollapsed,
      isSidebarCollapsed,
      isThumbnailsVisible,
      isSidebarVisible,
    });
  }, [
    currentUserId,
    activeLayoutId,
    activeLayoutName,
    thumbnailsWidth,
    sidebarWidth,
    panelLayout,
    isThumbnailsCollapsed,
    isSidebarCollapsed,
    isThumbnailsVisible,
    isSidebarVisible,
  ]);

  const currentLayoutSnapshot = useMemo(() => {
    return {
      thumbnailsWidth,
      sidebarWidth,
      panelLayout,
      isThumbnailsCollapsed,
      isSidebarCollapsed,
      isThumbnailsVisible,
      isSidebarVisible,
    };
  }, [
    thumbnailsWidth,
    sidebarWidth,
    panelLayout,
    isThumbnailsCollapsed,
    isSidebarCollapsed,
    isThumbnailsVisible,
    isSidebarVisible,
  ]);

  const isLayoutModified = useMemo(() => {
    const activePreset = BUILTIN_PRESETS.find((p) => p.id === activeLayoutId);
    if (activePreset) {
      return (
        thumbnailsWidth !== activePreset.thumbnailsWidth ||
        sidebarWidth !== activePreset.sidebarWidth ||
        panelLayout !== activePreset.panelLayout ||
        isThumbnailsCollapsed !== activePreset.isThumbnailsCollapsed ||
        isSidebarCollapsed !== activePreset.isSidebarCollapsed ||
        isThumbnailsVisible !== activePreset.isThumbnailsVisible ||
        isSidebarVisible !== activePreset.isSidebarVisible
      );
    }
    const saved = savedLayouts.find((s) => s.id === activeLayoutId);
    if (saved) {
      return (
        thumbnailsWidth !== saved.thumbnailsWidth ||
        sidebarWidth !== saved.sidebarWidth ||
        panelLayout !== saved.panelLayout ||
        isThumbnailsCollapsed !== saved.isThumbnailsCollapsed ||
        isSidebarCollapsed !== saved.isSidebarCollapsed ||
        isThumbnailsVisible !== saved.isThumbnailsVisible ||
        isSidebarVisible !== saved.isSidebarVisible
      );
    }
    return false;
  }, [
    activeLayoutId,
    savedLayouts,
    thumbnailsWidth,
    sidebarWidth,
    panelLayout,
    isThumbnailsCollapsed,
    isSidebarCollapsed,
    isThumbnailsVisible,
    isSidebarVisible,
  ]);

  const maxThumbnailsWidth = useMemo(() => {
    if (typeof window === 'undefined') return MAX_THUMBNAILS_WIDTH;
    const otherPanelWidth = !isSidebarVisible
      ? 0
      : isSidebarCollapsed
      ? 44
      : sidebarWidth;
    const dynamicMax = window.innerWidth - otherPanelWidth - MIN_CANVAS_WIDTH - 20;
    return Math.max(MIN_THUMBNAILS_WIDTH, Math.min(MAX_THUMBNAILS_WIDTH, dynamicMax));
  }, [isSidebarCollapsed, isSidebarVisible, sidebarWidth]);

  const maxSidebarWidth = useMemo(() => {
    if (typeof window === 'undefined') return MAX_SIDEBAR_WIDTH;
    const otherPanelWidth = !isThumbnailsVisible
      ? 0
      : isThumbnailsCollapsed
      ? 44
      : thumbnailsWidth;
    const dynamicMax = window.innerWidth - otherPanelWidth - MIN_CANVAS_WIDTH - 20;
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, dynamicMax));
  }, [isThumbnailsCollapsed, isThumbnailsVisible, thumbnailsWidth]);

  const handleThumbnailsResize = useCallback((newWidth) => {
    setThumbnailsWidth(newWidth);
  }, []);

  const handleThumbnailsResizeEnd = useCallback((finalWidth) => {
    setThumbnailsWidth(finalWidth);
  }, []);

  const handleSidebarResize = useCallback((newWidth) => {
    setSidebarWidth(newWidth);
  }, []);

  const handleSidebarResizeEnd = useCallback((finalWidth) => {
    setSidebarWidth(finalWidth);
  }, []);

  const handleToggleThumbnailsCollapse = useCallback(() => {
    setIsThumbnailsCollapsed((prev) => !prev);
  }, []);

  const handleToggleSidebarCollapse = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  const handleTogglePanelLayout = useCallback(() => {
    setPanelLayout((prev) => (prev === 'default' ? 'swapped' : 'default'));
  }, []);

  const handleResetPanelSizes = useCallback(() => {
    setThumbnailsWidth(DEFAULT_THUMBNAILS_WIDTH);
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    setPanelLayout('default');
    setIsThumbnailsCollapsed(false);
    setIsSidebarCollapsed(false);
    setIsThumbnailsVisible(true);
    setIsSidebarVisible(true);
  }, []);

  const handleToggleThumbnailsVisible = useCallback(() => {
    setIsThumbnailsVisible((prev) => {
      if (prev && !isSidebarVisible) {
        setActionNotice(
          'At least one navigation panel must stay visible. Use Focus Mode (F) to hide all panels.'
        );
        return prev;
      }
      return !prev;
    });
  }, [isSidebarVisible]);

  const handleToggleSidebarVisible = useCallback(() => {
    setIsSidebarVisible((prev) => {
      if (prev && !isThumbnailsVisible) {
        setActionNotice(
          'At least one navigation panel must stay visible. Use Focus Mode (F) to hide all panels.'
        );
        return prev;
      }
      return !prev;
    });
  }, [isThumbnailsVisible]);

  const handleShowAllPanels = useCallback(() => {
    setIsThumbnailsVisible(true);
    setIsSidebarVisible(true);
  }, []);

  const handleApplyLayout = useCallback((layout) => {
    if (!layout) return;
    const sanitized = sanitizeLayoutData(layout);
    setThumbnailsWidth(sanitized.thumbnailsWidth);
    setSidebarWidth(sanitized.sidebarWidth);
    setPanelLayout(sanitized.panelLayout);
    setIsThumbnailsCollapsed(sanitized.isThumbnailsCollapsed);
    setIsSidebarCollapsed(sanitized.isSidebarCollapsed);
    setIsThumbnailsVisible(sanitized.isThumbnailsVisible);
    setIsSidebarVisible(sanitized.isSidebarVisible);
    setActiveLayoutId(layout.id || 'custom');
    setActiveLayoutName(layout.name || 'Custom');
    setActionNotice(`Applied layout "${layout.name}"`);
  }, []);

  const handleSaveLayout = useCallback(
    async (name) => {
      const saved = await saveUserLayout({
        userId: currentUserId || 'guest',
        name,
        layoutData: currentLayoutSnapshot,
      });
      setSavedLayouts((prev) => {
        const idx = prev.findIndex(
          (item) =>
            item.id === saved.id ||
            item.name.toLowerCase() === saved.name.toLowerCase()
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      setActiveLayoutId(saved.id);
      setActiveLayoutName(saved.name);
      setActionNotice(`Saved layout "${saved.name}"`);
    },
    [currentLayoutSnapshot, currentUserId]
  );

  const handleDeleteLayout = useCallback(
    async (layoutId) => {
      await deleteUserLayout({ userId: currentUserId || 'guest', layoutId });
      setSavedLayouts((prev) => prev.filter((item) => item.id !== layoutId));
      if (activeLayoutId === layoutId) {
        setActiveLayoutId('preset-default');
        setActiveLayoutName('Default');
      }
      setActionNotice('Deleted custom layout');
    },
    [activeLayoutId, currentUserId]
  );

  // Phase 21B/22C: Global keyboard shortcuts (Alt+1 for Thumbnails, Alt+2 for Sidebar)
  useEffect(() => {
    const handleWorkspaceKeyDown = (e) => {
      if (
        e.defaultPrevented ||
        isFocusMode ||
        isPresentationMode ||
        isShortcutsModalOpen ||
        isTemplatesModalOpen
      ) {
        return;
      }

      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable)
      ) {
        return;
      }

      if (matchesShortcut(e, userShortcuts.view_toggle_thumbnails || 'Alt+1')) {
        e.preventDefault();
        handleToggleThumbnailsVisible();
      } else if (matchesShortcut(e, userShortcuts.view_toggle_sidebar || 'Alt+2')) {
        e.preventDefault();
        handleToggleSidebarVisible();
      }
    };

    window.addEventListener('keydown', handleWorkspaceKeyDown);
    return () => window.removeEventListener('keydown', handleWorkspaceKeyDown);
  }, [
    handleToggleSidebarVisible,
    handleToggleThumbnailsVisible,
    isFocusMode,
    isPresentationMode,
    isShortcutsModalOpen,
    isTemplatesModalOpen,
    userShortcuts,
  ]);
  const [mentionableUsers, setMentionableUsers] = useState([]);
  const mentionableUsersRef = useRef([]);
  mentionableUsersRef.current = mentionableUsers;
  const [reactionsByAnnotation, setReactionsByAnnotation] = useState({});
  const [discussionsByAnnotation, setDiscussionsByAnnotation] = useState({});
  const [checklists, setChecklists] = useState([]);
  const [sidebarMode, setSidebarMode] = useState('comments');
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState('');
  // Phase 18B: Reference images state
  const [references, setReferences] = useState([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referencesError, setReferencesError] = useState('');
  const [activeViewerReference, setActiveViewerReference] = useState(null);
  // Phase 18C: Reference image comparison state
  const [comparisonReference, setComparisonReference] = useState(null);
  // Phase 19: Advanced Annotation Customization state
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [hiddenLayerIds, setHiddenLayerIds] = useState(new Set());
  const [lockedLayerIds, setLockedLayerIds] = useState(new Set());
  const [activeDrawStyle, setActiveDrawStyle] = useState(DEFAULT_ANNOTATION_STYLE);
  const [activeLayerId, setActiveLayerId] = useState('default');
  const [propertiesModalAnnotation, setPropertiesModalAnnotation] = useState(null);
  const [isLayerManagerOpen, setIsLayerManagerOpen] = useState(false);
  const [layerManagerAnchorEl, setLayerManagerAnchorEl] = useState(null);

  const handleToggleLayerManager = useCallback((anchorEl) => {
    setIsLayerManagerOpen((prev) => {
      if (prev) {
        setLayerManagerAnchorEl(null);
        return false;
      }
      setLayerManagerAnchorEl(anchorEl || null);
      return true;
    });
  }, []);

  const handleOpenLayerManager = useCallback((anchorEl) => {
    setLayerManagerAnchorEl(anchorEl || null);
    setIsLayerManagerOpen(true);
  }, []);

  const handleCloseLayerManager = useCallback(() => {
    setIsLayerManagerOpen(false);
    setLayerManagerAnchorEl(null);
  }, []);

  // Phase 22A: Image Review Productivity (Rotation, Magnifier, Recent Images)
  const [imageRotations, setImageRotations] = useState({});
  const [isMagnifierActive, setIsMagnifierActive] = useState(false);
  const [recentImageIds, setRecentImageIds] = useState(() => {
    if (!batchId) return [];
    try {
      const stored = localStorage.getItem(`fc_recent_images_${batchId}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const handleToggleMagnifier = useCallback(() => {
    setIsMagnifierActive((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!selectedImageId || !batchId) return;
    setRecentImageIds((prev) => {
      const filtered = prev.filter((id) => id !== selectedImageId);
      const next = [selectedImageId, ...filtered].slice(0, 15);
      try {
        localStorage.setItem(`fc_recent_images_${batchId}`, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [batchId, selectedImageId]);
  const prevReviewersMapRef = useRef(null);
  const pendingLeavesRef = useRef(new Map());
  const lastPresenceEventRef = useRef(new Map());
  const presenceMountedAtRef = useRef(Date.now());

  const handleToggleFocusMode = useCallback(() => {
    setIsFocusMode((prev) => {
      const next = !prev;
      if (next) {
        setIsPresentationMode(false);
      }
      return next;
    });
  }, []);

  const handleExitFocusMode = useCallback(() => {
    setIsFocusMode(false);
  }, []);

  const handleTogglePresentationMode = useCallback(() => {
    setIsPresentationMode((prev) => {
      const next = !prev;
      if (next) {
        setIsFocusMode(false);
      }
      return next;
    });
  }, []);

  const handleExitPresentationMode = useCallback(() => {
    setIsPresentationMode(false);
  }, []);

  const addActivityItem = useCallback((newAct) => {
    if (!newAct || !newAct.id) return;
    setActivities((prev) => deduplicateAndSortActivities([newAct, ...prev]));
  }, []);

  const handleNavigateAnnotation = useCallback(
    ({ imageId, annotationId }) => {
      setIsSidebarVisible(true);
      setIsSidebarCollapsed(false);
      setSidebarMode('comments');
      setActiveTab('all');
      if (imageId && imageId !== selectedImageIdRef.current) {
        handleSelectImageRef.current?.(imageId, true);
      }
      setSelectedAnnotationId(annotationId);
    },
    []
  );

  const handleNavigateImage = useCallback(
    (imageId) => {
      if (imageId && imageId !== selectedImageIdRef.current) {
        handleSelectImageRef.current?.(imageId, true);
      }
    },
    []
  );

  const handleNavigateWhiteboard = useCallback(
    (targetBatchId, elementId) => {
      const bId = targetBatchId || batchId;
      const query = elementId ? `?element=${encodeURIComponent(elementId)}` : '';
      navigate(`/batches/${bId}/whiteboard${query}`);
    },
    [batchId, navigate]
  );

  const handleRetryActivities = useCallback(async () => {
    if (!batchId) return;
    setActivitiesLoading(true);
    setActivitiesError('');
    try {
      const feed = await fetchBatchActivityFeed({ batchId });
      setActivities((prev) => deduplicateAndSortActivities([...feed, ...prev]));
    } catch (err) {
      setActivitiesError(err?.message || 'Failed to load activity feed');
    } finally {
      setActivitiesLoading(false);
    }
  }, [batchId]);

  const followingUserIdRef = useRef(null);
  followingUserIdRef.current = followingUserId;
  const selectedImageIdRef = useRef(selectedImageId);
  selectedImageIdRef.current = selectedImageId;
  const handleSelectImageRef = useRef(null);
  const loadReferencesRef = useRef(null);
  const localSessionIdRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  );
  const realtimeSubRef = useRef(null);
  const lastCursorSentRef = useRef(0);
  const lastViewportSentRef = useRef(0);

  const userColor = useMemo(
    () => getReviewerColor(currentUserId || creatorNameFallback),
    [currentUserId, creatorNameFallback]
  );

  const loadSeqRef = useRef(0);
  const mutationQueueRef = useRef(Promise.resolve());
  const batchImageIdsRef = useRef(new Set());
  const creatorNameCacheRef = useRef(new Map());
  const inFlightNameLookupsRef = useRef(new Map());
  const localMutationIdsRef = useRef(new Map());
  const pendingLookupAnnotationIdsRef = useRef(new Set());
  const wasDisconnectedRef = useRef(false);

  const canReviewRef = useRef(canReview);
  canReviewRef.current = canReview;
  const creatorNameFallbackRef = useRef(creatorNameFallback);
  creatorNameFallbackRef.current = creatorNameFallback;
  const userRoleRef = useRef(profile?.role);
  userRoleRef.current = profile?.role;
  const userColorRef = useRef(userColor);
  userColorRef.current = userColor;
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const subscriptionSeqRef = useRef(0);

  useEffect(() => {
    if (isReadOnlyMode) {
      setDraftAnnotation(null);
      setSelectedAnnotationId(null);
      setToolMode('select');
    }
  }, [isReadOnlyMode]);

  // Focus Mode & Presentation Mode keyboard shortcuts (customizable key to toggle, Escape to exit)
  // Available to all roles including uploaders in read-only mode
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Prevent unintended repeated toggling from held keys or while modal open
      if (
        event.repeat ||
        isShortcutsModalOpen ||
        isTemplatesModalOpen ||
        isPreferencesModalOpen ||
        isExportModalOpen ||
        isOnboardingModalOpen
      ) return;

      // Do not intercept shortcuts when typing in form controls
      const active = document.activeElement;
      if (active) {
        const tag = active.tagName ? active.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || active.isContentEditable) {
          return;
        }
      }

      if (matchesShortcut(event, userShortcuts.view_focus_mode || 'f')) {
        event.preventDefault();
        handleToggleFocusMode();
      } else if (event.key.toLowerCase() === 'p' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        handleTogglePresentationMode();
      } else if (event.key === 'Escape') {
        if (isPresentationMode) {
          event.preventDefault();
          setIsPresentationMode(false);
        } else if (isFocusMode) {
          event.preventDefault();
          setIsFocusMode(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isFocusMode,
    isPresentationMode,
    isShortcutsModalOpen,
    isTemplatesModalOpen,
    isPreferencesModalOpen,
    isExportModalOpen,
    isOnboardingModalOpen,
    userShortcuts,
    handleToggleFocusMode,
    handleTogglePresentationMode,
  ]);

  // Automatically restore and expand the comments sidebar when a draft annotation is initiated in normal mode
  useEffect(() => {
    if (draftAnnotation && !isFocusMode) {
      if (!isSidebarVisible) {
        setIsSidebarVisible(true);
      }
      if (isSidebarCollapsed) {
        setIsSidebarCollapsed(false);
      }
    }
  }, [draftAnnotation, isSidebarVisible, isSidebarCollapsed, isFocusMode]);

  // Phase 22C: Reliable Autosave Queue with Status Tracking & Failure Resilience
  const runQueuedSync = useCallback((task, annotationId = null) => {
    setPendingSyncCount((count) => count + 1);
    setAutosaveStatus('saving');

    const mutationTimestamp = Date.now();
    if (annotationId) {
      const prevCount = localMutationIdsRef.current.get(annotationId) ?? 0;
      localMutationIdsRef.current.set(annotationId, prevCount + 1);
      lastMutationTimestampRef.current.set(annotationId, mutationTimestamp);
    }

    const wrappedTask = async () => {
      try {
        const result = await task();
        return result;
      } catch (err) {
        console.error('[Autosave] Queued mutation task failed:', err);
        setAutosaveStatus('failed');
        failedSyncTasksRef.current.push({ task, annotationId });
        throw err;
      }
    };

    const run = mutationQueueRef.current.then(wrappedTask, wrappedTask);
    mutationQueueRef.current = run.catch(() => {});
    return run.finally(() => {
      if (annotationId) {
        const currentCount = localMutationIdsRef.current.get(annotationId) ?? 1;
        if (currentCount <= 1) {
          localMutationIdsRef.current.delete(annotationId);
        } else {
          localMutationIdsRef.current.set(annotationId, currentCount - 1);
        }
      }
      setPendingSyncCount((count) => {
        const next = Math.max(0, count - 1);
        if (next === 0 && failedSyncTasksRef.current.length === 0) {
          setAutosaveStatus('saved');
        }
        return next;
      });
    });
  }, []);

  const handleRetryAutosave = useCallback(async () => {
    if (failedSyncTasksRef.current.length === 0) {
      setAutosaveStatus('saved');
      return;
    }
    const toRetry = [...failedSyncTasksRef.current];
    failedSyncTasksRef.current = [];
    setAutosaveStatus('saving');
    for (const item of toRetry) {
      try {
        await runQueuedSync(item.task, item.annotationId);
      } catch (err) {
        // Will be re-added to failedSyncTasksRef by runQueuedSync if it fails again
      }
    }
  }, [runQueuedSync]);

  const withBusyAnnotation = useCallback(async (annotationId, task) => {
    setBusyAnnotationIds((prev) =>
      prev.includes(annotationId) ? prev : [...prev, annotationId]
    );
    try {
      return await task();
    } finally {
      setBusyAnnotationIds((prev) => prev.filter((id) => id !== annotationId));
    }
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    const requestSeq = ++loadSeqRef.current;
    setLoading(true);
    setAnnotationsLoading(true);
    setErrorMessage('');
    setActionError('');
    setDraftAnnotation(null);
    setSelectedAnnotationId(null);

    try {
      const batchRow = await getBatchById(batchId);
      if (requestSeq !== loadSeqRef.current) return;

      if (!batchRow) {
        setBatch(null);
        setImages([]);
        dispatchAnnotations({
          type: 'HYDRATE_BATCH_ANNOTATIONS',
          imageIds: [],
          annotations: [],
        });
        return;
      }

      setActivitiesLoading(true);
      setActivitiesError('');
      const [
        imageRows,
        annotationRows,
        mentionUsers,
        batchReactions,
        activityFeed,
        batchLayers,
        batchDiscussions,
        batchChecklists,
        batchReplacements,
      ] = await Promise.all([
        listBatchImages(batchId),
        listBatchAnnotations(batchId),
        listBatchMentionableUsers(batchId),
        listBatchReactions(batchId),
        fetchBatchActivityFeed({ batchId }).catch((err) => {
          console.warn('Failed to load batch activity feed:', err);
          setActivitiesError(err?.message || 'Failed to load activity feed');
          return [];
        }),
        listBatchLayers(batchId).catch((err) => {
          console.warn('Failed to load batch layers:', err);
          return DEFAULT_LAYERS;
        }),
        listBatchDiscussions(batchId).catch((err) => {
          console.warn('Failed to load batch discussions:', err);
          return {};
        }),
        fetchBatchChecklists(batchId, currentUserId).catch((err) => {
          console.warn('Failed to load batch checklists:', err);
          return [];
        }),
        listBatchPendingReplacements(batchId).catch((err) => {
          console.warn('Failed to load pending image replacements:', err);
          return [];
        }),
      ]);
      setActivitiesLoading(false);
      if (requestSeq !== loadSeqRef.current) return;

      const requestedId = new URLSearchParams(window.location.search).get('image');
      batchImageIdsRef.current = new Set(imageRows.map((img) => img.id));
      pendingLookupAnnotationIdsRef.current.clear();

      if (currentUserId && creatorNameFallback) {
        creatorNameCacheRef.current.set(currentUserId, creatorNameFallback);
      }
      for (const ann of annotationRows) {
        if (ann.createdBy && ann.creatorName) {
          creatorNameCacheRef.current.set(ann.createdBy, ann.creatorName);
        }
      }

      setBatch(batchRow);
      setImages(imageRows);
      setPendingReplacements(batchReplacements || []);
      setMentionableUsers(mentionUsers || []);
      setReactionsByAnnotation(batchReactions || {});
      setDiscussionsByAnnotation(batchDiscussions || {});
      setChecklists(batchChecklists || []);
      setActivities(activityFeed || []);
      setLayers(batchLayers && batchLayers.length > 0 ? batchLayers : DEFAULT_LAYERS);
      dispatchAnnotations({
        type: 'HYDRATE_BATCH_ANNOTATIONS',
        imageIds: imageRows.map((img) => img.id),
        annotations: annotationRows,
      });
      setSelectedImageId((prevId) => {
        if (prevId && imageRows.some((img) => img.id === prevId)) {
          return prevId;
        }
        if (requestedId && imageRows.some((img) => img.id === requestedId)) {
          return requestedId;
        }
        return imageRows[0]?.id ?? null;
      });
    } catch (error) {
      if (requestSeq !== loadSeqRef.current) return;
      setErrorMessage(error?.message || 'Unable to load review workspace.');
    } finally {
      if (requestSeq === loadSeqRef.current) {
        setLoading(false);
        setAnnotationsLoading(false);
      }
    }
  }, [batchId]);

  useEffect(() => {
    loadWorkspaceData();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [loadWorkspaceData]);

  useEffect(() => {
    if (!batch?.id || !currentUserId) return undefined;

    const subSeq = ++subscriptionSeqRef.current;
    let isDisposed = false;
    let isIntentionalCleanup = false;
    wasDisconnectedRef.current = false;
    setRealtimeNotice('');

    const resolveCreatorName = async (userId) => {
      if (!userId) return 'Reviewer';
      const cached = creatorNameCacheRef.current.get(userId);
      if (cached) return cached;

      const existingLookup = inFlightNameLookupsRef.current.get(userId);
      if (existingLookup) return existingLookup;

      const lookupPromise = fetchCreatorDisplayName(userId)
        .then((name) => {
          const resolved = name || 'Reviewer';
          creatorNameCacheRef.current.set(userId, resolved);
          return resolved;
        })
        .catch(() => 'Reviewer')
        .finally(() => {
          inFlightNameLookupsRef.current.delete(userId);
        });

      inFlightNameLookupsRef.current.set(userId, lookupPromise);
      return lookupPromise;
    };

    const resyncBatchAfterReconnect = async () => {
      try {
        const [
          imageRows,
          annotationRows,
          batchReactions,
          refreshedActivities,
          refreshedLayers,
          refreshedReplacements,
        ] = await Promise.all([
          listBatchImages(batch.id),
          listBatchAnnotations(batch.id),
          listBatchReactions(batch.id),
          fetchBatchActivityFeed({ batchId: batch.id }).catch(() => []),
          listBatchLayers(batch.id).catch(() => DEFAULT_LAYERS),
          listBatchPendingReplacements(batch.id).catch(() => []),
        ]);
        if (isDisposed || isIntentionalCleanup || subSeq !== subscriptionSeqRef.current) return;

        batchImageIdsRef.current = new Set(imageRows.map((img) => img.id));
        for (const ann of annotationRows) {
          if (ann.createdBy && ann.creatorName) {
            creatorNameCacheRef.current.set(ann.createdBy, ann.creatorName);
          }
        }
        setImages(imageRows);
        setPendingReplacements(refreshedReplacements || []);
        setReactionsByAnnotation(batchReactions || {});
        if (refreshedActivities && refreshedActivities.length > 0) {
          setActivities((prev) => deduplicateAndSortActivities([...refreshedActivities, ...prev]));
        }
        if (refreshedLayers && refreshedLayers.length > 0) {
          setLayers(refreshedLayers);
        }
        dispatchAnnotations({
          type: 'RESYNC_BATCH_ANNOTATIONS',
          imageIds: imageRows.map((img) => img.id),
          annotations: annotationRows,
        });
      } catch {
        if (!isDisposed && !isIntentionalCleanup && subSeq === subscriptionSeqRef.current) {
          setRealtimeNotice(
            'Reconnected to live sync, but refreshing latest changes failed. Reload if needed.'
          );
        }
      }
    };

    const handleRealtimeUpsert = async (rawRow) => {
      if (
        isDisposed ||
        isIntentionalCleanup ||
        subSeq !== subscriptionSeqRef.current ||
        !rawRow?.id
      ) {
        return;
      }
      if (!batchImageIdsRef.current.has(rawRow.image_id)) return;
      if ((localMutationIdsRef.current.get(rawRow.id) ?? 0) > 0) return;

      const existing = getImageAnnotationState(
        annotationsByImageRef.current,
        rawRow.image_id
      ).annotations.find((item) => item.id === rawRow.id);

      const existingMs = existing?.updatedAt
        ? Date.parse(existing.updatedAt)
        : Number.NaN;
      const incomingMs = rawRow.updated_at
        ? Date.parse(rawRow.updated_at)
        : Number.NaN;

      if (
        Number.isFinite(existingMs) &&
        Number.isFinite(incomingMs) &&
        existingMs > incomingMs
      ) {
        return;
      }

      const incomingGeometry =
        rawRow.geometry && Object.keys(rawRow.geometry).length > 0
          ? rawRow.geometry
          : {
              type: 'circle',
              cx: Number(rawRow.cx),
              cy: Number(rawRow.cy),
              r: Number(rawRow.r),
            };

      if (
        existing &&
        existingMs === incomingMs &&
        existing.comment === (rawRow.comment ?? '') &&
        existing.status === (rawRow.status === 'resolved' ? 'resolved' : 'open') &&
        existing.color === String(rawRow.color || '#dc2626').toLowerCase() &&
        !hasGeometryChanged(existing.geometry || existing, incomingGeometry) &&
        JSON.stringify(existing.style || {}) === JSON.stringify(rawRow.style || {}) &&
        JSON.stringify(existing.customProperties || []) === JSON.stringify(rawRow.custom_properties || []) &&
        JSON.stringify(existing.labels || []) === JSON.stringify(rawRow.labels || []) &&
        (existing.layerId || 'default') === (rawRow.layer_id || 'default') &&
        (existing.assignedTo || null) === (rawRow.assigned_to || null) &&
        (existing.priority || 'medium') === (rawRow.priority || 'medium')
      ) {
        return;
      }

      let creatorName =
        existing?.creatorName ||
        creatorNameCacheRef.current.get(rawRow.created_by) ||
        '';

      if (!creatorName && rawRow.created_by) {
        pendingLookupAnnotationIdsRef.current.add(rawRow.id);
        creatorName = await resolveCreatorName(rawRow.created_by);
        const stillActive = pendingLookupAnnotationIdsRef.current.delete(rawRow.id);
        if (
          isDisposed ||
          isIntentionalCleanup ||
          subSeq !== subscriptionSeqRef.current ||
          !stillActive
        ) {
          return;
        }
        if ((localMutationIdsRef.current.get(rawRow.id) ?? 0) > 0) return;
      }

      const mapped = mapAnnotationRow(rawRow, creatorName);
      if (!mapped) return;

      if (mapped.assignedTo && !mapped.assigneeName) {
        const found = mentionableUsersRef.current?.find((u) => u.id === mapped.assignedTo);
        mapped.assigneeName = found?.displayName || creatorNameCacheRef.current.get(mapped.assignedTo) || 'Reviewer';
      }

      if (mapped.createdBy && mapped.creatorName) {
        creatorNameCacheRef.current.set(mapped.createdBy, mapped.creatorName);
      }

      dispatchAnnotations({
        type: 'UPSERT_ANNOTATION',
        imageId: mapped.imageId,
        annotation: mapped,
      });

      const targetImg = imagesRef.current.find((im) => im.id === mapped.imageId);
      const imgPos = targetImg?.display_order || targetImg?.position || null;
      const fallbackReviewerName = creatorNameFallbackRef.current || 'Reviewer';
      if (existing) {
        if (mapped.status === 'resolved' && existing.status !== 'resolved') {
          addActivityItem({
            id: `ann-resolved-${mapped.id}-${Date.now()}`,
            eventType: 'annotation_resolved',
            occurredAt: mapped.resolvedAt || new Date().toISOString(),
            actorId: mapped.resolvedBy || mapped.createdBy,
            actorName: creatorName || fallbackReviewerName,
            imageId: mapped.imageId,
            imageFilename: targetImg?.original_filename || '',
            imagePosition: imgPos,
            annotationId: mapped.id,
            annotationNumber: mapped.annotationNumber,
            details: 'Resolved feedback',
            metadata: { type: mapped.type || 'circle' },
          });
        } else if (mapped.status === 'open' && existing.status === 'resolved') {
          addActivityItem({
            id: `ann-reopened-${mapped.id}-${Date.now()}`,
            eventType: 'annotation_reopened',
            occurredAt: new Date().toISOString(),
            actorId: mapped.createdBy,
            actorName: creatorName || fallbackReviewerName,
            imageId: mapped.imageId,
            imageFilename: targetImg?.original_filename || '',
            imagePosition: imgPos,
            annotationId: mapped.id,
            annotationNumber: mapped.annotationNumber,
            details: 'Reopened feedback',
            metadata: { type: mapped.type || 'circle' },
          });
        }

        // Distinctly check comment update vs geometry update
        if (mapped.comment && existing.comment && mapped.comment !== existing.comment) {
          addActivityItem({
            id: `comment-added-${mapped.id}-${Date.now()}`,
            eventType: 'comment_added',
            occurredAt: mapped.updatedAt || new Date().toISOString(),
            actorId: mapped.createdBy,
            actorName: creatorName || fallbackReviewerName,
            imageId: mapped.imageId,
            imageFilename: targetImg?.original_filename || '',
            imagePosition: imgPos,
            annotationId: mapped.id,
            annotationNumber: mapped.annotationNumber,
            details: mapped.comment,
            metadata: { type: mapped.type || 'circle' },
          });
        }

        if (hasGeometryChanged(existing.geometry, mapped.geometry)) {
          addActivityItem({
            id: `ann-geom-${mapped.id}-${Date.now()}`,
            eventType: 'annotation_geometry_edited',
            occurredAt: mapped.updatedAt || new Date().toISOString(),
            actorId: mapped.createdBy,
            actorName: creatorName || fallbackReviewerName,
            imageId: mapped.imageId,
            imageFilename: targetImg?.original_filename || '',
            imagePosition: imgPos,
            annotationId: mapped.id,
            annotationNumber: mapped.annotationNumber,
            details: 'Updated annotation geometry',
            metadata: { type: mapped.type || 'circle' },
          });
        }
      } else {
        addActivityItem({
          id: `ann-created-${mapped.id}`,
          eventType: 'annotation_created',
          occurredAt: mapped.createdAt || new Date().toISOString(),
          actorId: mapped.createdBy,
          actorName: creatorName || fallbackReviewerName,
          imageId: mapped.imageId,
          imageFilename: targetImg?.original_filename || '',
          imagePosition: imgPos,
          annotationId: mapped.id,
          annotationNumber: mapped.annotationNumber,
          details: mapped.comment,
          metadata: { type: mapped.type || 'circle', status: mapped.status },
        });
      }
    };

    const handleRealtimeDelete = ({ annotationId, imageId }) => {
      if (
        isDisposed ||
        isIntentionalCleanup ||
        subSeq !== subscriptionSeqRef.current ||
        !annotationId ||
        !batchImageIdsRef.current.has(imageId)
      ) {
        return;
      }
      pendingLookupAnnotationIdsRef.current.delete(annotationId);
      if ((localMutationIdsRef.current.get(annotationId) ?? 0) > 0) {
        return;
      }

      dispatchAnnotations({
        type: 'REMOVE_ANNOTATION',
        imageId,
        annotationId,
      });
      setSelectedAnnotationId((prevId) =>
        prevId === annotationId ? null : prevId
      );
    };

    const handleRealtimeBatchImageChange = (eventType, imageRow) => {
      if (
        isDisposed ||
        isIntentionalCleanup ||
        subSeq !== subscriptionSeqRef.current ||
        !imageRow?.id ||
        imageRow.batch_id !== batch.id
      ) {
        return;
      }
      batchImageIdsRef.current.add(imageRow.id);

      setImages((prev) => {
        const index = prev.findIndex((item) => item.id === imageRow.id);
        if (index >= 0) {
          const existing = prev[index];
          if (
            existing.is_completed === imageRow.is_completed &&
            existing.completed_at === imageRow.completed_at &&
            existing.display_order === imageRow.display_order &&
            existing.replacement_status === imageRow.replacement_status &&
            existing.current_version_number === imageRow.current_version_number &&
            existing.storage_path === imageRow.storage_path
          ) {
            return prev;
          }
          if (imageRow.is_completed && imageRow.completed_at && !existing.is_completed) {
            addActivityItem({
              id: `img-completed-${imageRow.id}-${Date.now()}`,
              eventType: 'image_completed',
              occurredAt: imageRow.completed_at,
              actorId: imageRow.completed_by,
              actorName: 'Reviewer',
              imageId: imageRow.id,
              imageFilename: imageRow.original_filename,
              imagePosition: imageRow.position,
              details: `Marked image #${imageRow.position || 1} as completed`,
              metadata: { is_completed: true },
            });
          }
          const next = prev.slice();
          next[index] = imageRow;
          return next;
        }
        if (eventType === 'INSERT') {
          return [...prev, imageRow].sort(
            (a, b) => Number(a.display_order) - Number(b.display_order)
          );
        }
        return prev;
      });
    };

    const handleRealtimeReferenceChange = (payload) => {
      if (
        isDisposed ||
        isIntentionalCleanup ||
        subSeq !== subscriptionSeqRef.current ||
        !payload
      ) {
        return;
      }

      const { eventType, new: newRow, old: oldRow } = payload;
      const targetImageId = newRow?.image_id || oldRow?.image_id;

      if (targetImageId && targetImageId === selectedImageIdRef.current) {
        if (eventType === 'INSERT') {
          loadReferencesRef.current?.(targetImageId);
        } else if (eventType === 'UPDATE') {
          setReferences((prev) =>
            prev.map((r) => {
              if (r.id === newRow.id) {
                return {
                  ...r,
                  comment: newRow.comment,
                  updatedAt: newRow.updated_at,
                };
              }
              return r;
            })
          );
          setActiveViewerReference((prev) => {
            if (prev && prev.id === newRow.id) {
              return {
                ...prev,
                comment: newRow.comment,
                updatedAt: newRow.updated_at,
              };
            }
            return prev;
          });
          setComparisonReference((prev) => {
            if (prev && prev.id === newRow.id) {
              return {
                ...prev,
                comment: newRow.comment,
                updatedAt: newRow.updated_at,
              };
            }
            return prev;
          });
        } else if (eventType === 'DELETE') {
          const deletedId = oldRow?.id;
          if (deletedId) {
            setReferences((prev) => prev.filter((r) => r.id !== deletedId));
            setActiveViewerReference((prev) =>
              prev && prev.id === deletedId ? null : prev
            );
            setComparisonReference((prev) =>
              prev && prev.id === deletedId ? null : prev
            );
          }
        }
      }
    };

    const handleRealtimeLayerChange = () => {
      if (!batch?.id || isDisposed || isIntentionalCleanup) return;
      listBatchLayers(batch.id)
        .then((refreshed) => {
          if (!isDisposed && !isIntentionalCleanup && subSeq === subscriptionSeqRef.current) {
            if (refreshed && refreshed.length > 0) {
              setLayers(refreshed);
            }
          }
        })
        .catch((err) => {
          console.warn('Realtime layer update failed:', err);
        });
    };

    const presenceUser = canReviewRef.current
      ? {
          user_id: currentUserId,
          sessionId: localSessionIdRef.current,
          display_name: creatorNameFallbackRef.current,
          role: userRoleRef.current,
          color: userColorRef.current,
          selectedImageId: selectedImageIdRef.current,
          selectedAnnotationId: null,
          followingUserId: followingUserIdRef.current,
        }
      : null;

    const unsubscribe = subscribeToBatchReviewRealtime({
      batchId: batch.id,
      onAnnotationUpsert: handleRealtimeUpsert,
      onAnnotationDelete: handleRealtimeDelete,
      onBatchImageChange: handleRealtimeBatchImageChange,
      onReferenceImageChange: handleRealtimeReferenceChange,
      onLayerChange: handleRealtimeLayerChange,
      presenceUser,
      onPresenceSync: (reviewers) => {
        if (isDisposed || isIntentionalCleanup || subSeq !== subscriptionSeqRef.current) return;
        setActiveReviewers(reviewers);

        const now = Date.now();
        const isInitialHydration = now - presenceMountedAtRef.current < 2000;

        if (prevReviewersMapRef.current !== null && !isInitialHydration) {
          const prevMap = prevReviewersMapRef.current;
          reviewers.forEach((r) => {
            if (r.userId === currentUserId) return;

            // If this user was scheduled to leave, cancel it
            if (pendingLeavesRef.current.has(r.userId)) {
              clearTimeout(pendingLeavesRef.current.get(r.userId));
              pendingLeavesRef.current.delete(r.userId);
            } else if (!prevMap.has(r.userId)) {
              const lastJoin = lastPresenceEventRef.current.get(`${r.userId}-join`) || 0;
              if (now - lastJoin > 15000) {
                lastPresenceEventRef.current.set(`${r.userId}-join`, now);
                addActivityItem({
                  id: `presence-join-${r.userId}-${Math.floor(now / 30000)}`,
                  eventType: 'presence_joined',
                  occurredAt: new Date(now).toISOString(),
                  actorId: r.userId,
                  actorName: r.displayName || 'Reviewer',
                  details: 'joined the review workspace',
                  metadata: { role: r.role },
                });
              }
            }
          });

          prevMap.forEach((displayName, prevUserId) => {
            if (prevUserId === currentUserId) return;
            const stillPresent = reviewers.some((r) => r.userId === prevUserId);
            if (!stillPresent && !pendingLeavesRef.current.has(prevUserId)) {
              const timer = setTimeout(() => {
                pendingLeavesRef.current.delete(prevUserId);
                if (isDisposed || isIntentionalCleanup || subSeq !== subscriptionSeqRef.current) return;
                const lastLeave = lastPresenceEventRef.current.get(`${prevUserId}-leave`) || 0;
                const leaveNow = Date.now();
                if (leaveNow - lastLeave > 15000) {
                  lastPresenceEventRef.current.set(`${prevUserId}-leave`, leaveNow);
                  addActivityItem({
                    id: `presence-leave-${prevUserId}-${Math.floor(leaveNow / 30000)}`,
                    eventType: 'presence_left',
                    occurredAt: new Date(leaveNow).toISOString(),
                    actorId: prevUserId,
                    actorName: displayName || 'Reviewer',
                    details: 'left the review workspace',
                  });
                }
              }, 2500);
              pendingLeavesRef.current.set(prevUserId, timer);
            }
          });
        }
        prevReviewersMapRef.current = new Map(
          reviewers.map((r) => [r.userId, r.displayName])
        );

        const currentFollowId = followingUserIdRef.current;
        if (currentFollowId) {
          const followed = reviewers.find((r) => r.userId === currentFollowId);
          if (!followed) {
            setFollowingUserId(null);
            followingUserIdRef.current = null;
            unsubscribe.updatePresenceState({ following_user_id: null });
            setActionNotice(
              'The reviewer you were following has left the workspace.'
            );
          } else if (
            followed.selectedImageId &&
            followed.selectedImageId !== selectedImageIdRef.current
          ) {
            handleSelectImageRef.current?.(followed.selectedImageId, false);
            if (followed.viewport) {
              setExternalViewport(followed.viewport);
            }
          }
        }
      },
      onCursorBroadcast: (payload) => {
        if (
          isDisposed ||
          isIntentionalCleanup ||
          subSeq !== subscriptionSeqRef.current ||
          !payload ||
          !payload.userId
        ) {
          return;
        }
        if (
          payload.userId === currentUserId &&
          payload.sessionId === localSessionIdRef.current
        ) {
          return;
        }
        if (payload.imageId !== selectedImageIdRef.current) {
          return;
        }
        setRemoteCursors((prev) => ({
          ...prev,
          [payload.sessionId || payload.userId]: {
            userId: payload.userId,
            sessionId: payload.sessionId,
            displayName: payload.displayName || 'Reviewer',
            color:
              payload.color ||
              getReviewerColor(payload.userId || payload.displayName),
            x: payload.x,
            y: payload.y,
            imageId: payload.imageId,
            timestamp: Date.now(),
          },
        }));
      },
      onCursorLeave: (payload) => {
        if (isDisposed || isIntentionalCleanup || subSeq !== subscriptionSeqRef.current || !payload) return;
        const key = payload.sessionId || payload.userId;
        if (!key) return;
        setRemoteCursors((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      },
      onViewportBroadcast: (payload) => {
        if (
          isDisposed ||
          isIntentionalCleanup ||
          subSeq !== subscriptionSeqRef.current ||
          !payload ||
          !payload.userId
        ) {
          return;
        }
        if (payload.userId === followingUserIdRef.current) {
          if (
            payload.imageId &&
            payload.imageId !== selectedImageIdRef.current
          ) {
            handleSelectImageRef.current?.(payload.imageId, false);
          }
          if (payload.viewport) {
            setExternalViewport(payload.viewport);
          }
        }
      },
      onReactionChange: (event) => {
        if (isDisposed || isIntentionalCleanup || subSeq !== subscriptionSeqRef.current || !event) return;
        const { action, reaction } = event;
        const annId = reaction?.annotationId || reaction?.annotation_id;
        const rUserId = reaction?.userId || reaction?.user_id;
        const rEmoji = reaction?.emoji;
        if (!annId || !rUserId || !rEmoji) return;

        setReactionsByAnnotation((prev) => {
          const existingList = prev[annId] || [];
          if (action === 'added') {
            if (existingList.some((r) => r.userId === rUserId && r.emoji === rEmoji)) {
              return prev;
            }
            addActivityItem({
              id: `react-${reaction.id || `${annId}-${rUserId}-${rEmoji}`}`,
              eventType: 'reaction_added',
              occurredAt: reaction.createdAt || new Date().toISOString(),
              actorId: rUserId,
              actorName: 'Reviewer',
              annotationId: annId,
              details: rEmoji,
              metadata: { emoji: rEmoji },
            });
            return {
              ...prev,
              [annId]: [
                ...existingList,
                {
                  id: reaction.id || `${annId}-${rUserId}-${rEmoji}`,
                  annotationId: annId,
                  userId: rUserId,
                  emoji: rEmoji,
                  createdAt: reaction.createdAt || new Date().toISOString(),
                },
              ],
            };
          } else if (action === 'removed') {
            return {
              ...prev,
              [annId]: existingList.filter(
                (r) => !(r.userId === rUserId && r.emoji === rEmoji)
              ),
            };
          }
          return prev;
        });
      },
      onDiscussionChange: (event) => {
        if (isDisposed || isIntentionalCleanup || subSeq !== subscriptionSeqRef.current || !event) return;
        const { action, message, annotationId, messageId } = event;
        if (action === 'created' && message) {
          const annId = message.annotationId || message.annotation_id;
          if (!annId) return;

          let authorName = message.authorName || message.author?.display_name || '';
          if (!authorName) {
            authorName =
              mentionableUsersRef.current?.find((u) => u.id === (message.userId || message.user_id))?.displayName ||
              creatorNameCacheRef.current.get(message.userId || message.user_id) ||
              'Reviewer';
          }

          const normalizedMsg = {
            id: message.id,
            annotationId: annId,
            userId: message.userId || message.user_id,
            authorName,
            authorRole: message.authorRole || 'reviewer',
            message: message.message,
            createdAt: message.createdAt || message.created_at || new Date().toISOString(),
          };

          setDiscussionsByAnnotation((prev) => {
            const currentList = prev[annId] || [];
            if (currentList.some((m) => m.id === normalizedMsg.id)) {
              return prev;
            }
            return {
              ...prev,
              [annId]: [...currentList, normalizedMsg].sort(
                (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
              ),
            };
          });
        } else if (action === 'deleted' && annotationId && messageId) {
          setDiscussionsByAnnotation((prev) => {
            const currentList = prev[annotationId] || [];
            return {
              ...prev,
              [annotationId]: currentList.filter((m) => m.id !== messageId),
            };
          });
        }
      },
      onChecklistChange: (event) => {
        if (isDisposed || isIntentionalCleanup || subSeq !== subscriptionSeqRef.current || !event) return;
        const { action, checklistId, isCompleted, completedBy, completedByName, completedAt, item } = event;
        if (action === 'toggled' && checklistId) {
          setChecklists((prev) =>
            prev.map((c) =>
              c.id === checklistId
                ? { ...c, isCompleted, completedBy, completedByName, completedAt }
                : c
            )
          );
        } else if (action === 'added' && item) {
          setChecklists((prev) => {
            if (prev.some((c) => c.id === item.id)) return prev;
            return [...prev, item];
          });
        } else if (action === 'deleted' && (checklistId || item?.id)) {
          const targetId = checklistId || item?.id;
          setChecklists((prev) => prev.filter((c) => c.id !== targetId));
        } else {
          fetchBatchChecklists(batch.id, currentUserId)
            .then((fresh) => {
              if (fresh) setChecklists(fresh);
            })
            .catch(() => {});
        }
      },
      onStatusChange: (status, error) => {
        console.warn('[Realtime Status]', status, error);

        // Guard against obsolete subscriptions modifying current workspace state
        if (subSeq !== subscriptionSeqRef.current) {
          return;
        }

        // If this subscription has undergone intentional cleanup, ignore trailing status events
        if (isIntentionalCleanup || isDisposed) {
          return;
        }

        if (status === 'SUBSCRIBED') {
          setRealtimeNotice('');
          if (wasDisconnectedRef.current) {
            wasDisconnectedRef.current = false;
            resyncBatchAfterReconnect();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          wasDisconnectedRef.current = true;
          setRealtimeNotice(
            'Live collaboration connection interrupted. Attempting to reconnect…'
          );
        } else if (status === 'CLOSED') {
          // Unexpected closure while workspace is still active
          wasDisconnectedRef.current = true;
          setRealtimeNotice(
            'Live collaboration connection interrupted. Attempting to reconnect…'
          );
        }
      },
      onBatchActivityEvent: async (row) => {
        if (
          isDisposed ||
          isIntentionalCleanup ||
          subSeq !== subscriptionSeqRef.current ||
          !row ||
          row.batch_id !== batch.id
        ) {
          return;
        }
        const img = imagesRef.current.find((im) => im.id === row.image_id);
        let actorName = 'Reviewer';
        if (row.actor_id === currentUserId) {
          actorName = creatorNameFallbackRef.current;
        } else if (creatorNameCacheRef.current.has(row.actor_id)) {
          actorName = creatorNameCacheRef.current.get(row.actor_id);
        } else {
          actorName = await resolveCreatorName(row.actor_id);
          if (
            isDisposed ||
            isIntentionalCleanup ||
            subSeq !== subscriptionSeqRef.current
          ) {
            return;
          }
        }
        addActivityItem({
          id: row.id,
          eventType: row.event_type,
          occurredAt: row.occurred_at,
          actorId: row.actor_id,
          actorName,
          imageId: row.image_id,
          imageFilename: img?.original_filename || null,
          imagePosition: img?.display_order || img?.position || null,
          annotationId: row.annotation_id,
          annotationNumber: row.annotation_number,
          elementId: row.element_id,
          elementType: row.element_type,
          details: row.details,
          metadata: row.metadata || {},
        });
      },
    });

    realtimeSubRef.current = unsubscribe;

    const unsubVersionEvents = subscribeToBatchVersionEvents(batch.id, async (event) => {
      if (isDisposed || isIntentionalCleanup || subSeq !== subscriptionSeqRef.current) return;
      try {
        const [refreshedImages, refreshedPending, refreshedAnnotations] = await Promise.all([
          listBatchImages(batch.id),
          listBatchPendingReplacements(batch.id),
          listBatchAnnotations(batch.id),
        ]);
        if (isDisposed || isIntentionalCleanup || subSeq !== subscriptionSeqRef.current) return;
        setImages(refreshedImages);
        setPendingReplacements(refreshedPending);
        dispatchAnnotations({
          type: 'RESYNC_BATCH_ANNOTATIONS',
          imageIds: refreshedImages.map((img) => img.id),
          annotations: refreshedAnnotations,
        });
        if (event?.eventType === 'submitted') {
          setActionNotice('A replacement image version was submitted for review.');
        } else if (event?.eventType === 'approved') {
          setActionNotice('Replacement image was approved. Image updated to active.');
        } else if (event?.eventType === 'rejected') {
          setActionNotice('Replacement proposal was rejected.');
        }
      } catch (err) {
        console.warn('Realtime version event processing error:', err);
      }
    });

    return () => {
      isIntentionalCleanup = true;
      isDisposed = true;
      pendingLeavesRef.current.forEach((timer) => clearTimeout(timer));
      pendingLeavesRef.current.clear();
      realtimeSubRef.current = null;
      setActiveReviewers([]);
      setRemoteCursors({});
      unsubscribe();
      unsubVersionEvents();
    };
  }, [batch?.id, currentUserId]);

  // Synchronize dynamic profile or reviewer identity updates to presence state
  useEffect(() => {
    if (!realtimeSubRef.current || !canReview) return;
    realtimeSubRef.current.updatePresenceState?.({
      display_name: creatorNameFallback,
      role: profile?.role,
      color: userColor,
    });
  }, [canReview, creatorNameFallback, profile?.role, userColor]);

  const handleStopFollowing = useCallback(
    (reason = '') => {
      if (!followingUserIdRef.current) return;
      const prevFollowedId = followingUserIdRef.current;
      const followedUser = activeReviewers.find((r) => r.userId === prevFollowedId);
      setFollowingUserId(null);
      followingUserIdRef.current = null;
      realtimeSubRef.current?.updatePresenceState({ following_user_id: null });
      if (reason && reason !== 'user click') {
        const name = followedUser?.displayName || 'reviewer';
        setActionNotice(
          `Stopped following ${name}${
            reason === 'manual interaction' ? ' due to manual view interaction' : ''
          }.`
        );
      }
    },
    [activeReviewers]
  );

  const handleSelectImage = useCallback(
    (nextImageId, isManual = true) => {
      if (nextImageId === selectedImageId) return;
      if (draftAnnotation) {
        const confirmed = window.confirm(
          'You have an unsaved draft annotation on this image. Discard draft and navigate?'
        );
        if (!confirmed) return;
      }
      if (isManual && followingUserIdRef.current) {
        handleStopFollowing('manual navigation');
      }
      setSelectedImageId(nextImageId);
      setSelectedAnnotationId(null);
      setDraftAnnotation(null);
      if (nextImageId) {
        setSearchParams({ image: nextImageId }, { replace: true });
      }
    },
    [draftAnnotation, handleStopFollowing, selectedImageId, setSearchParams]
  );
  handleSelectImageRef.current = handleSelectImage;

  const lastProcessedLocationKeyRef = useRef('');

  // Synchronize URL query parameters (?image=...&annotation=...) for deep linking
  useEffect(() => {
    if (loading || !images.length) return;

    const paramImageId = searchParams.get('image');
    const paramAnnotationId = searchParams.get('annotation');
    const isNewNavigation = location.key !== lastProcessedLocationKeyRef.current;
    lastProcessedLocationKeyRef.current = location.key;

    let targetImageId = paramImageId;
    if (!targetImageId && paramAnnotationId) {
      for (const [imgId, entry] of Object.entries(annotationsByImageRef.current || {})) {
        if (entry?.annotations?.some((ann) => ann.id === paramAnnotationId)) {
          targetImageId = imgId;
          break;
        }
      }
    }

    if (targetImageId && targetImageId !== selectedImageIdRef.current) {
      const targetImageExists = images.some((img) => img.id === targetImageId);
      if (targetImageExists) {
        if (followingUserIdRef.current) {
          handleStopFollowing('deep link navigation');
        }
        setSelectedImageId(targetImageId);
        setDraftAnnotation(null);
      }
    }

    if (paramAnnotationId && isNewNavigation) {
      setSelectedAnnotationId(paramAnnotationId);
      setIsSidebarVisible(true);
      setIsSidebarCollapsed(false);
      setSidebarMode('comments');
      setActiveTab('all');
    }
  }, [searchParams, location.key, images, loading, handleStopFollowing]);

  const handleFollowReviewer = useCallback(
    (targetUserId) => {
      if (!canReview || !targetUserId || targetUserId === currentUserId) return;

      const targetUser = activeReviewers.find((r) => r.userId === targetUserId);
      if (!targetUser) return;

      // Loop detection: walk following chain to ensure no circular dependency
      let curr = targetUser;
      const visited = new Set([currentUserId]);
      let hasCycle = false;
      while (curr && curr.followingUserId) {
        if (visited.has(curr.followingUserId)) {
          hasCycle = true;
          break;
        }
        visited.add(curr.followingUserId);
        curr = activeReviewers.find((r) => r.userId === curr.followingUserId);
      }

      if (hasCycle) {
        setActionNotice(
          `Cannot follow ${targetUser.displayName} because it would create a circular follow loop.`
        );
        return;
      }

      setFollowingUserId(targetUserId);
      followingUserIdRef.current = targetUserId;
      realtimeSubRef.current?.updatePresenceState({ following_user_id: targetUserId });
      setActionNotice(
        `Now following ${targetUser.displayName}. Use Escape or pan/zoom to stop.`
      );

      if (
        targetUser.selectedImageId &&
        targetUser.selectedImageId !== selectedImageIdRef.current
      ) {
        handleSelectImage(targetUser.selectedImageId, false);
      }
      if (targetUser.viewport) {
        setExternalViewport(targetUser.viewport);
      }
    },
    [activeReviewers, canReview, currentUserId, handleSelectImage]
  );

  const handleCursorMove = useCallback(
    ({ x, y }) => {
      if (!canReview || !selectedImageId || !realtimeSubRef.current) return;
      const now = Date.now();
      if (now - lastCursorSentRef.current < 45) return;
      lastCursorSentRef.current = now;

      realtimeSubRef.current.sendCursor({
        userId: currentUserId,
        sessionId: localSessionIdRef.current,
        displayName: creatorNameFallback,
        color: userColor,
        imageId: selectedImageId,
        x,
        y,
      });
    },
    [canReview, creatorNameFallback, currentUserId, selectedImageId, userColor]
  );

  const handleCursorLeave = useCallback(() => {
    if (!canReview || !selectedImageId || !realtimeSubRef.current) return;
    realtimeSubRef.current.sendCursorLeave({
      userId: currentUserId,
      sessionId: localSessionIdRef.current,
      imageId: selectedImageId,
    });
  }, [canReview, currentUserId, selectedImageId]);

  const handleViewportChange = useCallback(
    (viewport) => {
      if (!canReview || !selectedImageId || !realtimeSubRef.current) return;
      if (followingUserIdRef.current) return;

      const now = Date.now();
      if (now - lastViewportSentRef.current < 45) return;
      lastViewportSentRef.current = now;

      realtimeSubRef.current.sendViewport({
        userId: currentUserId,
        sessionId: localSessionIdRef.current,
        imageId: selectedImageId,
        viewport,
      });
    },
    [canReview, currentUserId, selectedImageId]
  );

  const handleManualViewportInteraction = useCallback(() => {
    if (followingUserIdRef.current) {
      handleStopFollowing('manual interaction');
    }
  }, [handleStopFollowing]);

  const handleToggleReaction = useCallback(
    async (annotationId, emoji) => {
      if (!currentUserId || !annotationId || !emoji) return;

      let actionTaken = 'added';
      setReactionsByAnnotation((prev) => {
        const list = prev[annotationId] || [];
        const exists = list.some(
          (r) => r.userId === currentUserId && r.emoji === emoji
        );
        if (exists) {
          actionTaken = 'removed';
          return {
            ...prev,
            [annotationId]: list.filter(
              (r) => !(r.userId === currentUserId && r.emoji === emoji)
            ),
          };
        } else {
          actionTaken = 'added';
          return {
            ...prev,
            [annotationId]: [
              ...list,
              {
                id: `temp-${Date.now()}`,
                annotationId,
                userId: currentUserId,
                emoji,
                createdAt: new Date().toISOString(),
              },
            ],
          };
        }
      });

      realtimeSubRef.current?.sendReactionChange({
        action: actionTaken,
        reaction: {
          annotationId,
          userId: currentUserId,
          emoji,
        },
      });

      try {
        await toggleAnnotationReaction({
          annotationId,
          emoji,
          userId: currentUserId,
        });
      } catch (err) {
        console.error('Failed to toggle reaction:', err);
        listBatchReactions(batchId).then((data) => {
          setReactionsByAnnotation(data);
        });
      }
    },
    [batchId, currentUserId]
  );

  const allBatchAnnotations = useMemo(() => {
    const items = [];
    for (const img of images) {
      const entry = annotationsByImage[img.id];
      if (entry?.annotations?.length) {
        items.push(...entry.annotations);
      }
    }
    return items;
  }, [annotationsByImage, images]);

  const handleCreateDiscussionMessage = useCallback(
    async (annotationId, messageText) => {
      if (!canReview || !currentUserId || !batch?.id) {
        setActionError('Only authorized reviewers can participate in discussions.');
        return false;
      }
      const trimmed = (messageText || '').trim();
      if (!trimmed) {
        return false;
      }
      try {
        const newMsg = await createDiscussionMessage({
          batchId: batch.id,
          annotationId,
          userId: currentUserId,
          authorName: creatorNameFallback,
          authorRole: profile?.role || 'reviewer',
          message: trimmed,
          mentionableUsers,
        });

        setDiscussionsByAnnotation((prev) => {
          const currentList = prev[annotationId] || [];
          if (currentList.some((m) => m.id === newMsg.id)) return prev;
          return {
            ...prev,
            [annotationId]: [...currentList, newMsg].sort(
              (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
            ),
          };
        });

        realtimeSubRef.current?.sendDiscussionChange?.({
          action: 'created',
          message: newMsg,
        });

        const targetAnn = allBatchAnnotations.find((a) => a.id === annotationId);
        const targetImg = targetAnn ? images.find((img) => img.id === targetAnn.imageId) : null;
        recordActivityEvent({
          batchId: batch.id,
          eventType: 'comment_added',
          occurredAt: new Date().toISOString(),
          actorId: currentUserId,
          imageId: targetImg?.id,
          annotationId,
          annotationNumber: targetAnn?.displayNumber,
          details: `${creatorNameFallback} replied to #${targetAnn?.displayNumber || ''}: "${trimmed.slice(0, 100)}"`,
          metadata: { discussionId: newMsg.id, replyPreview: trimmed.slice(0, 100) },
        }).catch(() => {});

        return true;
      } catch (err) {
        setActionError(err?.message || 'Failed to post reply.');
        return false;
      }
    },
    [allBatchAnnotations, batch?.id, canReview, creatorNameFallback, currentUserId, images, mentionableUsers, profile?.role]
  );

  const handleDeleteDiscussionMessage = useCallback(
    async (annotationId, messageId) => {
      if (!canReview || !currentUserId || !batch?.id) return;
      try {
        const ok = await deleteDiscussionMessage({
          batchId: batch.id,
          annotationId,
          messageId,
        });
        if (ok) {
          setDiscussionsByAnnotation((prev) => {
            const currentList = prev[annotationId] || [];
            return {
              ...prev,
              [annotationId]: currentList.filter((m) => m.id !== messageId),
            };
          });
          realtimeSubRef.current?.sendDiscussionChange?.({
            action: 'deleted',
            annotationId,
            messageId,
          });
        }
      } catch (err) {
        setActionError(err?.message || 'Failed to delete message.');
      }
    },
    [batch?.id, canReview, currentUserId]
  );

  const handleToggleChecklistItem = useCallback(
    async (checklistId, isCompleted) => {
      if (!batch?.id || !currentUserId) return;
      const targetItem = checklists.find((c) => c.id === checklistId);
      const timestamp = isCompleted ? new Date().toISOString() : null;

      // Optimistic state update
      setChecklists((prev) =>
        prev.map((c) =>
          c.id === checklistId
            ? {
                ...c,
                isCompleted,
                completedBy: isCompleted ? currentUserId : null,
                completedByName: isCompleted ? creatorNameFallback : null,
                completedAt: timestamp,
              }
            : c
        )
      );

      try {
        await toggleChecklistItem({
          batchId: batch.id,
          checklistId,
          isCompleted,
          currentUserId,
          currentUserName: creatorNameFallback,
        });

        // Broadcast to Realtime peers
        realtimeSubRef.current?.sendChecklistChange?.({
          action: 'toggled',
          checklistId,
          isCompleted,
          completedBy: isCompleted ? currentUserId : null,
          completedByName: isCompleted ? creatorNameFallback : null,
          completedAt: timestamp,
        });

        // Record activity event
        if (targetItem) {
          recordActivityEvent({
            batchId: batch.id,
            eventType: isCompleted ? 'checklist_item_completed' : 'checklist_item_reopened',
            occurredAt: new Date().toISOString(),
            actorId: currentUserId,
            actorName: creatorNameFallback,
            details: targetItem.title,
            elementId: checklistId,
            metadata: { checklistId, isCompleted },
          })
            .then((act) => addActivityItem(act))
            .catch(() => {});
        }
      } catch (err) {
        console.error('Failed to toggle checklist item:', err);
        // Rollback optimistic update on error
        setChecklists((prev) =>
          prev.map((c) =>
            c.id === checklistId ? { ...c, isCompleted: !isCompleted } : c
          )
        );
      }
    },
    [batch?.id, checklists, creatorNameFallback, currentUserId]
  );

  const handleAddCustomChecklistItem = useCallback(
    async ({ title, description, category }) => {
      if (!batch?.id || !currentUserId || !title?.trim()) return;
      try {
        const newItem = await addCustomChecklistItem({
          batchId: batch.id,
          title,
          description,
          category,
          currentUserId,
        });
        if (newItem) {
          setChecklists((prev) => {
            if (prev.some((c) => c.id === newItem.id)) return prev;
            return [...prev, newItem];
          });
          realtimeSubRef.current?.sendChecklistChange?.({
            action: 'added',
            item: newItem,
          });
        }
      } catch (err) {
        console.error('Failed to add custom checklist item:', err);
        setActionError(err?.message || 'Failed to add custom criterion.');
      }
    },
    [batch?.id, currentUserId]
  );

  const handleDeleteChecklistItem = useCallback(
    async (checklistId) => {
      if (!batch?.id || !checklistId) return;
      try {
        const ok = await deleteChecklistItem({ batchId: batch.id, checklistId });
        if (ok) {
          setChecklists((prev) => prev.filter((c) => c.id !== checklistId));
          realtimeSubRef.current?.sendChecklistChange?.({
            action: 'deleted',
            checklistId,
          });
        }
      } catch (err) {
        console.error('Failed to delete checklist item:', err);
      }
    },
    [batch?.id]
  );

  // Sync selected image and selected annotation into presence state
  useEffect(() => {
    if (!realtimeSubRef.current || !canReview) return;
    realtimeSubRef.current.updatePresenceState({
      selected_image_id: selectedImageId,
      selected_annotation_id: selectedAnnotationId,
    });
  }, [selectedImageId, selectedAnnotationId, canReview]);

  // Clear remote cursors when switching images
  useEffect(() => {
    setRemoteCursors({});
  }, [selectedImageId]);

  // Purge remote cursors that have been idle for > 4.5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        let hasExpired = false;
        const next = {};
        for (const [key, cursor] of Object.entries(prev)) {
          if (now - cursor.timestamp < 4500) {
            next[key] = cursor;
          } else {
            hasExpired = true;
          }
        }
        return hasExpired ? next : prev;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Escape key shortcut to stop following
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && followingUserIdRef.current) {
        handleStopFollowing('esc key');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStopFollowing]);

  // Automatically dismiss action notice toast after 3.8s
  useEffect(() => {
    if (!actionNotice) return;
    const timer = setTimeout(() => {
      setActionNotice('');
    }, 3800);
    return () => clearTimeout(timer);
  }, [actionNotice]);

  const followingUser = useMemo(() => {
    if (!followingUserId) return null;
    return activeReviewers.find((r) => r.userId === followingUserId) || null;
  }, [activeReviewers, followingUserId]);

  const liveSelections = useMemo(() => {
    const list = [];
    for (const r of activeReviewers) {
      if (
        r.userId === currentUserId &&
        r.sessionId === localSessionIdRef.current
      ) {
        continue;
      }
      if (r.selectedImageId === selectedImageId && r.selectedAnnotationId) {
        list.push({
          annotationId: r.selectedAnnotationId,
          userId: r.userId,
          displayName: r.displayName || 'Reviewer',
          color: r.color || getReviewerColor(r.userId || r.displayName),
        });
      }
    }
    return list;
  }, [activeReviewers, currentUserId, selectedImageId]);

  const handleSelectAnnotation = useCallback(
    (annotationId, options = {}) => {
      if (!canReview) return;
      const { shiftKey = false } = options;
      if (!annotationId) {
        setSelectedAnnotationIds([]);
        return;
      }
      if (shiftKey) {
        setSelectedAnnotationIds((prev) => {
          if (prev.includes(annotationId)) {
            return prev.filter((id) => id !== annotationId);
          }
          return [...prev, annotationId];
        });
      } else {
        setSelectedAnnotationIds([annotationId]);
      }
    },
    [canReview]
  );

  const handleSelectAnnotationCard = useCallback(
    (annotation, options = {}) => {
      if (!annotation) return;
      const { shiftKey = false } = options;
      setActionError('');
      setDraftAnnotation(null);
      if (annotation.imageId !== selectedImageId) {
        handleSelectImage(annotation.imageId, true);
        setSelectedAnnotationIds([annotation.id]);
        return;
      }
      if (shiftKey && canReview) {
        setSelectedAnnotationIds((prev) => {
          if (prev.includes(annotation.id)) {
            return prev.filter((id) => id !== annotation.id);
          }
          return [...prev, annotation.id];
        });
      } else {
        setSelectedAnnotationIds([annotation.id]);
      }
    },
    [canReview, handleSelectImage, selectedImageId]
  );

  const selectedIndex = useMemo(
    () => images.findIndex((img) => img.id === selectedImageId),
    [images, selectedImageId]
  );

  const selectedImage = selectedIndex >= 0 ? images[selectedIndex] : null;
  const currentPosition = selectedIndex >= 0 ? selectedIndex + 1 : 0;

  const activePendingReplacement = useMemo(() => {
    if (!selectedImage) return null;
    return (
      pendingReplacements.find(
        (r) =>
          (selectedImage.pending_version_id && r.id === selectedImage.pending_version_id) ||
          r.imageId === selectedImage.id ||
          r.image_id === selectedImage.id
      ) || null
    );
  }, [pendingReplacements, selectedImage]);

  const handleReplacementDecisionCompleted = useCallback(
    async ({ approved, version }) => {
      if (!batch?.id) return;
      try {
        const [refreshedImages, refreshedPending, refreshedAnnotations] = await Promise.all([
          listBatchImages(batch.id),
          listBatchPendingReplacements(batch.id),
          listBatchAnnotations(batch.id),
        ]);
        setImages(refreshedImages);
        setPendingReplacements(refreshedPending);
        dispatchAnnotations({
          type: 'RESYNC_BATCH_ANNOTATIONS',
          imageIds: refreshedImages.map((img) => img.id),
          annotations: refreshedAnnotations,
        });
        if (approved) {
          setActionNotice(
            `Replacement approved! Image is now on Version ${version?.version_number || 'new'}. Review status reset to In Review.`
          );
        } else {
          setActionNotice('Replacement proposal was rejected. Original image remains active.');
        }
      } catch (err) {
        console.warn('Failed to refresh workspace after replacement decision:', err);
      }
    },
    [batch?.id]
  );

  // Phase 22A: Image Review Productivity & Rotation Management
  const currentRotation = selectedImage ? (imageRotations[selectedImage.id] || 0) : 0;

  const handleRotateCW = useCallback(() => {
    if (!selectedImage) return;
    setImageRotations((prev) => ({
      ...prev,
      [selectedImage.id]: ((prev[selectedImage.id] || 0) + 90) % 360,
    }));
  }, [selectedImage]);

  const handleRotateCCW = useCallback(() => {
    if (!selectedImage) return;
    setImageRotations((prev) => ({
      ...prev,
      [selectedImage.id]: ((prev[selectedImage.id] || 0) + 270) % 360,
    }));
  }, [selectedImage]);

  const handleResetRotation = useCallback(() => {
    if (!selectedImage) return;
    setImageRotations((prev) => ({
      ...prev,
      [selectedImage.id]: 0,
    }));
  }, [selectedImage]);

  const currentImageAnnotations = getImageAnnotationState(
    annotationsByImage,
    selectedImage?.id
  );

  const batchReviewStatus = useMemo(() => {
    const completedImageCount = images.filter((img) => img.is_completed).length;
    const totalAnnotationCount = allBatchAnnotations.length;
    const openAnnotationCount = allBatchAnnotations.filter(
      (ann) => ann.status !== 'resolved'
    ).length;

    return deriveBatchReviewStatus({
      imageCount: images.length,
      completedImageCount,
      totalAnnotationCount,
      openAnnotationCount,
    });
  }, [allBatchAnnotations, images]);

  const prevBatchReviewStatusRef = useRef(null);

  useEffect(() => {
    if (!batchReviewStatus || !batch?.id) return;
    if (prevBatchReviewStatusRef.current === null) {
      prevBatchReviewStatusRef.current = batchReviewStatus;
      return;
    }

    if (
      prevBatchReviewStatusRef.current !== REVIEW_STATUSES.REVIEW_COMPLETED &&
      batchReviewStatus === REVIEW_STATUSES.REVIEW_COMPLETED
    ) {
      recordActivityEvent({
        batchId: batch.id,
        eventType: 'batch_review_completed',
        actorId: currentUserId || batch.owner_id,
        actorName: creatorNameFallback,
        details: 'Completed review for all images in this batch',
        metadata: {
          total_images: images.length,
          total_annotations: allBatchAnnotations.length,
        },
      }).then((act) => {
        addActivityItem(act);
      });
    }
    prevBatchReviewStatusRef.current = batchReviewStatus;
  }, [
    batchReviewStatus,
    batch?.id,
    batch?.owner_id,
    currentUserId,
    creatorNameFallback,
    images.length,
    allBatchAnnotations.length,
    addActivityItem,
  ]);

  const selectedAnnotation = useMemo(
    () =>
      currentImageAnnotations.annotations.find(
        (ann) => ann.id === selectedAnnotationId
      ) ?? null,
    [currentImageAnnotations.annotations, selectedAnnotationId]
  );

  const canEditSelected = Boolean(
    canReview && currentUserId && selectedAnnotation?.createdBy === currentUserId
  );

  const handleCreateDraft = useCallback(
    ({ type = 'circle', geometry, color }) => {
      if (!canReview || !selectedImage?.id || !currentUserId) return;
      setActionError('');
      const normType = type || geometry?.type || 'circle';
      setDraftAnnotation({
        imageId: selectedImage.id,
        type: normType,
        geometry,
        cx: geometry?.cx ?? null,
        cy: geometry?.cy ?? null,
        r: geometry?.r ?? null,
        color,
        style: activeDrawStyle,
        layerId: activeLayerId,
        priority: reviewerPreferences.defaultPriority || 'medium',
        customProperties: [],
        labels: [],
      });
    },
    [
      activeDrawStyle,
      activeLayerId,
      canReview,
      currentUserId,
      reviewerPreferences.defaultPriority,
      selectedImage?.id,
    ]
  );

  const handleConfirmDraft = useCallback(
    async (commentText, options = {}) => {
      if (!canReview || !draftAnnotation || !currentUserId || isSubmittingDraft) {
        return;
      }

      if (draftAnnotation.type === 'callout') {
        const rawCalloutText = draftAnnotation.geometry?.calloutText;
        if (typeof rawCalloutText !== 'string' || rawCalloutText.replace(/\s+/g, '').length === 0) {
          setActionError('Please enter note text inside the callout on the image before saving.');
          return;
        }
        if (rawCalloutText.length > 2000) {
          setActionError('Callout note text cannot exceed 2000 characters.');
          return;
        }
      }

      let effectiveComment = commentText;
      let effectiveGeometry = draftAnnotation.geometry;

      if (draftAnnotation.type === 'textbox') {
        const boxText = String(draftAnnotation.geometry?.text || '').trim();
        if (boxText && (!commentText || !commentText.trim())) {
          effectiveComment = boxText;
        } else if (commentText && commentText.trim() && !boxText) {
          effectiveGeometry = {
            ...draftAnnotation.geometry,
            text: commentText.trim(),
            calloutText: commentText.trim(),
          };
        }
      }

      const draftPriority = options.priority || draftAnnotation.priority || 'medium';
      const draftAssignee = options.assignedTo || draftAnnotation.assignedTo || null;

      setIsSubmittingDraft(true);
      setActionError('');

      try {
        const saved = await runQueuedSync(() =>
          createAnnotation({
            imageId: draftAnnotation.imageId,
            createdBy: currentUserId,
            type: draftAnnotation.type || 'circle',
            geometry: effectiveGeometry || {
              type: 'circle',
              cx: draftAnnotation.cx,
              cy: draftAnnotation.cy,
              r: draftAnnotation.r,
            },
            color: draftAnnotation.color,
            comment: effectiveComment,
            creatorNameFallback,
            style: draftAnnotation.style || activeDrawStyle,
            layerId: draftAnnotation.layerId || activeLayerId || 'default',
            customProperties: draftAnnotation.customProperties || [],
            labels: draftAnnotation.labels || [],
            assignedTo: draftAssignee,
            priority: draftPriority,
            versionNumber: selectedImage?.current_version_number || 1,
            versionId: selectedImage?.current_version_id || null,
          })
        );

        dispatchAnnotations({
          type: 'UPSERT_ANNOTATION',
          imageId: saved.imageId,
          annotation: saved,
          historyCommand: {
            kind: 'CREATE',
            annotationId: saved.id,
            snapshot: saved,
          },
        });

        const targetImg = images.find((im) => im.id === saved.imageId);
        const imgPos = targetImg?.display_order || targetImg?.position || null;
        recordActivityEvent({
          batchId: batch.id,
          eventType: 'annotation_created',
          occurredAt: saved.createdAt || new Date().toISOString(),
          actorId: currentUserId,
          actorName: creatorNameFallback,
          imageId: saved.imageId,
          imageFilename: targetImg?.original_filename || '',
          imagePosition: imgPos,
          annotationId: saved.id,
          annotationNumber: saved.annotationNumber,
          details: saved.comment,
          metadata: { type: saved.type || 'circle', status: saved.status },
        }).then((act) => addActivityItem(act));

        const mentionedUserIds = extractMentionedUserIds(
          commentText,
          mentionableUsers
        );
        if (mentionedUserIds.length > 0) {
          syncAnnotationMentions({
            annotationId: saved.id,
            userIds: mentionedUserIds,
          }).catch(() => {});

          mentionedUserIds.forEach((uid) => {
            const targetUser = mentionableUsers.find((u) => u.id === uid);
            recordActivityEvent({
              batchId: batch.id,
              eventType: 'comment_mention',
              occurredAt: new Date().toISOString(),
              actorId: currentUserId,
              actorName: creatorNameFallback,
              imageId: saved.imageId,
              imageFilename: targetImg?.original_filename || '',
              imagePosition: imgPos,
              annotationId: saved.id,
              annotationNumber: saved.annotationNumber,
              details: `Mentioned @${targetUser?.display_name || 'reviewer'}`,
              metadata: { mentioned_user_id: uid, mentioned_name: targetUser?.display_name },
            }).then((act) => addActivityItem(act));
          });
        }

        setDraftAnnotation(null);
        if (reviewerPreferences.autoSelectNewAnnotation) {
          setSelectedAnnotationId(saved.id);
        } else {
          setSelectedAnnotationId(null);
        }
        setActiveTab((prevTab) => (prevTab === 'resolved' ? 'all' : prevTab));
      } catch (error) {
        setActionError(error?.message || 'Unable to save annotation.');
      } finally {
        setIsSubmittingDraft(false);
      }
    },
    [
      activeDrawStyle,
      activeLayerId,
      addActivityItem,
      batch?.id,
      canReview,
      creatorNameFallback,
      currentUserId,
      draftAnnotation,
      images,
      isSubmittingDraft,
      mentionableUsers,
      reviewerPreferences.autoSelectNewAnnotation,
      runQueuedSync,
    ]
  );

  const handleCancelDraft = useCallback(() => {
    if (isSubmittingDraft) return;
    setDraftAnnotation(null);
    setActionError('');
  }, [isSubmittingDraft]);

  const handleUpdateDraftGeometry = useCallback((geometry) => {
    setDraftAnnotation((prev) => (prev ? { ...prev, geometry } : null));
  }, []);

  const handleCommitGeometry = useCallback(
    async ({ annotationId, geometry }) => {
      if (!canReview || !selectedImage?.id || !currentUserId) return;
      const imageId = selectedImage.id;
      const target = getImageAnnotationState(
        annotationsByImageRef.current,
        imageId
      ).annotations.find((item) => item.id === annotationId);

      if (
        !target ||
        (target.createdBy !== currentUserId && profile?.role !== ROLES.ADMIN) ||
        target.status === 'resolved' ||
        lockedLayerIds.has(target.layerId || 'default')
      ) {
        return;
      }

      const beforeGeometry = target.geometry || {
        type: target.type || 'circle',
        cx: target.cx,
        cy: target.cy,
        r: target.r,
      };
      if (!hasGeometryChanged(beforeGeometry, geometry)) return;

      setActionError('');
      dispatchAnnotations({
        type: 'APPLY_GEOMETRY_OPTIMISTIC',
        imageId,
        annotationId,
        geometry,
      });

      try {
        await runQueuedSync(async () => {
          const updated = await updateAnnotationGeometry(
            annotationId,
            geometry,
            target.creatorName
          );
          dispatchAnnotations({
            type: 'UPSERT_ANNOTATION',
            imageId,
            annotation: updated,
            historyCommand: {
              kind: 'GEOMETRY',
              annotationId,
              beforeGeometry,
              afterGeometry: updated.geometry || {
                type: updated.type || 'circle',
                cx: updated.cx,
                cy: updated.cy,
                r: updated.r,
              },
            },
          });

          if (batch?.id) {
            recordActivityEvent({
              batchId: batch.id,
              eventType: 'annotation_geometry_edited',
              actorId: currentUserId,
              actorName: creatorNameFallback,
              imageId,
              imageFilename: selectedImage.original_filename,
              imagePosition: selectedImage.display_order || selectedImage.position || null,
              annotationId,
              annotationNumber: target.annotationNumber,
              details: 'Updated annotation geometry',
              metadata: { type: updated.type || 'circle' },
            }).then((act) => addActivityItem(act));
          }
        }, annotationId);
      } catch (error) {
        dispatchAnnotations({
          type: 'UPSERT_ANNOTATION',
          imageId,
          annotation: target,
        });
        setActionError(error?.message || 'Unable to save position.');
      }
    },
    [
      addActivityItem,
      batch?.id,
      canReview,
      creatorNameFallback,
      currentUserId,
      lockedLayerIds,
      profile?.role,
      runQueuedSync,
      selectedImage,
    ]
  );

  const handleCommitBulkMove = useCallback(
    async (items = []) => {
      if (!canReview || !selectedImage?.id || !currentUserId || !items.length) return;
      const imageId = selectedImage.id;
      const currentAnnotations = getImageAnnotationState(
        annotationsByImageRef.current,
        imageId
      ).annotations;

      const validItems = [];
      for (const item of items) {
        const annId = item.annotationId || item.id;
        const target = currentAnnotations.find((a) => a.id === annId);
        if (!target) continue;
        if (target.createdBy !== currentUserId && profile?.role !== ROLES.ADMIN) continue;
        if (target.status === 'resolved') continue;
        if (lockedLayerIds.has(target.layerId || 'default')) continue;

        const beforeGeometry = target.geometry || {
          type: target.type || 'circle',
          cx: target.cx,
          cy: target.cy,
          r: target.r,
        };
        if (!hasGeometryChanged(beforeGeometry, item.geometry)) continue;

        validItems.push({
          annotationId: annId,
          geometry: item.geometry,
          beforeGeometry,
          creatorName: target.creatorName,
        });
      }

      if (validItems.length === 0) return;

      setActionError('');
      // Optimistically apply all geometries
      validItems.forEach(({ annotationId, geometry }) => {
        dispatchAnnotations({
          type: 'APPLY_GEOMETRY_OPTIMISTIC',
          imageId,
          annotationId,
          geometry,
        });
      });

      try {
        await runQueuedSync(async () => {
          for (const { annotationId, geometry, creatorName } of validItems) {
            const updated = await updateAnnotationGeometry(
              annotationId,
              geometry,
              creatorName || creatorNameFallbackRef.current
            );
            dispatchAnnotations({
              type: 'UPSERT_ANNOTATION',
              imageId,
              annotation: updated,
            });
          }
        });
      } catch (err) {
        // Revert optimistic updates on failure
        validItems.forEach(({ annotationId, beforeGeometry }) => {
          dispatchAnnotations({
            type: 'APPLY_GEOMETRY_OPTIMISTIC',
            imageId,
            annotationId,
            geometry: beforeGeometry,
          });
        });
        setActionError(err?.message || 'Failed to move some annotations.');
      }
    },
    [canReview, selectedImage?.id, currentUserId, profile?.role, lockedLayerIds, runQueuedSync]
  );

  const handleColorSelect = useCallback(
    async (color) => {
      if (!canReview) return;
      if (selectedImage?.id && selectedAnnotation) {
        if (
          selectedAnnotation.createdBy !== currentUserId ||
          selectedAnnotation.status === 'resolved' ||
          selectedAnnotation.color === color
        ) {
          return;
        }

        const imageId = selectedImage.id;
        const beforeColor = selectedAnnotation.color;
        const previousTarget = selectedAnnotation;

        setActionError('');
        dispatchAnnotations({
          type: 'APPLY_COLOR_OPTIMISTIC',
          imageId,
          annotationId: selectedAnnotation.id,
          color,
        });

        try {
          await runQueuedSync(async () => {
            const updated = await updateAnnotationColor(
              selectedAnnotation.id,
              color,
              previousTarget.creatorName
            );
            dispatchAnnotations({
              type: 'UPSERT_ANNOTATION',
              imageId,
              annotation: updated,
              historyCommand: {
                kind: 'COLOR',
                annotationId: selectedAnnotation.id,
                beforeColor,
                afterColor: updated.color,
              },
            });
          }, selectedAnnotation.id);
        } catch (error) {
          dispatchAnnotations({
            type: 'UPSERT_ANNOTATION',
            imageId,
            annotation: previousTarget,
          });
          setActionError(error?.message || 'Unable to update annotation color.');
        }
        return;
      }

      setActiveDrawColor(color);
      setDraftAnnotation((prev) => (prev ? { ...prev, color } : null));
    },
    [canReview, currentUserId, runQueuedSync, selectedAnnotation, selectedImage?.id]
  );

  const executeHistoryStep = useCallback(
    async (direction) => {
      if (!canReview || !selectedImage?.id || !currentUserId) return;
      const imageId = selectedImage.id;
      const entry = getImageAnnotationState(
        annotationsByImageRef.current,
        imageId
      );
      const command =
        direction === 'undo'
          ? entry.history.past[entry.history.past.length - 1]
          : entry.history.future[0];

      if (!command) return;

      const currentTarget = entry.annotations.find(
        (a) => a.id === command.annotationId
      );

      if (currentTarget && currentTarget.status === 'resolved') {
        setActionError(
          'Cannot undo or redo changes on an annotation that has been resolved.'
        );
        return;
      }

      if (
        (command.kind === 'GEOMETRY' || command.kind === 'COLOR' || command.kind === 'STYLE' || command.kind === 'LABELS') &&
        !currentTarget
      ) {
        setActionError('The target annotation no longer exists in this image.');
        return;
      }

      if (
        currentTarget &&
        currentTarget.createdBy !== currentUserId &&
        profile?.role !== ROLES.ADMIN &&
        (command.kind === 'GEOMETRY' || command.kind === 'COLOR' || command.kind === 'STYLE' || command.kind === 'LABELS')
      ) {
        setActionError(
          'You can only undo or redo changes on annotations you created.'
        );
        return;
      }

      const successActionType =
        direction === 'undo' ? 'STEP_UNDO_SUCCESS' : 'STEP_REDO_SUCCESS';

      setActionError('');
      try {
        await runQueuedSync(async () => {
          const isUndo = direction === 'undo';

          if (
            (command.kind === 'CREATE' && isUndo) ||
            (command.kind === 'DELETE' && !isUndo)
          ) {
            await softDeleteAnnotation(
              command.annotationId,
              creatorNameFallback
            );
            dispatchAnnotations({
              type: successActionType,
              imageId,
              removedAnnotationId: command.annotationId,
            });
            setSelectedAnnotationId((prevId) =>
              prevId === command.annotationId ? null : prevId
            );
            return;
          }

          if (
            (command.kind === 'CREATE' && !isUndo) ||
            (command.kind === 'DELETE' && isUndo)
          ) {
            const restored = await restoreAnnotation(
              command.annotationId,
              command.snapshot?.creatorName || creatorNameFallback
            );
            dispatchAnnotations({
              type: successActionType,
              imageId,
              annotation: restored,
            });
            setSelectedAnnotationId(restored.id);
            return;
          }

          if (command.kind === 'GEOMETRY') {
            const targetGeom = isUndo
              ? command.beforeGeometry
              : command.afterGeometry;
            const updated = await updateAnnotationGeometry(
              command.annotationId,
              targetGeom,
              creatorNameFallback
            );
            dispatchAnnotations({
              type: successActionType,
              imageId,
              annotation: updated,
            });
            setSelectedAnnotationId(updated.id);
            return;
          }

          if (command.kind === 'COLOR') {
            const targetColor = isUndo ? command.beforeColor : command.afterColor;
            const updated = await updateAnnotationColor(
              command.annotationId,
              targetColor,
              creatorNameFallback
            );
            dispatchAnnotations({
              type: successActionType,
              imageId,
              annotation: updated,
            });
            setSelectedAnnotationId(updated.id);
            return;
          }

          if (command.kind === 'STYLE') {
            const targetStyle = isUndo ? command.beforeStyle : command.afterStyle;
            const updated = await updateAnnotationStyle({
              annotationId: command.annotationId,
              style: targetStyle,
              creatorNameFallback,
            });
            dispatchAnnotations({
              type: successActionType,
              imageId,
              annotation: updated,
            });
            setSelectedAnnotationId(updated.id);
            return;
          }

          if (command.kind === 'LABELS') {
            const targetLabels = isUndo ? command.beforeLabels : command.afterLabels;
            const updated = await updateAnnotationLabels({
              annotationId: command.annotationId,
              labels: targetLabels,
              creatorNameFallback,
            });
            dispatchAnnotations({
              type: successActionType,
              imageId,
              annotation: updated,
            });
            setSelectedAnnotationId(updated.id);
            return;
          }
        }, command.annotationId);
      } catch (error) {
        setActionError(
          error?.message ||
            `Unable to ${direction} the last annotation change.`
        );
      }
    },
    [canReview, creatorNameFallback, currentUserId, runQueuedSync, selectedImage?.id]
  );

  const handleUndo = useCallback(() => {
    if (!canReview) return;
    executeHistoryStep('undo');
  }, [canReview, executeHistoryStep]);

  const handleRedo = useCallback(() => {
    if (!canReview) return;
    executeHistoryStep('redo');
  }, [canReview, executeHistoryStep]);

  const handleDeleteAnnotation = useCallback(
    async (annotation) => {
      if (
        !canReview ||
        !annotation ||
        !currentUserId ||
        annotation.createdBy !== currentUserId ||
        annotation.status === 'resolved'
      ) {
        return;
      }

      setActionError('');
      await withBusyAnnotation(annotation.id, async () => {
        try {
          await runQueuedSync(async () => {
            await softDeleteAnnotation(annotation.id, annotation.creatorName);
            dispatchAnnotations({
              type: 'REMOVE_ANNOTATION',
              imageId: annotation.imageId,
              annotationId: annotation.id,
              historyCommand: {
                kind: 'DELETE',
                annotationId: annotation.id,
                snapshot: annotation,
              },
            });
            setSelectedAnnotationId((prevId) =>
              prevId === annotation.id ? null : prevId
            );
          }, annotation.id);
        } catch (error) {
          setActionError(error?.message || 'Unable to delete annotation.');
        }
      });
    },
    [canReview, currentUserId, runQueuedSync, withBusyAnnotation]
  );

  const handleDeleteSelected = useCallback(() => {
    if (!canReview || !selectedAnnotation) return;
    handleDeleteAnnotation(selectedAnnotation);
  }, [canReview, handleDeleteAnnotation, selectedAnnotation]);

  const handleSaveComment = useCallback(
    async (annotation, nextComment) => {
      if (
        !canReview ||
        !annotation ||
        !currentUserId ||
        annotation.createdBy !== currentUserId
      ) {
        return false;
      }

      setActionError('');
      return withBusyAnnotation(annotation.id, async () => {
        try {
          await runQueuedSync(async () => {
            const updated = await updateAnnotationComment(
              annotation.id,
              nextComment,
              annotation.creatorName
            );
            const mentionedUserIds = extractMentionedUserIds(
              nextComment,
              mentionableUsers
            );
            syncAnnotationMentions({
              annotationId: annotation.id,
              userIds: mentionedUserIds,
            }).catch(() => {});
            dispatchAnnotations({
              type: 'UPSERT_ANNOTATION',
              imageId: updated.imageId,
              annotation: updated,
            });

            const targetImg = images.find((im) => im.id === updated.imageId);
            const imgPos = targetImg?.display_order || targetImg?.position || null;
            recordActivityEvent({
              batchId: batch.id,
              eventType: 'comment_added',
              actorId: currentUserId,
              actorName: creatorNameFallback,
              imageId: updated.imageId,
              imageFilename: targetImg?.original_filename || '',
              imagePosition: imgPos,
              annotationId: updated.id,
              annotationNumber: updated.annotationNumber,
              details: updated.comment,
              metadata: { type: updated.type || 'circle' },
            }).then((act) => addActivityItem(act));

            if (mentionedUserIds.length > 0) {
              mentionedUserIds.forEach((uid) => {
                const targetUser = mentionableUsers.find((u) => u.id === uid);
                recordActivityEvent({
                  batchId: batch.id,
                  eventType: 'comment_mention',
                  occurredAt: new Date().toISOString(),
                  actorId: currentUserId,
                  actorName: creatorNameFallback,
                  imageId: updated.imageId,
                  imageFilename: targetImg?.original_filename || '',
                  imagePosition: imgPos,
                  annotationId: updated.id,
                  annotationNumber: updated.annotationNumber,
                  details: `Mentioned @${targetUser?.display_name || 'reviewer'}`,
                  metadata: { mentioned_user_id: uid, mentioned_name: targetUser?.display_name },
                }).then((act) => addActivityItem(act));
              });
            }
          }, annotation.id);
          return true;
        } catch (error) {
          setActionError(error?.message || 'Unable to update comment.');
          return false;
        }
      });
    },
    [
      addActivityItem,
      batch?.id,
      canReview,
      creatorNameFallback,
      currentUserId,
      images,
      mentionableUsers,
      runQueuedSync,
      withBusyAnnotation,
    ]
  );

  const handleToggleStatus = useCallback(
    async (annotation) => {
      if (
        !canReview ||
        !annotation ||
        !currentUserId ||
        annotation.createdBy !== currentUserId
      ) {
        return;
      }

      const nextStatus = annotation.status === 'resolved' ? 'open' : 'resolved';
      setActionError('');

      await withBusyAnnotation(annotation.id, async () => {
        try {
          await runQueuedSync(async () => {
            const updated = await setAnnotationStatus(
              annotation.id,
              nextStatus,
              annotation.creatorName
            );
            dispatchAnnotations({
              type: 'UPSERT_ANNOTATION',
              imageId: updated.imageId,
              annotation: updated,
            });

            const targetImg = images.find((im) => im.id === updated.imageId);
            const imgPos = targetImg?.display_order || targetImg?.position || null;
            recordActivityEvent({
              batchId: batch.id,
              eventType: nextStatus === 'resolved' ? 'annotation_resolved' : 'annotation_reopened',
              actorId: currentUserId,
              actorName: creatorNameFallback,
              imageId: updated.imageId,
              imageFilename: targetImg?.original_filename || '',
              imagePosition: imgPos,
              annotationId: updated.id,
              annotationNumber: updated.annotationNumber,
              details: nextStatus === 'resolved' ? 'Resolved feedback' : 'Reopened feedback',
              metadata: { type: updated.type || 'circle' },
            }).then((act) => addActivityItem(act));
          }, annotation.id);
        } catch (error) {
          setActionError(
            error?.message || 'Unable to update annotation resolution status.'
          );
        }
      });
    },
    [
      addActivityItem,
      batch?.id,
      canReview,
      creatorNameFallback,
      currentUserId,
      images,
      runQueuedSync,
      withBusyAnnotation,
    ]
  );

  const handleUpdateAnnotationStyle = useCallback(
    async (annotationId, nextStyle) => {
      if (!canReview || !currentUserId) return;
      const target = allBatchAnnotations.find((a) => a.id === annotationId);
      if (!target) return;
      if (target.createdBy !== currentUserId && profile?.role !== ROLES.ADMIN) {
        setActionError('Only the annotation creator or an Admin can modify styles.');
        return;
      }
      dispatchAnnotations({
        type: 'APPLY_STYLE_OPTIMISTIC',
        imageId: target.imageId,
        annotationId,
        style: nextStyle,
      });
      try {
        const saved = await runQueuedSync(() =>
          updateAnnotationStyle({
            annotationId,
            style: nextStyle,
            creatorNameFallback,
          })
        );
        if (saved) {
          dispatchAnnotations({
            type: 'UPSERT_ANNOTATION',
            imageId: saved.imageId,
            annotation: saved,
            historyCommand: {
              kind: 'STYLE',
              annotationId,
              imageId: target.imageId,
              beforeStyle: target.style || DEFAULT_ANNOTATION_STYLE,
              afterStyle: nextStyle,
            },
          });
        }
      } catch (err) {
        setActionError(err?.message || 'Failed to update annotation style.');
        dispatchAnnotations({
          type: 'APPLY_STYLE_OPTIMISTIC',
          imageId: target.imageId,
          annotationId,
          style: target.style || {},
        });
      }
    },
    [allBatchAnnotations, canReview, creatorNameFallback, currentUserId, profile?.role, runQueuedSync]
  );

  const handleUpdateAnnotationCustomProperties = useCallback(
    async (annotationId, nextProperties) => {
      if (!canReview || !currentUserId) return;
      const target = allBatchAnnotations.find((a) => a.id === annotationId);
      if (!target) return;
      if (target.createdBy !== currentUserId && profile?.role !== ROLES.ADMIN) {
        setActionError('Only the annotation creator or an Admin can edit custom properties.');
        return;
      }
      dispatchAnnotations({
        type: 'APPLY_PROPERTIES_OPTIMISTIC',
        imageId: target.imageId,
        annotationId,
        customProperties: nextProperties,
      });
      try {
        const saved = await runQueuedSync(() =>
          updateAnnotationCustomProperties({ annotationId, customProperties: nextProperties })
        );
        if (saved) {
          dispatchAnnotations({
            type: 'UPSERT_ANNOTATION',
            imageId: saved.imageId,
            annotation: saved,
            historyCommand: {
              kind: 'LABELS',
              annotationId: saved.id,
              beforeLabels: target.labels || [],
              afterLabels: nextLabels,
            },
          });
        }
      } catch (err) {
        setActionError(err?.message || 'Failed to update custom properties.');
        dispatchAnnotations({
          type: 'APPLY_PROPERTIES_OPTIMISTIC',
          imageId: target.imageId,
          annotationId,
          customProperties: target.customProperties || [],
        });
      }
    },
    [allBatchAnnotations, canReview, currentUserId, profile?.role, runQueuedSync]
  );

  const handleUpdateAnnotationLabels = useCallback(
    async (annotationId, nextLabels) => {
      if (!canReview || !currentUserId) return;
      const target = allBatchAnnotations.find((a) => a.id === annotationId);
      if (!target) return;
      if (target.createdBy !== currentUserId && profile?.role !== ROLES.ADMIN) {
        setActionError('Only the annotation creator or an Admin can modify labels.');
        return;
      }
      dispatchAnnotations({
        type: 'APPLY_LABELS_OPTIMISTIC',
        imageId: target.imageId,
        annotationId,
        labels: nextLabels,
      });
      try {
        const saved = await runQueuedSync(() =>
          updateAnnotationLabels({ annotationId, labels: nextLabels })
        );
        if (saved) {
          dispatchAnnotations({
            type: 'UPSERT_ANNOTATION',
            imageId: saved.imageId,
            annotation: saved,
            historyCommand: {
              kind: 'LABELS',
              annotationId: saved.id,
              beforeLabels: target.labels || [],
              afterLabels: nextLabels,
            },
          });
        }
      } catch (err) {
        setActionError(err?.message || 'Failed to update labels.');
        dispatchAnnotations({
          type: 'APPLY_LABELS_OPTIMISTIC',
          imageId: target.imageId,
          annotationId,
          labels: target.labels || [],
        });
      }
    },
    [allBatchAnnotations, canReview, currentUserId, profile?.role, runQueuedSync]
  );

  const handleUpdateAnnotationLayer = useCallback(
    async (annotationId, nextLayerId) => {
      if (!canReview || !currentUserId) return;
      const target = allBatchAnnotations.find((a) => a.id === annotationId);
      if (!target) return;
      if (target.createdBy !== currentUserId && profile?.role !== ROLES.ADMIN) {
        setActionError('Only the annotation creator or an Admin can move annotations between layers.');
        return;
      }
      dispatchAnnotations({
        type: 'APPLY_LAYER_OPTIMISTIC',
        imageId: target.imageId,
        annotationId,
        layerId: nextLayerId,
      });
      try {
        const saved = await runQueuedSync(() =>
          updateAnnotationLayer({ annotationId, layerId: nextLayerId })
        );
        if (saved) {
          dispatchAnnotations({
            type: 'UPSERT_ANNOTATION',
            imageId: saved.imageId,
            annotation: saved,
            historyCommand: {
              kind: 'LABELS',
              annotationId: saved.id,
              beforeLabels: target.labels || [],
              afterLabels: nextLabels,
            },
          });
        }
      } catch (err) {
        setActionError(err?.message || 'Failed to update layer.');
        dispatchAnnotations({
          type: 'APPLY_LAYER_OPTIMISTIC',
          imageId: target.imageId,
          annotationId,
          layerId: target.layerId || 'default',
        });
      }
    },
    [allBatchAnnotations, canReview, currentUserId, profile?.role, runQueuedSync]
  );

  const handleUpdateAnnotationAssignment = useCallback(
    async (annotationId, nextAssigneeId) => {
      if (!canReview || !currentUserId) return;
      const target = allBatchAnnotations.find((a) => a.id === annotationId);
      if (!target) return;

      const isCreator = target.createdBy === currentUserId;
      const isCurrentAssignee = target.assignedTo === currentUserId;
      const isAdmin = profile?.role === ROLES.ADMIN;

      if (!isCreator && !isCurrentAssignee && !isAdmin) {
        setActionError('Only the current assignee, annotation creator, or an Admin can assign or hand off this annotation.');
        return;
      }

      const isHandoff = Boolean(target.assignedTo && nextAssigneeId && target.assignedTo !== nextAssigneeId);
      const prevUser = mentionableUsers.find((u) => u.id === target.assignedTo);
      const prevAssigneeName = target.assigneeName || prevUser?.displayName || 'Reviewer';
      const matchedUser = mentionableUsers.find((u) => u.id === nextAssigneeId);
      const nextAssigneeName = matchedUser?.displayName || (nextAssigneeId ? 'Reviewer' : null);

      dispatchAnnotations({
        type: 'APPLY_ASSIGNMENT_OPTIMISTIC',
        imageId: target.imageId,
        annotationId,
        assignedTo: nextAssigneeId || null,
        assigneeName: nextAssigneeName,
      });

      try {
        const saved = await runQueuedSync(() =>
          updateAnnotationAssignment({
            annotationId,
            assignedTo: nextAssigneeId,
            creatorNameFallback,
          })
        );
        if (saved) {
          dispatchAnnotations({
            type: 'UPSERT_ANNOTATION',
            imageId: saved.imageId,
            annotation: saved,
          });

          const targetImg = images.find((im) => im.id === saved.imageId);
          const imgPos = targetImg?.display_order || targetImg?.position || null;

          if (isHandoff) {
            recordHandoffActivity({
              batchId: batch.id,
              annotationId: saved.id,
              annotationNumber: saved.annotationNumber,
              imageId: target.imageId,
              imageFilename: targetImg?.original_filename || '',
              imagePosition: imgPos,
              actorId: currentUserId,
              actorName: creatorNameFallback,
              fromUserId: target.assignedTo,
              fromUserName: prevAssigneeName,
              toUserId: nextAssigneeId,
              toUserName: nextAssigneeName,
            })
              .then((act) => addActivityItem(act))
              .catch(() => {});
          } else {
            recordActivityEvent({
              batchId: batch.id,
              eventType: 'annotation_assigned',
              occurredAt: new Date().toISOString(),
              actorId: currentUserId,
              actorName: creatorNameFallback,
              imageId: target.imageId,
              imageFilename: targetImg?.original_filename || '',
              imagePosition: imgPos,
              annotationId: saved.id,
              annotationNumber: saved.annotationNumber,
              details: nextAssigneeId
                ? `Assigned #${saved.annotationNumber} to ${nextAssigneeName}`
                : `Unassigned #${saved.annotationNumber}`,
              metadata: { assignedTo: nextAssigneeId, assigneeName: nextAssigneeName },
            })
              .then((act) => addActivityItem(act))
              .catch(() => {});
          }
        }
      } catch (err) {
        setActionError(err?.message || 'Failed to update annotation assignment.');
        dispatchAnnotations({
          type: 'APPLY_ASSIGNMENT_OPTIMISTIC',
          imageId: target.imageId,
          annotationId,
          assignedTo: target.assignedTo || null,
          assigneeName: target.assigneeName || null,
        });
      }
    },
    [allBatchAnnotations, batch?.id, canReview, creatorNameFallback, currentUserId, images, mentionableUsers, profile?.role, runQueuedSync]
  );

  const handleUpdateAnnotationPriority = useCallback(
    async (annotationId, nextPriority) => {
      if (!canReview || !currentUserId) return;
      const target = allBatchAnnotations.find((a) => a.id === annotationId);
      if (!target) return;
      if (target.createdBy !== currentUserId && profile?.role !== ROLES.ADMIN) {
        setActionError('Only the annotation creator or an Admin can modify priority.');
        return;
      }

      dispatchAnnotations({
        type: 'APPLY_PRIORITY_OPTIMISTIC',
        imageId: target.imageId,
        annotationId,
        priority: nextPriority,
      });

      try {
        const saved = await runQueuedSync(() =>
          updateAnnotationPriority({
            annotationId,
            priority: nextPriority,
            creatorNameFallback,
          })
        );
        if (saved) {
          dispatchAnnotations({
            type: 'UPSERT_ANNOTATION',
            imageId: saved.imageId,
            annotation: saved,
          });

          const targetImg = images.find((im) => im.id === saved.imageId);
          const imgPos = targetImg?.display_order || targetImg?.position || null;
          recordActivityEvent({
            batchId: batch.id,
            eventType: 'annotation_priority_changed',
            occurredAt: new Date().toISOString(),
            actorId: currentUserId,
            actorName: creatorNameFallback,
            imageId: target.imageId,
            imageFilename: targetImg?.original_filename || '',
            imagePosition: imgPos,
            annotationId: saved.id,
            annotationNumber: saved.annotationNumber,
            details: `Set #${saved.annotationNumber} priority to ${nextPriority}`,
            metadata: { priority: nextPriority },
          }).then((act) => addActivityItem(act)).catch(() => {});
        }
      } catch (err) {
        setActionError(err?.message || 'Failed to update annotation priority.');
        dispatchAnnotations({
          type: 'APPLY_PRIORITY_OPTIMISTIC',
          imageId: target.imageId,
          annotationId,
          priority: target.priority || 'medium',
        });
      }
    },
    [allBatchAnnotations, batch?.id, canReview, creatorNameFallback, currentUserId, images, profile?.role, runQueuedSync]
  );

  const handleStyleChange = useCallback(
    (changes, targetAnnotationId) => {
      if (targetAnnotationId) {
        const target = allBatchAnnotations.find((a) => a.id === targetAnnotationId);
        const currentStyle = target?.style || DEFAULT_ANNOTATION_STYLE;
        const nextStyle = { ...currentStyle, ...changes };
        handleUpdateAnnotationStyle(targetAnnotationId, nextStyle);
      } else {
        setActiveDrawStyle((prev) => ({ ...prev, ...changes }));
      }
    },
    [allBatchAnnotations, handleUpdateAnnotationStyle]
  );

  // Phase 22C: Reusable Annotation Templates Handlers
  const handleApplyTemplateToAnnotation = useCallback(
    async (template, targetAnnotation) => {
      if (!targetAnnotation || !canReview || isReadOnlyMode) return;
      if (
        targetAnnotation.createdBy !== currentUserId &&
        profile?.role !== ROLES.ADMIN
      ) {
        setActionError('Only the annotation creator or an Admin can modify this annotation.');
        return;
      }
      if (lockedLayerIds.has(targetAnnotation.layerId || 'default')) {
        setActionError('Cannot modify annotation on a locked layer.');
        return;
      }

      const updated = applyTemplateToAnnotation(template, targetAnnotation);

      // Optimistic update
      dispatchAnnotations({
        type: 'UPSERT_ANNOTATION',
        imageId: targetAnnotation.imageId,
        annotation: updated,
      });

      try {
        await runQueuedSync(async () => {
          if (updated.color !== targetAnnotation.color) {
            await updateAnnotationColor(
              targetAnnotation.id,
              updated.color,
              targetAnnotation.creatorName || creatorNameFallbackRef.current
            );
          }
          await updateAnnotationStyle({
            annotationId: targetAnnotation.id,
            style: updated.style,
            creatorNameFallback: creatorNameFallbackRef.current,
          });
          if (updated.customProperties && Object.keys(updated.customProperties).length > 0) {
            await updateAnnotationCustomProperties({
              annotationId: targetAnnotation.id,
              customProperties: updated.customProperties,
              creatorNameFallback: creatorNameFallbackRef.current,
            });
          }
          if (updated.labels && updated.labels.length > 0) {
            await updateAnnotationLabels({
              annotationId: targetAnnotation.id,
              labels: updated.labels,
              creatorNameFallback: creatorNameFallbackRef.current,
            });
          }
        }, targetAnnotation.id);
        setActionNotice(
          `Applied template "${template.name}" to #${targetAnnotation.displayNumber}.`
        );
      } catch (err) {
        setActionError('Failed to apply template: ' + (err.message || 'Unknown error'));
        dispatchAnnotations({
          type: 'UPSERT_ANNOTATION',
          imageId: targetAnnotation.imageId,
          annotation: targetAnnotation,
        });
      }
    },
    [canReview, currentUserId, isReadOnlyMode, lockedLayerIds, profile?.role, runQueuedSync]
  );

  const handleApplyTemplateToDrawTools = useCallback(
    (template) => {
      if (!template) return;
      if (template.color) {
        setActiveDrawColor(template.color);
      }
      if (template.style) {
        setActiveDrawStyle((prev) => ({
          ...prev,
          ...template.style,
        }));
      }
      if (template.tool && template.tool !== 'any') {
        setToolMode(template.tool);
      }
      setActionNotice(`Active drawing style set from template "${template.name}".`);
    },
    []
  );

  const handleCreateLayer = useCallback(
    async ({ name, color }) => {
      if (!batchId || !canReview) return;
      try {
        const created = await createBatchLayer({
          batchId,
          name,
          color,
          displayOrder: layers.length + 1,
          createdBy: currentUserId,
        });
        setLayers((prev) => [...prev, created]);
        return created;
      } catch (err) {
        setActionError(err?.message || 'Failed to create layer.');
        throw err;
      }
    },
    [batchId, canReview, currentUserId, layers.length]
  );

  const handleUpdateLayer = useCallback(
    async (layerId, updates) => {
      if (!canReview) return;
      try {
        const updated = await updateBatchLayer({ layerId, updates });
        setLayers((prev) =>
          prev.map((l) => (l.id === layerId ? { ...l, ...updated } : l))
        );
        return updated;
      } catch (err) {
        setActionError(err?.message || 'Failed to update layer.');
        throw err;
      }
    },
    [canReview]
  );

  const handleDeleteLayer = useCallback(
    async (layerId) => {
      if (!canReview) return;
      try {
        await deleteBatchLayer(layerId);
        setLayers((prev) => prev.filter((l) => l.id !== layerId));
        if (activeLayerId === layerId) {
          setActiveLayerId('default');
        }
        setLockedLayerIds((prev) => {
          const next = new Set(prev);
          next.delete(layerId);
          return next;
        });
        setHiddenLayerIds((prev) => {
          const next = new Set(prev);
          next.delete(layerId);
          return next;
        });

        // Optimistically update all annotations on this deleted layer to 'default'
        images.forEach((img) => {
          const imgAnnotations = getImageAnnotationState(
            annotationsByImageRef.current,
            img.id
          ).annotations;
          imgAnnotations.forEach((ann) => {
            if (ann.layerId === layerId) {
              dispatchAnnotations({
                type: 'APPLY_LAYER_OPTIMISTIC',
                imageId: img.id,
                annotationId: ann.id,
                layerId: 'default',
              });
            }
          });
        });
      } catch (err) {
        setActionError(err?.message || 'Failed to delete layer.');
        throw err;
      }
    },
    [activeLayerId, canReview, images]
  );

  const handleToggleLayerVisibility = useCallback((layerId) => {
    setHiddenLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  }, []);

  const handleToggleAllLayersVisibility = useCallback((visible) => {
    setHiddenLayerIds((prev) => {
      if (visible) {
        return new Set();
      }
      return new Set(layers.map((l) => l.id));
    });
  }, [layers]);

  const handleToggleLayerLock = useCallback((layerId) => {
    setLockedLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  }, []);

  const handleToggleAllLayersLock = useCallback((lockAll) => {
    if (lockAll) {
      setLockedLayerIds(new Set(layers.map((l) => l.id)));
    } else {
      setLockedLayerIds(new Set());
    }
  }, [layers]);

  const handleBulkMoveLayer = useCallback(
    async (annotationIds = [], nextLayerId) => {
      if (!canReview || !currentUserId || !annotationIds.length || !nextLayerId) return;

      if (lockedLayerIds.has(nextLayerId)) {
        setActionError('Cannot move annotations to a locked layer.');
        return;
      }

      const targetLayer = layers.find((l) => l.id === nextLayerId) || { name: 'Default Layer' };

      const authorized = [];
      let skippedLocked = 0;
      let skippedAuth = 0;

      for (const id of annotationIds) {
        const ann = allBatchAnnotations.find((a) => a.id === id);
        if (!ann) continue;
        if (lockedLayerIds.has(ann.layerId || 'default')) {
          skippedLocked += 1;
          continue;
        }
        if (ann.createdBy !== currentUserId && profile?.role !== ROLES.ADMIN) {
          skippedAuth += 1;
          continue;
        }
        authorized.push(ann);
      }

      if (authorized.length === 0) {
        const msg = skippedLocked > 0
          ? 'All selected annotations are in locked layers.'
          : 'Only the annotation creator or an Admin can move annotations between layers.';
        setActionError(msg);
        return;
      }

      // Optimistic state updates
      authorized.forEach((ann) => {
        dispatchAnnotations({
          type: 'APPLY_LAYER_OPTIMISTIC',
          imageId: ann.imageId,
          annotationId: ann.id,
          layerId: nextLayerId,
        });
      });

      try {
        await Promise.all(
          authorized.map((ann) =>
            updateAnnotationLayer(ann.id, nextLayerId, creatorNameFallbackRef.current)
          )
        );
        const skippedTotal = skippedLocked + skippedAuth;
        if (skippedTotal > 0) {
          setActionError(
            `Moved ${authorized.length} annotations to "${targetLayer.name}". ${skippedTotal} skipped (${skippedLocked > 0 ? `${skippedLocked} locked` : ''}${skippedLocked > 0 && skippedAuth > 0 ? ', ' : ''}${skippedAuth > 0 ? `${skippedAuth} unauthorized` : ''}).`
          );
        }
      } catch (err) {
        // Revert on error
        authorized.forEach((ann) => {
          dispatchAnnotations({
            type: 'APPLY_LAYER_OPTIMISTIC',
            imageId: ann.imageId,
            annotationId: ann.id,
            layerId: ann.layerId || 'default',
          });
        });
        setActionError(err?.message || 'Failed to move annotations.');
      }
    },
    [canReview, currentUserId, lockedLayerIds, layers, allBatchAnnotations, profile?.role]
  );

  const handleBulkDelete = useCallback(
    async (annotationIds = []) => {
      if (!canReview || !currentUserId || !annotationIds.length) return;

      const authorized = [];
      let skippedLocked = 0;
      let skippedAuth = 0;
      let skippedResolved = 0;

      for (const id of annotationIds) {
        const ann = allBatchAnnotations.find((a) => a.id === id);
        if (!ann) continue;
        if (lockedLayerIds.has(ann.layerId || 'default')) {
          skippedLocked += 1;
          continue;
        }
        if (ann.createdBy !== currentUserId && profile?.role !== ROLES.ADMIN) {
          skippedAuth += 1;
          continue;
        }
        if (ann.status === 'resolved') {
          skippedResolved += 1;
          continue;
        }
        authorized.push(ann);
      }

      if (authorized.length === 0) {
        const msg = skippedLocked > 0
          ? 'All selected annotations are in locked layers.'
          : 'Only creators or Admins can delete open annotations.';
        setActionError(msg);
        return;
      }

      const skippedCount = skippedLocked + skippedAuth + skippedResolved;
      const confirmMsg = `Are you sure you want to delete ${authorized.length} selected annotation${authorized.length === 1 ? '' : 's'}?${
        skippedCount > 0 ? ` (${skippedCount} skipped: locked or insufficient permissions)` : ''
      }`;
      if (!window.confirm(confirmMsg)) return;

      const deletedIds = [];
      try {
        for (const ann of authorized) {
          dispatchAnnotations({
            type: 'REMOVE_ANNOTATION',
            imageId: ann.imageId,
            annotationId: ann.id,
          });
          await softDeleteAnnotation(ann.id, creatorNameFallbackRef.current);
          deletedIds.push(ann.id);
        }
        setSelectedAnnotationIds((prev) => prev.filter((id) => !deletedIds.includes(id)));
        if (skippedCount > 0) {
          setActionError(`Deleted ${authorized.length} annotations. ${skippedCount} skipped.`);
        }
      } catch (err) {
        setActionError(err?.message || 'Failed to delete some annotations.');
      }
    },
    [canReview, currentUserId, lockedLayerIds, allBatchAnnotations, profile?.role]
  );

  const annotationCountsByLayer = useMemo(() => {
    const counts = {};
    for (const ann of allBatchAnnotations) {
      const lid = ann.layerId || 'default';
      counts[lid] = (counts[lid] || 0) + 1;
    }
    return counts;
  }, [allBatchAnnotations]);

  const handleToggleImageCompletion = useCallback(
    async (image) => {
      if (!canReview || !image?.id || !currentUserId || updatingCompletionId) {
        return;
      }

      const nextCompleted = !image.is_completed;
      setUpdatingCompletionId(image.id);
      setActionError('');

      try {
        const updated = await updateBatchImageCompletion(image.id, nextCompleted);
        setImages((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item))
        );

        if (nextCompleted && batch?.id) {
          recordActivityEvent({
            batchId: batch.id,
            eventType: 'image_completed',
            occurredAt: updated.completed_at || new Date().toISOString(),
            actorId: currentUserId,
            actorName: creatorNameFallback,
            imageId: updated.id,
            imageFilename: updated.original_filename,
            imagePosition: updated.display_order || updated.position || null,
            details: `Marked image #${updated.display_order || updated.position || 1} as completed`,
            metadata: { is_completed: true, display_order: updated.display_order },
          }).then((act) => addActivityItem(act));
        }
      } catch (error) {
        setActionError(
          error?.message || 'Unable to update image completion status.'
        );
      } finally {
        setUpdatingCompletionId(null);
      }
    },
    [addActivityItem, batch?.id, canReview, creatorNameFallback, currentUserId, updatingCompletionId]
  );

  const handleDownloadImageReport = useCallback(async () => {
    if (!batch || !selectedImage || generatingImageReport) {
      return;
    }

    setActionError('');
    setGeneratingImageReport(true);
    try {
      await downloadImageReviewReport({
        batch,
        image: selectedImage,
        annotations: currentImageAnnotations.annotations,
      });
    } catch (error) {
      setActionError(
        error?.message || 'Unable to generate image PDF report.'
      );
    } finally {
      setGeneratingImageReport(false);
    }
  }, [
    batch,
    currentImageAnnotations.annotations,
    generatingImageReport,
    selectedImage,
  ]);

  // Phase 18B: Load reference images for the currently selected image
  const loadReferences = useCallback(async (imageId) => {
    if (!imageId) {
      setReferences([]);
      setReferencesLoading(false);
      return;
    }
    setReferencesLoading(true);
    setReferencesError('');
    try {
      const items = await listImageReferences(imageId);
      setReferences(items);
    } catch (err) {
      console.error('[ReviewWorkspace] Error loading reference images:', err);
      setReferencesError(err?.message || 'Failed to load reference images.');
    } finally {
      setReferencesLoading(false);
    }
  }, []);

  loadReferencesRef.current = loadReferences;

  useEffect(() => {
    if (selectedImageId) {
      loadReferences(selectedImageId);
    } else {
      setReferences([]);
    }
    setComparisonReference(null);
  }, [selectedImageId, loadReferences]);

  // Phase 18B: Reference image actions
  const handleUploadReference = useCallback(
    async ({ imageId, annotationId, file, comment }) => {
      setActionError('');
      try {
        const newRef = await uploadReferenceImage({
          batchId,
          imageId: imageId || selectedImageId,
          annotationId: annotationId || null,
          file,
          comment,
        });
        setReferences((prev) => [newRef, ...prev.filter((r) => r.id !== newRef.id)]);
        setActionNotice('Reference image attached successfully.');
        return newRef;
      } catch (err) {
        console.error('[ReviewWorkspace] Upload reference error:', err);
        setActionError(err?.message || 'Failed to upload reference image.');
        throw err;
      }
    },
    [batchId, selectedImageId]
  );

  const handleUpdateReferenceComment = useCallback(
    async (referenceId, nextComment) => {
      setActionError('');
      try {
        const updated = await updateReferenceComment(referenceId, nextComment);
        setReferences((prev) =>
          prev.map((r) =>
            r.id === referenceId
              ? { ...r, comment: updated.comment, updatedAt: updated.updatedAt }
              : r
          )
        );
        setActiveViewerReference((prev) =>
          prev && prev.id === referenceId
            ? { ...prev, comment: updated.comment, updatedAt: updated.updatedAt }
            : prev
        );
        setComparisonReference((prev) =>
          prev && prev.id === referenceId
            ? { ...prev, comment: updated.comment, updatedAt: updated.updatedAt }
            : prev
        );
        setActionNotice('Reference comment updated.');
        return updated;
      } catch (err) {
        console.error('[ReviewWorkspace] Update reference comment error:', err);
        setActionError(err?.message || 'Failed to update reference comment.');
        throw err;
      }
    },
    []
  );

  const handleReplaceReference = useCallback(
    async (oldReference, newFile) => {
      if (!oldReference || !newFile) return;
      setActionError('');
      try {
        const newRef = await replaceReferenceImage({
          oldReference,
          newFile,
        });
        setReferences((prev) => [
          newRef,
          ...prev.filter((r) => r.id !== oldReference.id && r.id !== newRef.id),
        ]);
        setActiveViewerReference((prev) =>
          prev && prev.id === oldReference.id ? newRef : prev
        );
        setComparisonReference((prev) =>
          prev && prev.id === oldReference.id ? newRef : prev
        );
        setActionNotice('Reference image replaced successfully.');
        return newRef;
      } catch (err) {
        console.error('[ReviewWorkspace] Replace reference error:', err);
        setActionError(err?.message || 'Failed to replace reference image.');
        throw err;
      }
    },
    []
  );

  const handleDeleteReference = useCallback(
    async (reference) => {
      if (!reference) return;
      setActionError('');
      try {
        await deleteReferenceImage(reference);
        setReferences((prev) => prev.filter((r) => r.id !== reference.id));
        setActiveViewerReference((prev) =>
          prev && prev.id === reference.id ? null : prev
        );
        setComparisonReference((prev) =>
          prev && prev.id === reference.id ? null : prev
        );
        setActionNotice('Reference image removed.');
      } catch (err) {
        console.error('[ReviewWorkspace] Delete reference error:', err);
        setActionError(err?.message || 'Failed to delete reference image.');
        throw err;
      }
    },
    []
  );

  const handleAttachReferenceToAnnotation = useCallback((annotation) => {
    if (!annotation) return;
    setSelectedAnnotationId(annotation.id);
    setSidebarMode('references');
    setIsSidebarVisible(true);
    setIsSidebarCollapsed(false);
  }, []);

  // Phase 18B: Global clipboard paste handler for reference images
  useEffect(() => {
    if (!canReview || isReadOnlyMode || !selectedImageId || isFocusMode) return;

    const handlePaste = async (e) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable)
      ) {
        return;
      }

      const clipboardData = e.clipboardData;
      if (!clipboardData || !clipboardData.items) return;

      let imageFile = null;
      for (const item of clipboardData.items) {
        if (item.type && item.type.startsWith('image/')) {
          imageFile = item.getAsFile();
          break;
        }
      }

      if (!imageFile) return;

      e.preventDefault();
      setIsSidebarVisible(true);
      setIsSidebarCollapsed(false);
      setSidebarMode('references');

      try {
        setActionNotice('Uploading pasted reference image…');
        const newRef = await uploadReferenceImage({
          batchId,
          imageId: selectedImageId,
          annotationId: selectedAnnotationId || null,
          file: imageFile,
          comment: '',
        });

        setReferences((prev) => [newRef, ...prev.filter((r) => r.id !== newRef.id)]);
        setActionNotice('Pasted reference image attached successfully.');
      } catch (err) {
        console.error('[ReviewWorkspace] Error uploading pasted reference:', err);
        setActionError(err?.message || 'Failed to upload pasted reference image.');
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [
    batchId,
    canReview,
    isFocusMode,
    isReadOnlyMode,
    selectedAnnotationId,
    selectedImageId,
  ]);

  // Tool, view, navigation, and history keyboard shortcuts (Phase 22C customizable)
  useEffect(() => {
    if (!canReview || isReadOnlyMode) return;

    const handleKeyDown = (event) => {
      // Do not intercept when typing in form controls or when modal is open or in presentation mode
      if (
        isPresentationMode ||
        isShortcutsModalOpen ||
        isTemplatesModalOpen ||
        isPreferencesModalOpen ||
        isExportModalOpen ||
        isOnboardingModalOpen
      ) return;

      const active = document.activeElement;
      if (active) {
        const tag = active.tagName ? active.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || active.isContentEditable) {
          return;
        }
      }

      // 1. Navigation shortcuts
      if (
        matchesShortcut(event, userShortcuts.nav_next_image || 'PageDown') ||
        event.key === 'PageDown' ||
        (event.altKey && event.key === 'ArrowRight')
      ) {
        event.preventDefault();
        const curIdx = images.findIndex((img) => img.id === selectedImageIdRef.current);
        if (curIdx >= 0 && curIdx < images.length - 1) {
          handleSelectImageRef.current?.(images[curIdx + 1].id, true);
        }
        return;
      }
      if (
        matchesShortcut(event, userShortcuts.nav_prev_image || 'PageUp') ||
        event.key === 'PageUp' ||
        (event.altKey && event.key === 'ArrowLeft')
      ) {
        event.preventDefault();
        const curIdx = images.findIndex((img) => img.id === selectedImageIdRef.current);
        if (curIdx > 0) {
          handleSelectImageRef.current?.(images[curIdx - 1].id, true);
        }
        return;
      }
      if (
        matchesShortcut(event, userShortcuts.nav_next_incomplete || 'Shift+N') ||
        (event.shiftKey && (event.key === 'N' || event.key === 'n'))
      ) {
        event.preventDefault();
        const curIdx = images.findIndex((img) => img.id === selectedImageIdRef.current);
        const startIndex = curIdx >= 0 ? curIdx : 0;
        let found = false;
        for (let i = startIndex + 1; i < images.length; i++) {
          if (!images[i].is_completed) {
            handleSelectImageRef.current?.(images[i].id, true);
            found = true;
            break;
          }
        }
        if (!found) {
          for (let i = 0; i < startIndex; i++) {
            if (!images[i].is_completed) {
              handleSelectImageRef.current?.(images[i].id, true);
              found = true;
              break;
            }
          }
        }
        return;
      }

      // 2. Undo / Redo / Delete history actions
      if (matchesShortcut(event, userShortcuts.action_undo || 'Ctrl+Z')) {
        if (currentImageAnnotations.history.past.length > 0) {
          event.preventDefault();
          handleUndo();
          return;
        }
      }
      if (matchesShortcut(event, userShortcuts.action_redo || 'Ctrl+Y')) {
        if (currentImageAnnotations.history.future.length > 0) {
          event.preventDefault();
          handleRedo();
          return;
        }
      }
      if (matchesShortcut(event, userShortcuts.action_delete || 'Delete')) {
        if (selectedAnnotationIds.length > 1) {
          event.preventDefault();
          handleBulkDelete(selectedAnnotationIds);
          return;
        } else if (selectedAnnotation) {
          event.preventDefault();
          handleDeleteSelected();
          return;
        }
      }

      // 3. Canvas & View Actions
      if (matchesShortcut(event, userShortcuts.tool_magnifier || 'z')) {
        event.preventDefault();
        setIsMagnifierActive((prev) => !prev);
        return;
      }
      if (matchesShortcut(event, userShortcuts.view_rotate_ccw || '[')) {
        event.preventDefault();
        if (selectedImageIdRef.current) {
          setImageRotations((prev) => ({
            ...prev,
            [selectedImageIdRef.current]: ((prev[selectedImageIdRef.current] || 0) + 270) % 360,
          }));
        }
        return;
      }
      if (matchesShortcut(event, userShortcuts.view_rotate_cw || ']')) {
        event.preventDefault();
        if (selectedImageIdRef.current) {
          setImageRotations((prev) => ({
            ...prev,
            [selectedImageIdRef.current]: ((prev[selectedImageIdRef.current] || 0) + 90) % 360,
          }));
        }
        return;
      }

      // 4. Drawing Tools
      if (matchesShortcut(event, userShortcuts.tool_select || 'v')) {
        event.preventDefault();
        setToolMode('select');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_circle || 'c')) {
        event.preventDefault();
        setToolMode('circle');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_arrow || 'a')) {
        event.preventDefault();
        setToolMode('arrow');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_line || 'l')) {
        event.preventDefault();
        setToolMode('line');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_rectangle || 'r')) {
        event.preventDefault();
        setToolMode('rectangle');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_polygon || 'g')) {
        event.preventDefault();
        setToolMode('polygon');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_cloud || 'u')) {
        event.preventDefault();
        setToolMode('cloud');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_pencil || 'p')) {
        event.preventDefault();
        setToolMode('pencil');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_highlighter || 'i')) {
        event.preventDefault();
        setToolMode('highlighter');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_callout || 't')) {
        event.preventDefault();
        setToolMode('callout');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_textbox || 'x')) {
        event.preventDefault();
        setToolMode('textbox');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_blur || 'b')) {
        event.preventDefault();
        setToolMode('blur');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_marker || 'm')) {
        event.preventDefault();
        setToolMode('marker');
        return;
      }
      if (matchesShortcut(event, userShortcuts.tool_pan || 'h')) {
        event.preventDefault();
        setToolMode('pan');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    canReview,
    currentImageAnnotations.history.future.length,
    currentImageAnnotations.history.past.length,
    handleBulkDelete,
    handleDeleteSelected,
    handleRedo,
    handleUndo,
    images,
    isReadOnlyMode,
    isPresentationMode,
    isShortcutsModalOpen,
    isTemplatesModalOpen,
    isPreferencesModalOpen,
    isExportModalOpen,
    isOnboardingModalOpen,
    selectedAnnotation,
    selectedAnnotationIds,
    userShortcuts,
  ]);


  const activeViewerParentAnnotation = useMemo(() => {
    if (!activeViewerReference?.annotationId) return null;
    return (
      allBatchAnnotations.find((a) => a.id === activeViewerReference.annotationId) ||
      null
    );
  }, [activeViewerReference, allBatchAnnotations]);

  const canManageActiveViewerReference = useMemo(() => {
    if (!activeViewerReference) return false;
    return canManageReference({
      reference: activeViewerReference,
      currentUserId,
      userRole: profile?.role,
      parentAnnotation: activeViewerParentAnnotation,
    });
  }, [
    activeViewerReference,
    activeViewerParentAnnotation,
    currentUserId,
    profile?.role,
  ]);

  if (loading) {
    return (
      <div className="fc-review-workspace">
        <ReviewHeader batchId={batchId} batchName="" currentPosition={0} totalImages={0} />
        <main className="fc-review-state-main" aria-busy="true">
          <div className="fc-review-state-card">
            <div className="fc-spinner-row">
              <span className="fc-spinner" aria-hidden="true" />
              <span>Loading review workspace…</span>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="fc-review-workspace">
        <ReviewHeader batchId={batchId} batchName="" currentPosition={0} totalImages={0} />
        <main className="fc-review-state-main">
          <div className="fc-review-state-card" role="alert">
            <div className="fc-alert fc-alert-error">{errorMessage}</div>
            <div>
              <Link to={`/batches/${batchId}`} className="fc-btn fc-btn-secondary">
                Back to Batch
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="fc-review-workspace">
        <ReviewHeader batchId={batchId} batchName="" currentPosition={0} totalImages={0} />
        <main className="fc-review-state-main">
          <div className="fc-review-state-card">
            <h1 className="fc-review-state-title">Batch Not Found</h1>
            <p className="fc-review-state-text">
              This batch does not exist or you do not have permission to inspect it.
            </p>
            <div>
              <Link to="/dashboard" className="fc-btn fc-btn-primary">
                Back to Batches
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="fc-review-workspace">
        <ReviewHeader
          batchId={batch.id}
          batchName={batch.name}
          currentPosition={0}
          totalImages={0}
          activeReviewers={activeReviewers}
          currentUserId={currentUserId}
          followingUserId={followingUserId}
          onFollowReviewer={handleFollowReviewer}
          onStopFollowing={() => handleStopFollowing('user click')}
          canReview={canReview}
          images={images}
        />
        <main className="fc-review-state-main">
          <div className="fc-review-state-card">
            <h1 className="fc-review-state-title">No images in this batch</h1>
            <p className="fc-review-state-text">
              Upload images on the batch page before opening the review workspace.
            </p>
            <div>
              <Link to={`/batches/${batch.id}`} className="fc-btn fc-btn-primary">
                Back to Batch
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const renderThumbnailsPanel = (dockSide) => (
    <ImageThumbnailsPanel
      images={images}
      selectedImageId={selectedImageId}
      onSelectImage={handleSelectImage}
      isCollapsed={isThumbnailsCollapsed}
      onToggleCollapse={handleToggleThumbnailsCollapse}
      width={thumbnailsWidth}
      dockSide={dockSide}
      onReposition={handleTogglePanelLayout}
      onHide={handleToggleThumbnailsVisible}
      canHide={isSidebarVisible}
      recentImageIds={recentImageIds}
      batchName={batch?.name}
    />
  );

  const renderReviewSidebar = (dockSide) => (
    <ReviewSidebar
      activeTab={activeTab}
      onTabChange={setActiveTab}
      selectedImage={selectedImage}
      images={images}
      annotations={allBatchAnnotations}
      currentUserId={currentUserId}
      selectedAnnotationId={selectedAnnotationId}
      onSelectAnnotationCard={handleSelectAnnotationCard}
      draftAnnotation={draftAnnotation}
      isSubmittingDraft={isSubmittingDraft}
      onConfirmDraft={handleConfirmDraft}
      onCancelDraft={handleCancelDraft}
      busyAnnotationIds={busyAnnotationIds}
      onSaveComment={handleSaveComment}
      onToggleStatus={handleToggleStatus}
      onDeleteAnnotation={handleDeleteAnnotation}
      annotationsLoading={annotationsLoading}
      readOnly={isReadOnlyMode}
      actionError={actionError}
      onClearActionError={() => setActionError('')}
      isCollapsed={isSidebarCollapsed}
      onToggleCollapse={handleToggleSidebarCollapse}
      liveSelections={liveSelections}
      reactions={reactionsByAnnotation}
      onToggleReaction={handleToggleReaction}
      mentionableUsers={mentionableUsers}
      sidebarMode={sidebarMode}
      onSidebarModeChange={setSidebarMode}
      activities={activities}
      activitiesLoading={activitiesLoading}
      activitiesError={activitiesError}
      onRetryActivities={handleRetryActivities}
      onNavigateAnnotation={handleNavigateAnnotation}
      onNavigateImage={handleNavigateImage}
      onNavigateWhiteboard={handleNavigateWhiteboard}
      batchId={batchId}
      references={references}
      referencesLoading={referencesLoading}
      referencesError={referencesError}
      onRetryReferences={() => loadReferences(selectedImageId)}
      onUploadReference={handleUploadReference}
      onUpdateReferenceComment={handleUpdateReferenceComment}
      onReplaceReference={handleReplaceReference}
      onDeleteReference={handleDeleteReference}
      onSelectReferenceForView={(ref) => setActiveViewerReference(ref)}
      onOpenComparison={(ref) => setComparisonReference(ref)}
      userRole={profile?.role}
      onAttachReferenceToAnnotation={handleAttachReferenceToAnnotation}
      layers={layers}
      hiddenLayerIds={hiddenLayerIds}
      onToggleLayerVisibility={handleToggleLayerVisibility}
      isLayerManagerOpen={isLayerManagerOpen}
      onOpenLayerManager={handleOpenLayerManager}
      onToggleLayerManager={handleToggleLayerManager}
      onOpenPropertiesModal={(ann) => setPropertiesModalAnnotation(ann)}
      onUpdateAnnotationLabels={handleUpdateAnnotationLabels}
      selectedAnnotationIds={selectedAnnotationIds}
      lockedLayerIds={lockedLayerIds}
      onBulkMoveLayer={handleBulkMoveLayer}
      onBulkDelete={handleBulkDelete}
      onClearSelection={() => setSelectedAnnotationIds([])}
      onToggleLayerLock={handleToggleLayerLock}
      onUpdateAnnotationAssignment={handleUpdateAnnotationAssignment}
      onUpdateAnnotationPriority={handleUpdateAnnotationPriority}
      discussions={discussionsByAnnotation}
      onCreateDiscussionMessage={handleCreateDiscussionMessage}
      onDeleteDiscussionMessage={handleDeleteDiscussionMessage}
      checklists={checklists}
      onToggleChecklistItem={handleToggleChecklistItem}
      onAddCustomChecklistItem={handleAddCustomChecklistItem}
      onDeleteChecklistItem={handleDeleteChecklistItem}
      width={sidebarWidth}
      dockSide={dockSide}
      onReposition={handleTogglePanelLayout}
      onHide={handleToggleSidebarVisible}
      canHide={isThumbnailsVisible}
    />
  );

  return (
    <div
      className={`fc-review-workspace${
        isFocusMode ? ' fc-review-workspace-focus' : ''
      }${isPresentationMode ? ' fc-review-workspace-presentation' : ''}`}
    >
      {!isFocusMode && !isPresentationMode ? (
        <ReviewHeader
          batchId={batch.id}
          batchName={batch.name}
          batchReviewStatus={batchReviewStatus}
          currentPosition={currentPosition}
          totalImages={images.length}
          activeReviewers={activeReviewers}
          currentUserId={currentUserId}
          followingUserId={followingUserId}
          onFollowReviewer={handleFollowReviewer}
          onStopFollowing={() => handleStopFollowing('user click')}
          canReview={canReview}
          images={images}
          onToggleFocusMode={handleToggleFocusMode}
          panelLayout={panelLayout}
          onTogglePanelLayout={handleTogglePanelLayout}
          onResetPanelSizes={handleResetPanelSizes}
          isThumbnailsVisible={isThumbnailsVisible}
          onToggleThumbnailsVisible={handleToggleThumbnailsVisible}
          isSidebarVisible={isSidebarVisible}
          onToggleSidebarVisible={handleToggleSidebarVisible}
          onShowAllPanels={handleShowAllPanels}
          activeLayoutId={activeLayoutId}
          activeLayoutName={activeLayoutName}
          isLayoutModified={isLayoutModified}
          savedLayouts={savedLayouts}
          onApplyLayout={handleApplyLayout}
          onSaveLayout={handleSaveLayout}
          onDeleteLayout={handleDeleteLayout}
          onOpenPreferences={() => setIsPreferencesModalOpen(true)}
          onTogglePresentationMode={handleTogglePresentationMode}
          onOpenExportModal={() => setIsExportModalOpen(true)}
          onOpenOnboarding={() => setIsOnboardingModalOpen(true)}
        />
      ) : null}

      {autosaveStatus === 'failed' ? (
        <div className="fc-autosave-error-banner" role="alert">
          <span className="fc-autosave-error-text">
            ⚠️ Network interruption: Some annotation updates could not be saved to Supabase.
          </span>
          <button
            type="button"
            className="fc-btn fc-btn-danger fc-btn-xs fc-autosave-retry-btn"
            onClick={handleRetryAutosave}
          >
            Retry Save
          </button>
        </div>
      ) : null}

      {!isFocusMode && !isPresentationMode && realtimeNotice ? (
        <div className="fc-realtime-banner" role="status" aria-live="polite">
          {realtimeNotice}
        </div>
      ) : null}

      <div className="fc-workspace-body">
        {!isFocusMode && !isPresentationMode &&
          (panelLayout === 'default' ? (
            isThumbnailsVisible ? (
              <>
                {renderThumbnailsPanel('left')}
                <WorkspaceResizeHandle
                  id="fc-resize-handle-thumbnails"
                  side="left"
                  currentWidth={thumbnailsWidth}
                  minWidth={MIN_THUMBNAILS_WIDTH}
                  maxWidth={maxThumbnailsWidth}
                  onResize={handleThumbnailsResize}
                  onResizeEnd={handleThumbnailsResizeEnd}
                  onToggleCollapse={handleToggleThumbnailsCollapse}
                  isCollapsed={isThumbnailsCollapsed}
                  panelTitle="Image Thumbnails"
                />
              </>
            ) : null
          ) : (
            isSidebarVisible ? (
              <>
                {renderReviewSidebar('left')}
                <WorkspaceResizeHandle
                  id="fc-resize-handle-sidebar"
                  side="left"
                  currentWidth={sidebarWidth}
                  minWidth={MIN_SIDEBAR_WIDTH}
                  maxWidth={maxSidebarWidth}
                  onResize={handleSidebarResize}
                  onResizeEnd={handleSidebarResizeEnd}
                  onToggleCollapse={handleToggleSidebarCollapse}
                  isCollapsed={isSidebarCollapsed}
                  panelTitle="Review Sidebar"
                />
              </>
            ) : null
          ))}

        <main className="fc-workspace-canvas-area">
          {!isFocusMode && !isPresentationMode && !isThumbnailsVisible ? (
            <button
              type="button"
              className={`fc-panel-restore-pill fc-restore-${
                panelLayout === 'default' ? 'left' : 'right'
              }`}
              onClick={() => setIsThumbnailsVisible(true)}
              title="Show image thumbnails (Alt+1)"
              aria-label="Show image thumbnails"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>Show Images</span>
              <kbd className="fc-restore-kbd">Alt+1</kbd>
            </button>
          ) : null}

          {!isFocusMode && !isPresentationMode && !isSidebarVisible ? (
            <button
              type="button"
              className={`fc-panel-restore-pill fc-restore-${
                panelLayout === 'default' ? 'right' : 'left'
              }`}
              onClick={() => setIsSidebarVisible(true)}
              title="Show review sidebar (Alt+2)"
              aria-label="Show review sidebar"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>Show Sidebar</span>
              <kbd className="fc-restore-kbd">Alt+2</kbd>
            </button>
          ) : null}

          {!isFocusMode && !isPresentationMode && followingUser ? (
            <div className="fc-following-banner" role="status" aria-live="polite">
              <span
                className="fc-following-dot"
                style={{ backgroundColor: followingUser.color || '#2563eb' }}
              />
              <span className="fc-following-text">
                Following <strong>{followingUser.displayName || 'Reviewer'}</strong>
              </span>
              <button
                type="button"
                className="fc-stop-following-btn"
                onClick={() => handleStopFollowing('user click')}
              >
                Stop Following (Esc)
              </button>
            </div>
          ) : null}

          {actionNotice ? (
            <div className="fc-action-notice-toast" role="status" aria-live="polite">
              {actionNotice}
            </div>
          ) : null}

          {canReview && selectedImage?.replacement_status === 'pending_approval' ? (
            <div className="fc-pending-replacement-banner" role="alert">
              <div className="fc-pending-replacement-banner-info">
                <span className="fc-pending-replacement-icon">⚡</span>
                <div className="fc-pending-replacement-texts">
                  <div className="fc-pending-replacement-heading">
                    <strong>Replacement Proposal Pending Review</strong>
                    {activePendingReplacement?.versionNumber ? (
                      <span className="fc-pending-replacement-tag">
                        Version {activePendingReplacement.versionNumber}
                      </span>
                    ) : null}
                  </div>
                  <p className="fc-pending-replacement-desc">
                    {activePendingReplacement?.uploaderName || 'The uploader'} submitted a corrected image version for approval.
                    {activePendingReplacement?.correctionMessage ? (
                      <span className="fc-pending-replacement-msg">
                        "{activePendingReplacement.correctionMessage}"
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="fc-pending-replacement-actions">
                <button
                  type="button"
                  className="fc-btn fc-btn-primary fc-btn-sm"
                  onClick={() => setIsReplacementModalOpen(true)}
                >
                  Compare & Review Replacement
                </button>
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary fc-btn-sm"
                  onClick={() => setIsVersionHistoryOpen(true)}
                >
                  Version History
                </button>
              </div>
            </div>
          ) : null}

          <ImagePreview
            image={selectedImage}
            imageIndex={selectedIndex}
            totalImages={images.length}
            onPrev={() => {
              if (selectedIndex > 0) {
                handleSelectImage(images[selectedIndex - 1].id, true);
              }
            }}
            onNext={() => {
              if (selectedIndex < images.length - 1) {
                handleSelectImage(images[selectedIndex + 1].id, true);
              }
            }}
            variant="workspace"
            prepareAnnotationLayer
            toolMode={toolMode}
            readOnly={isReadOnlyMode}
            externalViewport={externalViewport}
            onViewportChange={handleViewportChange}
            onManualViewportInteraction={handleManualViewportInteraction}
            isFocusMode={isFocusMode}
            onToggleFocusMode={handleToggleFocusMode}
            onExitFocusMode={handleExitFocusMode}
            zoomPreference={reviewerPreferences.zoomPreference}
            rotation={currentRotation}
            onRotateCW={handleRotateCW}
            onRotateCCW={handleRotateCCW}
            onResetRotation={handleResetRotation}
            isMagnifierActive={isMagnifierActive}
            onToggleMagnifier={handleToggleMagnifier}
            canUndo={currentImageAnnotations.history.past.length > 0}
            canRedo={currentImageAnnotations.history.future.length > 0}
            onUndo={canReview && !isReadOnlyMode ? handleUndo : null}
            onRedo={canReview && !isReadOnlyMode ? handleRedo : null}
            headerActions={
              selectedImage ? (
                <div className="fc-image-completion-control">
                  <ReviewMoreActionsMenu
                    onDownloadImageReport={handleDownloadImageReport}
                    isGeneratingReport={generatingImageReport}
                    isAnnotationsLoading={annotationsLoading}
                    onOpenExport={() => setIsExportModalOpen(true)}
                    isExportDisabled={!selectedImage || annotationsLoading}
                    onOpenHistory={() => setIsVersionHistoryOpen(true)}
                    versionNumber={selectedImage.current_version_number || 1}
                    onRotateCW={handleRotateCW}
                    onRotateCCW={handleRotateCCW}
                  />
                  {selectedImage.is_completed ? (
                    <span className="fc-image-completed-pill">Completed</span>
                  ) : isReadOnlyMode ? (
                    <span className="fc-image-inreview-pill">In Review</span>
                  ) : null}
                  {canReview && selectedImage.replacement_status === 'pending_approval' ? (
                    <button
                      type="button"
                      className="fc-btn fc-btn-primary fc-btn-sm fc-btn-pending-pulse"
                      onClick={() => setIsReplacementModalOpen(true)}
                      title="Inspect proposed replacement and approve or reject"
                    >
                      ⚡ Review Replacement
                    </button>
                  ) : null}
                  {canReview ? (
                    <button
                      type="button"
                      className={`fc-btn fc-btn-sm ${
                        selectedImage.is_completed
                          ? 'fc-btn-secondary'
                          : 'fc-btn-success'
                      }`}
                      onClick={() => handleToggleImageCompletion(selectedImage)}
                      disabled={
                        !currentUserId || updatingCompletionId === selectedImage.id
                      }
                    >
                      {updatingCompletionId === selectedImage.id
                        ? 'Saving…'
                        : selectedImage.is_completed
                          ? 'Reopen Image'
                          : 'Mark Completed'}
                    </button>
                  ) : null}
                </div>
              ) : null
            }
            toolbarSlot={isPresentationMode ? () => null : (zoomControls) => (
              <AnnotationToolbar
                toolMode={toolMode}
                onToolModeChange={(nextMode) => {
                  if (canReview) setToolMode(nextMode);
                }}
                activeDrawColor={activeDrawColor}
                onColorSelect={handleColorSelect}
                selectedAnnotation={selectedAnnotation}
                canEditSelected={canEditSelected}
                hasDraft={Boolean(draftAnnotation)}
                canUndo={currentImageAnnotations.history.past.length > 0}
                canRedo={currentImageAnnotations.history.future.length > 0}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onDeleteSelected={handleDeleteSelected}
                isSyncing={pendingSyncCount > 0}
                autosaveStatus={autosaveStatus}
                onRetryAutosave={handleRetryAutosave}
                onOpenTemplates={handleOpenTemplates}
                onOpenShortcuts={handleOpenShortcuts}
                shortcuts={userShortcuts}
                readOnly={isReadOnlyMode}
                disabled={!currentUserId || isReadOnlyMode}
                isFocusMode={isFocusMode}
                onToggleFocusMode={handleToggleFocusMode}
                activeDrawStyle={activeDrawStyle}
                onStyleChange={handleStyleChange}
                activeLayerId={activeLayerId}
                onActiveLayerChange={setActiveLayerId}
                layers={layers}
                onOpenLayerManager={handleOpenLayerManager}
                onOpenPropertiesModal={() => {
                  if (selectedAnnotation) setPropertiesModalAnnotation(selectedAnnotation);
                }}
                onMoveAnnotationLayer={handleUpdateAnnotationLayer}
                lockedLayerIds={lockedLayerIds}
                selectedAnnotationIds={selectedAnnotationIds}
                onBulkMoveLayer={handleBulkMoveLayer}
                onBulkDelete={handleBulkDelete}
                onUpdateAnnotationAssignment={handleUpdateAnnotationAssignment}
                onUpdateAnnotationPriority={handleUpdateAnnotationPriority}
                mentionableUsers={mentionableUsers}
                toolbarPosition={reviewerPreferences.toolbarPosition}
                toolbarDensity={reviewerPreferences.toolbarDensity}
                {...zoomControls}
              />
            )}
            annotationOverlay={(zoomProps) =>
              selectedImage ? (
                <AnnotationLayer
                  imageId={selectedImage.id}
                  annotations={
                    isPresentationMode && !showPresentationAnnotations
                      ? []
                      : currentImageAnnotations.annotations.filter(
                          (ann) =>
                            (ann.versionNumber || 1) ===
                            (selectedImage.current_version_number || 1)
                        )
                  }
                  currentUserId={currentUserId}
                  draftAnnotation={isPresentationMode ? null : draftAnnotation}
                  toolMode={isPresentationMode ? 'pan' : toolMode}
                  activeDrawColor={activeDrawColor}
                  selectedAnnotationId={selectedAnnotation?.id ?? null}
                  selectedAnnotationIds={selectedAnnotationIds}
                  onSelectAnnotation={handleSelectAnnotation}
                  onCreateDraft={handleCreateDraft}
                  onUpdateDraftGeometry={handleUpdateDraftGeometry}
                  onCommitGeometry={handleCommitGeometry}
                  onCommitBulkMove={handleCommitBulkMove}
                  readOnly={isReadOnlyMode || isPresentationMode}
                  disabled={
                    isSubmittingDraft ||
                    !currentUserId ||
                    isReadOnlyMode ||
                    isPresentationMode
                  }
                  liveCursors={
                    reviewerPreferences.showLiveCursors && !isPresentationMode
                      ? Object.values(remoteCursors)
                      : []
                  }
                  liveSelections={liveSelections}
                  onCursorMove={handleCursorMove}
                  onCursorLeave={handleCursorLeave}
                  hiddenLayerIds={hiddenLayerIds}
                  lockedLayerIds={lockedLayerIds}
                  activeDrawStyle={activeDrawStyle}
                  rotation={currentRotation}
                  isMagnifierActive={isMagnifierActive}
                  {...zoomProps}
                />
              ) : null
            }
          />

          {isFocusMode && draftAnnotation ? (
            <div
              className="fc-focus-draft-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label="Add annotation comment"
            >
              <div className="fc-focus-draft-card-container">
                <DraftCommentComposer
                  draftAnnotation={draftAnnotation}
                  imageLabel={
                    selectedImage
                      ? `Image #${selectedImage.display_order || selectedIndex + 1}`
                      : ''
                  }
                  isSubmitting={isSubmittingDraft}
                  onConfirm={handleConfirmDraft}
                  onCancel={handleCancelDraft}
                  mentionableUsers={mentionableUsers}
                />
              </div>
            </div>
          ) : null}
        </main>

        {!isFocusMode && !isPresentationMode &&
          (panelLayout === 'default' ? (
            isSidebarVisible ? (
              <>
                <WorkspaceResizeHandle
                  id="fc-resize-handle-sidebar"
                  side="right"
                  currentWidth={sidebarWidth}
                  minWidth={MIN_SIDEBAR_WIDTH}
                  maxWidth={maxSidebarWidth}
                  onResize={handleSidebarResize}
                  onResizeEnd={handleSidebarResizeEnd}
                  onToggleCollapse={handleToggleSidebarCollapse}
                  isCollapsed={isSidebarCollapsed}
                  panelTitle="Review Sidebar"
                />
                {renderReviewSidebar('right')}
              </>
            ) : null
          ) : (
            isThumbnailsVisible ? (
              <>
                <WorkspaceResizeHandle
                  id="fc-resize-handle-thumbnails"
                  side="right"
                  currentWidth={thumbnailsWidth}
                  minWidth={MIN_THUMBNAILS_WIDTH}
                  maxWidth={maxThumbnailsWidth}
                  onResize={handleThumbnailsResize}
                  onResizeEnd={handleThumbnailsResizeEnd}
                  onToggleCollapse={handleToggleThumbnailsCollapse}
                  isCollapsed={isThumbnailsCollapsed}
                  panelTitle="Image Thumbnails"
                />
                {renderThumbnailsPanel('right')}
              </>
            ) : null
          ))}
      </div>

      {activeViewerReference ? (
        <ReferenceViewerModal
          isOpen={Boolean(activeViewerReference)}
          reference={activeViewerReference}
          parentAnnotation={activeViewerParentAnnotation}
          canManage={canManageActiveViewerReference}
          onClose={() => setActiveViewerReference(null)}
          onCompare={(ref) => setComparisonReference(ref)}
          onUpdateComment={handleUpdateReferenceComment}
          onReplace={handleReplaceReference}
          onDelete={handleDeleteReference}
        />
      ) : null}

      {comparisonReference && selectedImage ? (
        <ReferenceComparisonModal
          isOpen={Boolean(comparisonReference)}
          originalImage={selectedImage}
          currentReference={comparisonReference}
          allReferences={references}
          allAnnotations={allBatchAnnotations}
          onSelectReference={setComparisonReference}
          onClose={() => setComparisonReference(null)}
          initialMode="slider"
        />
      ) : null}

      {propertiesModalAnnotation ? (
        <AnnotationPropertiesModal
          isOpen={Boolean(propertiesModalAnnotation)}
          annotation={propertiesModalAnnotation}
          canEdit={
            !isReadOnlyMode &&
            (propertiesModalAnnotation.createdBy === currentUserId ||
              profile?.role === ROLES.ADMIN)
          }
          onClose={() => setPropertiesModalAnnotation(null)}
          onSave={handleUpdateAnnotationCustomProperties}
        />
      ) : null}

      {isLayerManagerOpen ? (
        <LayerManagerModal
          isOpen={isLayerManagerOpen}
          onClose={handleCloseLayerManager}
          anchorEl={layerManagerAnchorEl}
          layers={layers}
          annotationCountsByLayer={annotationCountsByLayer}
          hiddenLayerIds={hiddenLayerIds}
          lockedLayerIds={lockedLayerIds}
          onToggleLayerVisibility={handleToggleLayerVisibility}
          onToggleAllLayers={handleToggleAllLayersVisibility}
          onToggleLayerLock={handleToggleLayerLock}
          onToggleAllLayersLock={handleToggleAllLayersLock}
          onCreateLayer={handleCreateLayer}
          onUpdateLayer={handleUpdateLayer}
          onDeleteLayer={handleDeleteLayer}
          canManage={!isReadOnlyMode}
        />
      ) : null}

      {isPreferencesModalOpen ? (
        <ReviewerPreferencesModal
          isOpen={isPreferencesModalOpen}
          onClose={() => setIsPreferencesModalOpen(false)}
          preferences={reviewerPreferences}
          onSavePreferences={handleSaveReviewerPreferences}
          displayName={profile?.display_name || creatorNameFallback}
          onRelaunchOnboarding={() => setIsOnboardingModalOpen(true)}
        />
      ) : null}

      {isShortcutsModalOpen ? (
        <KeyboardShortcutsModal
          isOpen={isShortcutsModalOpen}
          onClose={handleCloseToolbarPopup}
          shortcuts={userShortcuts}
          onSaveShortcuts={handleSaveCustomShortcuts}
          onResetDefaults={handleResetCustomShortcuts}
          anchorEl={toolbarPopupAnchor}
        />
      ) : null}

      {isTemplatesModalOpen ? (
        <AnnotationTemplatesModal
          isOpen={isTemplatesModalOpen}
          onClose={handleCloseToolbarPopup}
          userId={currentUserId || 'guest'}
          selectedAnnotation={selectedAnnotation}
          activeDrawStyle={activeDrawStyle}
          activeDrawColor={activeDrawColor}
          onApplyToAnnotation={handleApplyTemplateToAnnotation}
          onApplyToDrawTools={handleApplyTemplateToDrawTools}
          anchorEl={toolbarPopupAnchor}
        />
      ) : null}

      {/* Phase 22D: Presentation Mode Overlay */}
      <PresentationModeOverlay
        isOpen={isPresentationMode}
        onClose={handleExitPresentationMode}
        currentImage={selectedImage}
        currentIndex={selectedIndex}
        totalImages={images.length}
        onPrevImage={() => {
          if (selectedIndex > 0) {
            handleSelectImage(images[selectedIndex - 1].id, true);
          }
        }}
        onNextImage={() => {
          if (selectedIndex < images.length - 1) {
            handleSelectImage(images[selectedIndex + 1].id, true);
          }
        }}
        showAnnotations={showPresentationAnnotations}
        onToggleAnnotations={() =>
          setShowPresentationAnnotations((prev) => !prev)
        }
      />

      {/* Phase 22D: Annotated Image Export Modal */}
      {isExportModalOpen && selectedImage ? (
        <ImageExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          image={selectedImage}
          annotations={currentImageAnnotations.annotations}
          hiddenLayerIds={hiddenLayerIds}
        />
      ) : null}

      {/* Phase 22D: Role-Aware Onboarding Walkthrough */}
      <OnboardingModal
        isOpen={isOnboardingModalOpen}
        onClose={() => setIsOnboardingModalOpen(false)}
        userRole={canReview ? 'reviewer' : 'uploader'}
        userId={currentUserId || 'guest'}
        onComplete={handleOnboardingComplete}
      />

      {/* Image Versioning: Replacement Comparison & Approval Modal */}
      {isReplacementModalOpen && selectedImage && activePendingReplacement ? (
        <ReplacementApprovalModal
          isOpen={isReplacementModalOpen}
          onClose={() => setIsReplacementModalOpen(false)}
          image={selectedImage}
          batch={batch}
          proposedVersion={activePendingReplacement}
          originalAnnotations={currentImageAnnotations.annotations.filter(
            (ann) =>
              (ann.versionNumber || 1) ===
              (selectedImage.current_version_number || 1)
          )}
          onDecisionCompleted={handleReplacementDecisionCompleted}
          canReview={canReview}
        />
      ) : null}

      {/* Image Versioning: Audit Trail & Version History Modal */}
      {isVersionHistoryOpen && selectedImage ? (
        <VersionHistoryModal
          isOpen={isVersionHistoryOpen}
          onClose={() => setIsVersionHistoryOpen(false)}
          image={selectedImage}
        />
      ) : null}
    </div>
  );
}
