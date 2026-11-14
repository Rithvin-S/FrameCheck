import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AnnotationLayer } from '../components/AnnotationLayer.jsx';
import { AnnotationToolbar } from '../components/AnnotationToolbar.jsx';
import { ImagePreview } from '../components/ImagePreview.jsx';
import { ReviewHeader } from '../components/ReviewHeader.jsx';
import { ReviewSidebar } from '../components/ReviewSidebar.jsx';
import { ThumbnailFilmstrip } from '../components/ThumbnailFilmstrip.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  createAnnotation,
  fetchCreatorDisplayName,
  listBatchAnnotations,
  mapAnnotationRow,
  restoreAnnotation,
  setAnnotationStatus,
  softDeleteAnnotation,
  subscribeToBatchReviewRealtime,
  updateAnnotationColor,
  updateAnnotationComment,
  updateAnnotationGeometry,
} from '../services/annotationService.js';
import { downloadImageReviewReport } from '../services/imagePdfReportService.js';
import {
  DEFAULT_ANNOTATION_COLOR,
  annotationsReducer,
  getImageAnnotationState,
  hasGeometryChanged,
} from '../services/annotationState.js';
import {
  deriveBatchReviewStatus,
  getBatchById,
  listBatchImages,
  updateBatchImageCompletion,
} from '../services/batchService.js';
import { ROLES } from '../services/profileService.js';
import './ReviewWorkspacePage.css';

/**
 * Dedicated desktop-first image review workspace with persisted Supabase annotations,
 * required mistake explanation comments, creator-only edit/resolve/delete controls,
 * and command-based undo/redo synchronized with PostgreSQL.
 */
export function ReviewWorkspacePage() {
  const { batchId } = useParams();
  const [, setSearchParams] = useSearchParams();
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

  const [toolMode, setToolMode] = useState('draw');
  const [activeDrawColor, setActiveDrawColor] = useState(
    DEFAULT_ANNOTATION_COLOR
  );
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [draftAnnotation, setDraftAnnotation] = useState(null);
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [busyAnnotationIds, setBusyAnnotationIds] = useState([]);
  const [updatingCompletionId, setUpdatingCompletionId] = useState(null);
  const [generatingImageReport, setGeneratingImageReport] = useState(false);
  const [realtimeNotice, setRealtimeNotice] = useState('');
  const [activeReviewers, setActiveReviewers] = useState([]);

  const loadSeqRef = useRef(0);
  const mutationQueueRef = useRef(Promise.resolve());
  const batchImageIdsRef = useRef(new Set());
  const creatorNameCacheRef = useRef(new Map());
  const inFlightNameLookupsRef = useRef(new Map());
  const localMutationIdsRef = useRef(new Map());
  const pendingLookupAnnotationIdsRef = useRef(new Set());
  const wasDisconnectedRef = useRef(false);

  useEffect(() => {
    if (isReadOnlyMode) {
      setDraftAnnotation(null);
      setSelectedAnnotationId(null);
      setToolMode('select');
    }
  }, [isReadOnlyMode]);

  const runQueuedSync = useCallback((task, annotationId = null) => {
    setPendingSyncCount((count) => count + 1);
    if (annotationId) {
      const prevCount = localMutationIdsRef.current.get(annotationId) ?? 0;
      localMutationIdsRef.current.set(annotationId, prevCount + 1);
    }

    const run = mutationQueueRef.current.then(task, task);
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
      setPendingSyncCount((count) => Math.max(0, count - 1));
    });
  }, []);

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

      const [imageRows, annotationRows] = await Promise.all([
        listBatchImages(batchId),
        listBatchAnnotations(batchId),
      ]);
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

    let disposed = false;
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
        const [imageRows, annotationRows] = await Promise.all([
          listBatchImages(batch.id),
          listBatchAnnotations(batch.id),
        ]);
        if (disposed) return;

        batchImageIdsRef.current = new Set(imageRows.map((img) => img.id));
        for (const ann of annotationRows) {
          if (ann.createdBy && ann.creatorName) {
            creatorNameCacheRef.current.set(ann.createdBy, ann.creatorName);
          }
        }
        setImages(imageRows);
        dispatchAnnotations({
          type: 'RESYNC_BATCH_ANNOTATIONS',
          imageIds: imageRows.map((img) => img.id),
          annotations: annotationRows,
        });
      } catch {
        if (!disposed) {
          setRealtimeNotice(
            'Reconnected to live sync, but refreshing latest changes failed. Reload if needed.'
          );
        }
      }
    };

    const handleRealtimeUpsert = async (rawRow) => {
      if (disposed || !rawRow?.id) return;
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

      if (
        existing &&
        existingMs === incomingMs &&
        existing.comment === (rawRow.comment ?? '') &&
        existing.status === (rawRow.status === 'resolved' ? 'resolved' : 'open') &&
        existing.color === String(rawRow.color || '#dc2626').toLowerCase() &&
        !hasGeometryChanged(existing, {
          cx: Number(rawRow.cx),
          cy: Number(rawRow.cy),
          r: Number(rawRow.r),
        })
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
        if (disposed || !stillActive) return;
        if ((localMutationIdsRef.current.get(rawRow.id) ?? 0) > 0) return;
      }

      const mapped = mapAnnotationRow(rawRow, creatorName);
      if (!mapped) return;

      if (mapped.createdBy && mapped.creatorName) {
        creatorNameCacheRef.current.set(mapped.createdBy, mapped.creatorName);
      }

      dispatchAnnotations({
        type: 'UPSERT_ANNOTATION',
        imageId: mapped.imageId,
        annotation: mapped,
      });
    };

    const handleRealtimeDelete = ({ annotationId, imageId }) => {
      if (disposed || !annotationId || !batchImageIdsRef.current.has(imageId)) {
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
      if (disposed || !imageRow?.id || imageRow.batch_id !== batch.id) return;
      batchImageIdsRef.current.add(imageRow.id);

      setImages((prev) => {
        const index = prev.findIndex((item) => item.id === imageRow.id);
        if (index >= 0) {
          const existing = prev[index];
          if (
            existing.is_completed === imageRow.is_completed &&
            existing.completed_at === imageRow.completed_at &&
            existing.display_order === imageRow.display_order
          ) {
            return prev;
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

    const presenceUser = canReview
      ? {
          user_id: currentUserId,
          display_name: creatorNameFallback,
          role: profile?.role,
        }
      : null;

    const unsubscribe = subscribeToBatchReviewRealtime({
      batchId: batch.id,
      onAnnotationUpsert: handleRealtimeUpsert,
      onAnnotationDelete: handleRealtimeDelete,
      onBatchImageChange: handleRealtimeBatchImageChange,
      presenceUser,
      onPresenceSync: (reviewers) => {
        if (!disposed) {
          setActiveReviewers(reviewers);
        }
      },
      onStatusChange: (status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          setRealtimeNotice('');
          if (wasDisconnectedRef.current) {
            wasDisconnectedRef.current = false;
            resyncBatchAfterReconnect();
          }
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          wasDisconnectedRef.current = true;
          setRealtimeNotice(
            'Live collaboration connection interrupted. Attempting to reconnect…'
          );
        }
      },
    });

    return () => {
      disposed = true;
      setActiveReviewers([]);
      unsubscribe();
    };
  }, [batch?.id, currentUserId, canReview, creatorNameFallback, profile?.role]);

  const handleSelectImage = useCallback(
    (nextImageId) => {
      if (nextImageId === selectedImageId) return;
      setSelectedImageId(nextImageId);
      setSelectedAnnotationId(null);
      setDraftAnnotation(null);
      if (nextImageId) {
        setSearchParams({ image: nextImageId }, { replace: true });
      }
    },
    [selectedImageId, setSearchParams]
  );

  const handleSelectAnnotationCard = useCallback(
    (annotation) => {
      if (!annotation) return;
      setActionError('');
      setDraftAnnotation(null);
      if (annotation.imageId !== selectedImageId) {
        setSelectedImageId(annotation.imageId);
        setSearchParams({ image: annotation.imageId }, { replace: true });
      }
      setSelectedAnnotationId(canReview ? annotation.id : null);
    },
    [canReview, selectedImageId, setSearchParams]
  );

  const selectedIndex = useMemo(
    () => images.findIndex((img) => img.id === selectedImageId),
    [images, selectedImageId]
  );

  const selectedImage = selectedIndex >= 0 ? images[selectedIndex] : null;
  const currentPosition = selectedIndex >= 0 ? selectedIndex + 1 : 0;

  const currentImageAnnotations = getImageAnnotationState(
    annotationsByImage,
    selectedImage?.id
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

  const selectedAnnotation = useMemo(
    () =>
      canReview
        ? (currentImageAnnotations.annotations.find(
            (ann) => ann.id === selectedAnnotationId
          ) ?? null)
        : null,
    [canReview, currentImageAnnotations.annotations, selectedAnnotationId]
  );

  const canEditSelected = Boolean(
    canReview && currentUserId && selectedAnnotation?.createdBy === currentUserId
  );

  const handleCreateDraft = useCallback(
    ({ geometry, color }) => {
      if (!canReview || !selectedImage?.id || !currentUserId) return;
      setActionError('');
      setDraftAnnotation({
        imageId: selectedImage.id,
        cx: geometry.cx,
        cy: geometry.cy,
        r: geometry.r,
        color,
      });
    },
    [canReview, currentUserId, selectedImage?.id]
  );

  const handleConfirmDraft = useCallback(
    async (commentText) => {
      if (!canReview || !draftAnnotation || !currentUserId || isSubmittingDraft) {
        return;
      }
      setIsSubmittingDraft(true);
      setActionError('');

      try {
        const saved = await runQueuedSync(() =>
          createAnnotation({
            imageId: draftAnnotation.imageId,
            createdBy: currentUserId,
            geometry: {
              cx: draftAnnotation.cx,
              cy: draftAnnotation.cy,
              r: draftAnnotation.r,
            },
            color: draftAnnotation.color,
            comment: commentText,
            creatorNameFallback,
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
        setDraftAnnotation(null);
        setSelectedAnnotationId(saved.id);
        setActiveTab((prevTab) => (prevTab === 'resolved' ? 'all' : prevTab));
      } catch (error) {
        setActionError(error?.message || 'Unable to save annotation.');
      } finally {
        setIsSubmittingDraft(false);
      }
    },
    [
      canReview,
      creatorNameFallback,
      currentUserId,
      draftAnnotation,
      isSubmittingDraft,
      runQueuedSync,
    ]
  );

  const handleCancelDraft = useCallback(() => {
    if (isSubmittingDraft) return;
    setDraftAnnotation(null);
    setActionError('');
  }, [isSubmittingDraft]);

  const handleCommitGeometry = useCallback(
    async ({ annotationId, geometry }) => {
      if (!canReview || !selectedImage?.id || !currentUserId) return;
      const imageId = selectedImage.id;
      const target = getImageAnnotationState(
        annotationsByImageRef.current,
        imageId
      ).annotations.find((item) => item.id === annotationId);

      if (!target || target.createdBy !== currentUserId) return;

      const beforeGeometry = { cx: target.cx, cy: target.cy, r: target.r };
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
              afterGeometry: {
                cx: updated.cx,
                cy: updated.cy,
                r: updated.r,
              },
            },
          });
        }, annotationId);
      } catch (error) {
        dispatchAnnotations({
          type: 'UPSERT_ANNOTATION',
          imageId,
          annotation: target,
        });
        setActionError(error?.message || 'Unable to save circle position.');
      }
    },
    [canReview, currentUserId, runQueuedSync, selectedImage?.id]
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
        annotation.createdBy !== currentUserId
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
            dispatchAnnotations({
              type: 'UPSERT_ANNOTATION',
              imageId: updated.imageId,
              annotation: updated,
            });
          }, annotation.id);
          return true;
        } catch (error) {
          setActionError(error?.message || 'Unable to update comment.');
          return false;
        }
      });
    },
    [canReview, currentUserId, runQueuedSync, withBusyAnnotation]
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
          }, annotation.id);
        } catch (error) {
          setActionError(
            error?.message || 'Unable to update annotation resolution status.'
          );
        }
      });
    },
    [canReview, currentUserId, runQueuedSync, withBusyAnnotation]
  );

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
      } catch (error) {
        setActionError(
          error?.message || 'Unable to update image completion status.'
        );
      } finally {
        setUpdatingCompletionId(null);
      }
    },
    [canReview, currentUserId, updatingCompletionId]
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

  return (
    <div className="fc-review-workspace">
      <ReviewHeader
        batchId={batch.id}
        batchName={batch.name}
        batchReviewStatus={batchReviewStatus}
        currentPosition={currentPosition}
        totalImages={images.length}
        activeReviewers={activeReviewers}
      />

      <ThumbnailFilmstrip
        images={images}
        selectedImageId={selectedImageId}
        onSelectImage={handleSelectImage}
        variant="workspace"
      />

      {realtimeNotice ? (
        <div className="fc-realtime-banner" role="status" aria-live="polite">
          {realtimeNotice}
        </div>
      ) : null}

      <div className="fc-workspace-body">
        <main className="fc-workspace-canvas-area">
          <ImagePreview
            image={selectedImage}
            imageIndex={selectedIndex}
            totalImages={images.length}
            onPrev={() => {
              if (selectedIndex > 0) {
                handleSelectImage(images[selectedIndex - 1].id);
              }
            }}
            onNext={() => {
              if (selectedIndex < images.length - 1) {
                handleSelectImage(images[selectedIndex + 1].id);
              }
            }}
            variant="workspace"
            prepareAnnotationLayer
            headerActions={
              selectedImage ? (
                <div className="fc-image-completion-control">
                  {selectedImage.is_completed ? (
                    <span className="fc-image-completed-pill">Completed</span>
                  ) : isReadOnlyMode ? (
                    <span className="fc-image-inreview-pill">In Review</span>
                  ) : null}
                  {canReview ? (
                    <button
                      type="button"
                      className={`fc-btn fc-btn-sm ${
                        selectedImage.is_completed
                          ? 'fc-btn-secondary'
                          : 'fc-btn-success-outline'
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
                  <button
                    type="button"
                    className="fc-btn fc-btn-secondary fc-btn-sm"
                    onClick={handleDownloadImageReport}
                    disabled={generatingImageReport || annotationsLoading}
                  >
                    {generatingImageReport
                      ? 'Generating PDF…'
                      : 'Download Image Report'}
                  </button>
                </div>
              ) : null
            }
            toolbarSlot={
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
                readOnly={isReadOnlyMode}
                disabled={!currentUserId || isReadOnlyMode}
              />
            }
            annotationOverlay={
              selectedImage ? (
                <AnnotationLayer
                  imageId={selectedImage.id}
                  annotations={currentImageAnnotations.annotations}
                  currentUserId={currentUserId}
                  draftAnnotation={draftAnnotation}
                  toolMode={toolMode}
                  activeDrawColor={activeDrawColor}
                  selectedAnnotationId={selectedAnnotation?.id ?? null}
                  onSelectAnnotation={(nextId) => {
                    if (canReview) setSelectedAnnotationId(nextId);
                  }}
                  onCreateDraft={handleCreateDraft}
                  onCommitGeometry={handleCommitGeometry}
                  readOnly={isReadOnlyMode}
                  disabled={isSubmittingDraft || !currentUserId || isReadOnlyMode}
                />
              ) : null
            }
          />
        </main>

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
        />
      </div>
    </div>
  );
}
