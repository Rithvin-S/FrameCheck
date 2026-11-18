import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { FileDropSelector } from '../components/FileDropSelector.jsx';
import { ThumbnailFilmstrip } from '../components/ThumbnailFilmstrip.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  listBatchAnnotations,
  subscribeToBatchReviewRealtime,
} from '../services/annotationService.js';
import { downloadBatchReviewReport } from '../services/batchPdfReportService.js';
import {
  deriveBatchReviewStatus,
  getBatchById,
  listBatchImages,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUSES,
} from '../services/batchService.js';
import {
  fetchBatchActivityFeed,
  formatActivityRelativeTime,
  getActivityActionText,
  getActivityCategory,
} from '../services/activityService.js';
import { getReviewerColor } from '../services/annotationState.js';
import {
  prepareStagedFiles,
  recomputeDuplicateFlags,
  uploadBatchImages,
} from '../services/imageUploadService.js';
import { ROLES, canUserReview } from '../services/profileService.js';
import './DashboardPage.css';
import './BatchDetailPage.css';

function formatDateTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStorageSize(bytes) {
  if (!bytes || Number.isNaN(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Redesigned Batch Overview & Management Dashboard (FrameCheck 2.0).
 * Displays interactive filmstrip with instant hover previews, review progress circle,
 * comprehensive batch statistics, reviewer activity, and batch metadata.
 */
export function BatchDetailPage() {
  const { batchId } = useParams();
  const { user, profile } = useAuth();
  const canReview = canUserReview(profile);

  const [batch, setBatch] = useState(null);
  const [images, setImages] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [activities, setActivities] = useState([]);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [stagedItems, setStagedItems] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState(null);

  const [reportProgress, setReportProgress] = useState({
    generating: false,
    current: 0,
    total: 0,
  });
  const [reportNotice, setReportNotice] = useState(null);

  const [showProgressBreakdown, setShowProgressBreakdown] = useState(false);
  const [copiedBatchId, setCopiedBatchId] = useState(false);

  const progressCardRef = useRef(null);
  const breakdownPopoverRef = useRef(null);

  // Load all initial batch data in parallel
  const loadBatchData = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      const batchRow = await getBatchById(batchId);
      if (!batchRow) {
        setBatch(null);
        setImages([]);
        setAnnotations([]);
        setActivities([]);
        return;
      }

      const [imageRows, annotationRows, activityFeed] = await Promise.all([
        listBatchImages(batchId),
        listBatchAnnotations(batchId).catch((err) => {
          console.warn('Failed to load batch annotations:', err);
          return [];
        }),
        fetchBatchActivityFeed({ batchId, limit: 30 }).catch((err) => {
          console.warn('Failed to load batch activity feed:', err);
          return [];
        }),
      ]);

      setBatch(batchRow);
      setImages(imageRows);
      setAnnotations(annotationRows || []);
      setActivities(activityFeed || []);

      setSelectedImageId((prevId) => {
        if (prevId && imageRows.some((img) => img.id === prevId)) {
          return prevId;
        }
        return imageRows[0]?.id ?? null;
      });
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to load batch overview details.');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    loadBatchData();
  }, [loadBatchData]);

  // Real-time synchronization
  useEffect(() => {
    if (!batchId) return undefined;

    const unsubscribe = subscribeToBatchReviewRealtime({
      batchId,
      onAnnotationUpsert: (upserted) => {
        setAnnotations((prev) => {
          const index = prev.findIndex((a) => a.id === upserted.id);
          if (index >= 0) {
            const next = [...prev];
            next[index] = { ...next[index], ...upserted };
            return next;
          }
          return [...prev, upserted];
        });
      },
      onAnnotationDelete: ({ id }) => {
        setAnnotations((prev) => prev.filter((a) => a.id !== id));
      },
      onBatchImageChange: (changedImage) => {
        setImages((prev) =>
          prev.map((img) => (img.id === changedImage.id ? { ...img, ...changedImage } : img))
        );
      },
      onBatchActivityEvent: (event) => {
        if (event && event.id) {
          setActivities((prev) => [event, ...prev.filter((a) => a.id !== event.id)].slice(0, 30));
        }
      },
    });

    return () => {
      unsubscribe?.();
    };
  }, [batchId]);

  // Click-outside and Escape dismiss for progress breakdown popover
  useEffect(() => {
    if (!showProgressBreakdown) return undefined;

    const handleMouseDown = (e) => {
      if (
        breakdownPopoverRef.current &&
        !breakdownPopoverRef.current.contains(e.target) &&
        !progressCardRef.current?.contains(e.target)
      ) {
        setShowProgressBreakdown(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowProgressBreakdown(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showProgressBreakdown]);

  const canAddImages = Boolean(
    batch && (batch.owner_id === user?.id || profile?.role === ROLES.ADMIN)
  );

  const existingFilenames = useMemo(
    () => images.map((img) => img.original_filename),
    [images]
  );

  // File drop handling for Add Images
  const handleFilesSelected = useCallback(
    async (fileList) => {
      setUploadNotice(null);
      const nextItems = await prepareStagedFiles(
        fileList,
        existingFilenames,
        stagedItems
      );
      setStagedItems(nextItems);
    },
    [existingFilenames, stagedItems]
  );

  const handleRemoveItem = useCallback(
    (itemId) => {
      setStagedItems((prev) =>
        recomputeDuplicateFlags(
          prev.filter((item) => item.id !== itemId),
          existingFilenames
        )
      );
    },
    [existingFilenames]
  );

  const handleClearPending = useCallback(() => {
    setStagedItems((prev) =>
      recomputeDuplicateFlags(
        prev.filter((item) => item.status === 'uploaded'),
        existingFilenames
      )
    );
    setUploadNotice(null);
  }, [existingFilenames]);

  const handleItemUpdate = useCallback((itemId, patch) => {
    setStagedItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
    );
  }, []);

  const readyOrFailedCount = stagedItems.filter(
    (item) => item.status === 'ready' || item.status === 'failed'
  ).length;
  const failedCount = stagedItems.filter((item) => item.status === 'failed').length;

  const handleAddUpload = async () => {
    if (!batch || readyOrFailedCount === 0) return;

    setUploadNotice(null);
    setIsUploading(true);

    try {
      const result = await uploadBatchImages({
        batchId: batch.id,
        ownerId: batch.owner_id,
        items: stagedItems,
        onItemUpdate: handleItemUpdate,
      });

      const [refreshedBatch, refreshedImages] = await Promise.all([
        getBatchById(batch.id),
        listBatchImages(batch.id),
      ]);

      if (refreshedBatch) {
        setBatch(refreshedBatch);
      }
      setImages(refreshedImages);

      if (!selectedImageId && refreshedImages.length > 0) {
        setSelectedImageId(refreshedImages[0].id);
      }

      if (result.failedCount > 0) {
        setUploadNotice({
          type: 'info',
          text: `${result.uploadedCount} uploaded, ${result.failedCount} failed. Review the errors below and retry.`,
        });
      } else {
        setUploadNotice({
          type: 'success',
          text: `Added ${result.uploadedCount} ${
            result.uploadedCount === 1 ? 'image' : 'images'
          } to this batch.`,
        });
        setStagedItems([]);
      }
    } catch (error) {
      setUploadNotice({
        type: 'error',
        text: error?.message || 'Unable to upload additional images.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Download PDF Report
  const handleDownloadBatchReport = useCallback(async () => {
    if (!batch || reportProgress.generating || isUploading) {
      return;
    }

    setReportNotice(null);
    setReportProgress({
      generating: true,
      current: 0,
      total: images.length,
    });

    try {
      const [freshBatch, freshImages, freshAnnotations] = await Promise.all([
        getBatchById(batch.id),
        listBatchImages(batch.id),
        listBatchAnnotations(batch.id),
      ]);

      const activeBatch = freshBatch || batch;
      if (freshBatch) setBatch(freshBatch);
      setImages(freshImages);
      setAnnotations(freshAnnotations || []);

      const result = await downloadBatchReviewReport({
        batch: activeBatch,
        images: freshImages,
        annotations: freshAnnotations,
        onProgress: ({ current, total }) => {
          setReportProgress({
            generating: true,
            current: Number(current) || 0,
            total: Number(total) || 0,
          });
        },
      });

      if (result.warnings.length > 0) {
        setReportNotice({
          type: 'info',
          text: `Downloaded ${result.filename} with ${result.warnings.length} image ${
            result.warnings.length === 1 ? 'warning' : 'warnings'
          }: ${result.warnings.join(' ')}`,
        });
      } else {
        setReportNotice({
          type: 'success',
          text: `Downloaded batch report ${result.filename} (${result.imageCount} ${
            result.imageCount === 1 ? 'image' : 'images'
          }, ${result.annotationCount} ${
            result.annotationCount === 1 ? 'annotation' : 'annotations'
          }).`,
        });
      }
    } catch (error) {
      setReportNotice({
        type: 'error',
        text: error?.message || 'Unable to generate batch PDF report.',
      });
    } finally {
      setReportProgress({ generating: false, current: 0, total: 0 });
    }
  }, [batch, images.length, isUploading, reportProgress.generating]);

  // Calculations for batch overview & statistics
  const totalImages = images.length;
  const totalAnnotations = annotations.length;
  const resolvedAnnotationsCount = annotations.filter((a) => a.status === 'resolved').length;
  const openAnnotationsCount = totalAnnotations - resolvedAnnotationsCount;

  const totalBytes = useMemo(
    () => images.reduce((sum, img) => sum + (Number(img.file_size) || 0), 0),
    [images]
  );

  const annotationsByImageId = useMemo(() => {
    const map = new Map();
    for (const ann of annotations) {
      if (!ann.image_id) continue;
      if (!map.has(ann.image_id)) {
        map.set(ann.image_id, []);
      }
      map.get(ann.image_id).push(ann);
    }
    return map;
  }, [annotations]);

  // Image status breakdown
  const completedImagesCount = images.filter((img) => img.is_completed).length;
  const inReviewImagesCount = images.filter(
    (img) => !img.is_completed && (annotationsByImageId.get(img.id)?.length || 0) > 0
  ).length;
  const notStartedImagesCount = totalImages - completedImagesCount - inReviewImagesCount;

  // Image-review progress percentage (calculated strictly from image review completion)
  const progressPercent = totalImages > 0 ? Math.round((completedImagesCount / totalImages) * 100) : 0;

  // Batch review status
  const batchReviewStatus = deriveBatchReviewStatus({
    imageCount: totalImages,
    completedImageCount: completedImagesCount,
    totalAnnotationCount: totalAnnotations,
    openAnnotationCount: openAnnotationsCount,
  });

  // Reviewer participation aggregation
  const participatingReviewers = useMemo(() => {
    const map = new Map();

    for (const ann of annotations) {
      const uid = ann.created_by;
      if (!uid) continue;
      const displayName = ann.creator?.display_name || 'Reviewer';
      if (!map.has(uid)) {
        map.set(uid, {
          userId: uid,
          name: displayName,
          color: getReviewerColor(uid),
          annotationCount: 0,
          resolvedCount: 0,
          lastActive: ann.created_at,
        });
      }
      const record = map.get(uid);
      record.annotationCount += 1;
      if (ann.status === 'resolved') {
        record.resolvedCount += 1;
      }
      if (new Date(ann.created_at) > new Date(record.lastActive)) {
        record.lastActive = ann.created_at;
      }
    }

    for (const act of activities) {
      const uid = act.actorId;
      if (!uid) continue;
      const displayName = act.actorName || 'Reviewer';
      if (!map.has(uid)) {
        map.set(uid, {
          userId: uid,
          name: displayName,
          color: getReviewerColor(uid),
          annotationCount: 0,
          resolvedCount: 0,
          lastActive: act.occurredAt,
        });
      }
      const record = map.get(uid);
      if (act.occurredAt && new Date(act.occurredAt) > new Date(record.lastActive)) {
        record.lastActive = act.occurredAt;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.annotationCount - a.annotationCount);
  }, [annotations, activities]);

  const handleCopyBatchId = () => {
    if (!batch?.id) return;
    navigator.clipboard?.writeText(batch.id);
    setCopiedBatchId(true);
    setTimeout(() => setCopiedBatchId(false), 2000);
  };

  // SVG Circular progress metrics
  const ringRadius = 44;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference - (progressPercent / 100) * ringCircumference;

  // Breakdown popover position
  const breakdownPopoverCoords = useMemo(() => {
    if (!showProgressBreakdown || !progressCardRef.current) return null;
    const rect = progressCardRef.current.getBoundingClientRect();
    const width = 340;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - width - 16));
    const top = rect.bottom + 8;
    return { top, left, width };
  }, [showProgressBreakdown]);

  if (loading) {
    return (
      <main className="fc-page-main">
        <div className="fc-batch-panel">
          <div className="fc-empty-state" aria-busy="true">
            <div className="fc-spinner-row">
              <span className="fc-spinner" aria-hidden="true" />
              <span>Loading batch overview…</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (errorMessage) {
    return (
      <main className="fc-page-main">
        <div className="fc-alert fc-alert-error" role="alert">
          {errorMessage}
        </div>
        <div>
          <Link to="/dashboard" className="fc-btn fc-btn-secondary">
            Back to Batches
          </Link>
        </div>
      </main>
    );
  }

  if (!batch) {
    return (
      <main className="fc-page-main">
        <section className="fc-batch-panel">
          <div className="fc-empty-state">
            <h1 className="fc-empty-title">Batch Not Found</h1>
            <p className="fc-empty-text">
              This batch does not exist or you do not have permission to view it.
            </p>
            <Link to="/dashboard" className="fc-btn fc-btn-primary">
              Back to Batches
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="fc-page-main fc-batch-overview-page">
      {/* 1. Redesigned Batch Header */}
      <header className="fc-batch-header-card" aria-label="Batch Overview Header">
        <div className="fc-batch-header-main">
          <div className="fc-batch-header-identity">
            <Link to="/dashboard" className="fc-batch-back-breadcrumb" title="Return to all batches">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              <span>Back to Batches</span>
            </Link>

            <div className="fc-batch-title-row">
              <h1 className="fc-batch-heading" title={batch.name}>{batch.name}</h1>
              {batchReviewStatus && REVIEW_STATUS_LABELS[batchReviewStatus] ? (
                <span className={`fc-batch-status-pill fc-batch-status-${batchReviewStatus}`} title={`Overall batch review status: ${REVIEW_STATUS_LABELS[batchReviewStatus]}`}>
                  <span className="fc-status-dot" aria-hidden="true" />
                  {REVIEW_STATUS_LABELS[batchReviewStatus]}
                </span>
              ) : null}
            </div>

            <div className="fc-batch-meta-line">
              <span className="fc-batch-meta-cell">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <span>Owner: <strong>{batch.ownerName}</strong>{batch.owner_id === user.id ? ' (You)' : ''}</span>
              </span>

              <span className="fc-batch-meta-sep" aria-hidden="true">•</span>

              <span className="fc-batch-meta-cell" title={`Created: ${formatDateTime(batch.created_at)}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>Created {formatDateTime(batch.created_at)}</span>
              </span>

              <span className="fc-batch-meta-sep" aria-hidden="true">•</span>

              <span className="fc-batch-meta-cell" title={`Last updated: ${formatDateTime(batch.updated_at)}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>Updated {formatDateTime(batch.updated_at)}</span>
              </span>
            </div>
          </div>

          <div className="fc-batch-header-actions" role="toolbar" aria-label="Batch actions">
            {images.length > 0 ? (
              canReview ? (
                <Link
                  to={
                    selectedImageId
                      ? `/batches/${batch.id}/review?image=${selectedImageId}`
                      : `/batches/${batch.id}/review`
                  }
                  className="fc-btn fc-btn-primary fc-btn-action-primary"
                  title="Open Review Workspace with interactive annotation tools"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                  <span>Open Review Workspace</span>
                </Link>
              ) : (
                <Link
                  to={
                    selectedImageId
                      ? `/batches/${batch.id}/view?image=${selectedImageId}`
                      : `/batches/${batch.id}/view`
                  }
                  className="fc-btn fc-btn-primary fc-btn-action-primary"
                  title="Open dedicated image viewer to browse all batch images"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>View Images</span>
                </Link>
              )
            ) : null}

            <button
              type="button"
              className="fc-btn fc-btn-secondary"
              onClick={handleDownloadBatchReport}
              disabled={reportProgress.generating || isUploading}
              title="Download consolidated PDF review report"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>
                {reportProgress.generating
                  ? reportProgress.total > 0
                    ? `Generating PDF (${reportProgress.current}/${reportProgress.total})…`
                    : 'Generating PDF…'
                  : 'Download Report'}
              </span>
            </button>

            {canAddImages ? (
              <button
                type="button"
                className={`fc-btn ${images.length > 0 ? 'fc-btn-secondary' : 'fc-btn-primary'}`}
                onClick={() => setShowAddPanel((prev) => !prev)}
                disabled={isUploading || reportProgress.generating}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>{showAddPanel ? 'Close Uploader' : 'Add Images'}</span>
              </button>
            ) : (
              <span className="fc-readonly-pill">View-only access</span>
            )}
          </div>
        </div>
      </header>

      {/* Report status alert */}
      {reportNotice ? (
        <div className={`fc-alert fc-alert-${reportNotice.type}`} role={reportNotice.type === 'error' ? 'alert' : 'status'}>
          {reportNotice.text}
        </div>
      ) : null}

      {/* Collapsible Add Images Card */}
      {canAddImages && showAddPanel ? (
        <section className="fc-add-images-card" aria-label="Add images to batch">
          <div className="fc-add-images-header">
            <div className="fc-add-images-title-group">
              <h2 className="fc-add-images-title">Add Images to Batch</h2>
              <p className="fc-add-images-subtitle">Drop new images or an entire folder to append to this batch</p>
            </div>
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm"
              onClick={() => {
                setShowAddPanel(false);
                setStagedItems([]);
                setUploadNotice(null);
              }}
              disabled={isUploading}
            >
              Close
            </button>
          </div>

          {uploadNotice ? (
            <div className={`fc-alert fc-alert-${uploadNotice.type}`} role={uploadNotice.type === 'error' ? 'alert' : 'status'}>
              {uploadNotice.text}
            </div>
          ) : null}

          <FileDropSelector
            items={stagedItems}
            onFilesSelected={handleFilesSelected}
            onRemoveItem={handleRemoveItem}
            onClearPending={handleClearPending}
            disabled={isUploading}
            isUploading={isUploading}
          />

          <div className="fc-add-images-footer">
            <button
              type="button"
              className="fc-btn fc-btn-primary"
              onClick={handleAddUpload}
              disabled={isUploading || readyOrFailedCount === 0}
            >
              {isUploading
                ? 'Uploading…'
                : failedCount > 0
                  ? `Retry Failed (${failedCount})`
                  : `Upload ${readyOrFailedCount} ${readyOrFailedCount === 1 ? 'Image' : 'Images'}`}
            </button>
          </div>
        </section>
      ) : null}

      {images.length === 0 ? (
        <section className="fc-batch-panel">
          <div className="fc-empty-state">
            <div className="fc-empty-icon" aria-hidden="true">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <h2 className="fc-empty-title">No images in this batch</h2>
            <p className="fc-empty-text">
              {canAddImages
                ? 'Add JPG, JPEG, PNG, or WEBP images or an entire folder to start populating this batch.'
                : 'The batch owner has not uploaded any images to this batch yet.'}
            </p>
            {canAddImages && !showAddPanel ? (
              <button
                type="button"
                className="fc-btn fc-btn-primary"
                onClick={() => setShowAddPanel(true)}
              >
                Add Images
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          {/* 2. Interactive Horizontal Image Filmstrip */}
          <section className="fc-overview-filmstrip-container" aria-label="Batch image gallery">
            <div className="fc-section-header-row">
              <div className="fc-section-title-wrap">
                <h2 className="fc-section-title">Batch Images</h2>
                <span className="fc-badge-neutral">{images.length}</span>
              </div>
            </div>

            <ThumbnailFilmstrip
              images={images}
              selectedImageId={selectedImageId}
              onSelectImage={setSelectedImageId}
              annotations={annotations}
              canReview={canReview}
            />
          </section>

          {/* 3. Batch Overview and Analytics Section */}
          <section className="fc-overview-dashboard-section" aria-label="Batch statistics and overview">
            {/* Top row: 4 Statistics Cards */}
            <div className="fc-stats-grid">
              <div className="fc-stat-card">
                <div className="fc-stat-card-top">
                  <span className="fc-stat-label">Total Images</span>
                  <span className="fc-stat-icon-bubble fc-bubble-indigo" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </span>
                </div>
                <div className="fc-stat-value">{totalImages}</div>
                <div className="fc-stat-subtext">{formatStorageSize(totalBytes)} total storage</div>
              </div>

              <div className="fc-stat-card">
                <div className="fc-stat-card-top">
                  <span className="fc-stat-label">Feedback Annotations</span>
                  <span className="fc-stat-icon-bubble fc-bubble-purple" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                </div>
                <div className="fc-stat-value">{totalAnnotations}</div>
                <div className="fc-stat-subtext">
                  Across {annotationsByImageId.size} {annotationsByImageId.size === 1 ? 'image' : 'images'}
                </div>
              </div>

              <div className="fc-stat-card">
                <div className="fc-stat-card-top">
                  <span className="fc-stat-label">Resolved Feedback</span>
                  <span className="fc-stat-icon-bubble fc-bubble-green" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                </div>
                <div className="fc-stat-value fc-text-success">{resolvedAnnotationsCount}</div>
                <div className="fc-stat-subtext">
                  {totalAnnotations > 0
                    ? `${Math.round((resolvedAnnotationsCount / totalAnnotations) * 100)}% resolution rate`
                    : 'No feedback recorded'}
                </div>
              </div>

              <div className="fc-stat-card">
                <div className="fc-stat-card-top">
                  <span className="fc-stat-label">Open Issues</span>
                  <span className="fc-stat-icon-bubble fc-bubble-amber" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </span>
                </div>
                <div className={`fc-stat-value ${openAnnotationsCount > 0 ? 'fc-text-warning' : 'fc-text-muted'}`}>
                  {openAnnotationsCount}
                </div>
                <div className="fc-stat-subtext">
                  {openAnnotationsCount > 0
                    ? canReview
                      ? 'Pending reviewer resolution'
                      : 'Pending feedback resolution'
                    : 'All feedback resolved'}
                </div>
              </div>
            </div>

            {/* Middle Row: Review Progress Card + Batch Information Card */}
            <div className="fc-overview-split-row">
              {/* B. Animated Circular Review Progress Card */}
              <div
                ref={progressCardRef}
                className="fc-overview-card fc-progress-card"
                onClick={() => setShowProgressBreakdown((prev) => !prev)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setShowProgressBreakdown((prev) => !prev);
                  }
                }}
                aria-expanded={showProgressBreakdown}
                aria-haspopup="dialog"
                title="Click to view full review progress breakdown"
              >
                <div className="fc-card-header-clean">
                  <div className="fc-card-title-group">
                    <h3 className="fc-card-title">Image Review Progress</h3>
                    <span className="fc-card-subtitle">Manual image completion rate</span>
                  </div>
                  <span className="fc-card-info-badge" aria-hidden="true">
                    Breakdown ▾
                  </span>
                </div>

                <div className="fc-progress-card-body">
                  <div className="fc-progress-svg-wrap">
                    <svg width="110" height="110" viewBox="0 0 110 110" className="fc-progress-svg">
                      <circle
                        cx="55"
                        cy="55"
                        r={ringRadius}
                        className="fc-progress-circle-track"
                        strokeWidth="8"
                      />
                      <circle
                        cx="55"
                        cy="55"
                        r={ringRadius}
                        className={`fc-progress-circle-fill ${progressPercent === 100 ? 'fc-progress-complete' : ''}`}
                        strokeWidth="8"
                        strokeDasharray={ringCircumference}
                        strokeDashoffset={ringDashOffset}
                      />
                    </svg>
                    <div className="fc-progress-svg-center">
                      <span className="fc-progress-percentage">{progressPercent}%</span>
                      <span className="fc-progress-center-sub">COMPLETED</span>
                    </div>
                  </div>

                  <div className="fc-progress-metrics-list">
                    <div className="fc-progress-metric-row">
                      <span className="fc-progress-dot fc-dot-completed" aria-hidden="true" />
                      <span className="fc-progress-metric-name">Completed</span>
                      <span className="fc-progress-metric-val">{completedImagesCount}</span>
                    </div>

                    <div className="fc-progress-metric-row">
                      <span className="fc-progress-dot fc-dot-in-review" aria-hidden="true" />
                      <span className="fc-progress-metric-name">In Review</span>
                      <span className="fc-progress-metric-val">{inReviewImagesCount}</span>
                    </div>

                    <div className="fc-progress-metric-row">
                      <span className="fc-progress-dot fc-dot-not-started" aria-hidden="true" />
                      <span className="fc-progress-metric-name">Not Started</span>
                      <span className="fc-progress-metric-val">{notStartedImagesCount}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* D. Batch Information Card */}
              <div className="fc-overview-card fc-info-card">
                <div className="fc-card-header-clean">
                  <div className="fc-card-title-group">
                    <h3 className="fc-card-title">Batch Metadata</h3>
                    <span className="fc-card-subtitle">General properties and details</span>
                  </div>
                </div>

                <div className="fc-batch-info-grid">
                  <div className="fc-info-item">
                    <span className="fc-info-label">Batch Owner</span>
                    <span className="fc-info-val">
                      {batch.ownerName}
                      {batch.owner_id === user.id ? <span className="fc-badge-you">You</span> : null}
                    </span>
                  </div>

                  <div className="fc-info-item">
                    <span className="fc-info-label">Total Images</span>
                    <span className="fc-info-val">{totalImages} assets ({formatStorageSize(totalBytes)})</span>
                  </div>

                  <div className="fc-info-item">
                    <span className="fc-info-label">Created Date</span>
                    <span className="fc-info-val">{formatDateTime(batch.created_at)}</span>
                  </div>

                  <div className="fc-info-item">
                    <span className="fc-info-label">Last Modified</span>
                    <span className="fc-info-val">{formatDateTime(batch.updated_at)}</span>
                  </div>

                  <div className="fc-info-item fc-info-item-wide">
                    <span className="fc-info-label">Batch Identifier</span>
                    <div className="fc-batch-id-copy-row">
                      <code className="fc-batch-id-code">{batch.id}</code>
                      <button
                        type="button"
                        className="fc-copy-btn"
                        onClick={handleCopyBatchId}
                        title="Copy Batch ID to clipboard"
                        aria-label="Copy Batch ID to clipboard"
                      >
                        {copiedBatchId ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Row: C. Reviewer Activity and Participation (Reviewers & Admins only) */}
            {canReview ? (
              <div className="fc-overview-card fc-activity-card">
                <div className="fc-card-header-clean">
                  <div className="fc-card-title-group">
                    <h3 className="fc-card-title">Reviewer Activity & Participation</h3>
                    <span className="fc-card-subtitle">Active reviewers and recent timeline</span>
                  </div>
                </div>

                <div className="fc-activity-split-body">
                  {/* Left: Reviewers List */}
                  <div className="fc-activity-reviewers-pane">
                    <h4 className="fc-pane-heading">
                      <span>Contributing Reviewers</span>
                      <span className="fc-badge-neutral">{participatingReviewers.length}</span>
                    </h4>

                    {participatingReviewers.length === 0 ? (
                      <div className="fc-pane-empty">
                        <span>No reviewer feedback recorded yet.</span>
                        <p>Open the Review Workspace to begin leaving feedback.</p>
                      </div>
                    ) : (
                      <div className="fc-reviewers-list" role="list">
                        {participatingReviewers.map((rev) => {
                          const initials = (rev.name || 'R').slice(0, 2).toUpperCase();
                          return (
                            <div key={rev.userId} className="fc-reviewer-item" role="listitem">
                              <span
                                className="fc-reviewer-avatar"
                                style={{ backgroundColor: rev.color }}
                                aria-hidden="true"
                              >
                                {initials}
                              </span>
                              <div className="fc-reviewer-info">
                                <span className="fc-reviewer-name">{rev.name}</span>
                                <span className="fc-reviewer-meta">
                                  {rev.annotationCount} {rev.annotationCount === 1 ? 'annotation' : 'annotations'}
                                  {rev.resolvedCount > 0 ? ` • ${rev.resolvedCount} resolved` : ''}
                                </span>
                              </div>
                              <span className="fc-reviewer-time" title={`Active: ${formatDateTime(rev.lastActive)}`}>
                                {formatActivityRelativeTime(rev.lastActive)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right: Recent Activity Feed */}
                  <div className="fc-activity-feed-pane">
                    <h4 className="fc-pane-heading">
                      <span>Recent Batch Events</span>
                      <span className="fc-badge-neutral">{activities.length}</span>
                    </h4>

                    {activities.length === 0 ? (
                      <div className="fc-pane-empty">
                        <span>No activity recorded yet.</span>
                        <p>All comments, completions, and edits will appear here.</p>
                      </div>
                    ) : (
                      <div className="fc-activity-timeline" role="feed">
                        {activities.slice(0, 8).map((act) => {
                          const actionDesc = getActivityActionText(act);
                          const category = getActivityCategory(act.eventType, act.metadata);
                          return (
                            <div key={act.id} className="fc-timeline-row">
                              <span className={`fc-timeline-dot fc-timeline-cat-${category}`} aria-hidden="true" />
                              <div className="fc-timeline-text-col">
                                <span className="fc-timeline-actor">
                                  <strong>{act.actorName}</strong> {actionDesc}
                                </span>
                                {act.imageFilename ? (
                                  <span className="fc-timeline-target">{act.imageFilename}</span>
                                ) : null}
                              </div>
                              <span className="fc-timeline-time" title={formatDateTime(act.occurredAt)}>
                                {formatActivityRelativeTime(act.occurredAt)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {/* Floating Review Progress Breakdown Popover */}
          {showProgressBreakdown && breakdownPopoverCoords && typeof document !== 'undefined'
            ? createPortal(
                <div
                  ref={breakdownPopoverRef}
                  className="fc-progress-popover"
                  style={{
                    top: `${breakdownPopoverCoords.top}px`,
                    left: `${breakdownPopoverCoords.left}px`,
                    width: `${breakdownPopoverCoords.width}px`,
                  }}
                  role="dialog"
                  aria-label="Image Review Status Breakdown"
                >
                  <div className="fc-popover-header">
                    <div>
                      <h4 className="fc-popover-title">Review Completion Breakdown</h4>
                      <span className="fc-popover-subtitle">
                        {completedImagesCount} of {totalImages} images marked review complete
                      </span>
                    </div>
                    <button
                      type="button"
                      className="fc-popover-close-btn"
                      onClick={() => setShowProgressBreakdown(false)}
                      aria-label="Close breakdown popup"
                    >
                      ×
                    </button>
                  </div>

                  <div className="fc-popover-body">
                    {/* Visual Segmented Bar */}
                    <div className="fc-segmented-bar">
                      <span
                        className="fc-segment fc-seg-completed"
                        style={{ width: `${totalImages > 0 ? (completedImagesCount / totalImages) * 100 : 0}%` }}
                        title={`Completed: ${completedImagesCount}`}
                      />
                      <span
                        className="fc-segment fc-seg-in-review"
                        style={{ width: `${totalImages > 0 ? (inReviewImagesCount / totalImages) * 100 : 0}%` }}
                        title={`In Review: ${inReviewImagesCount}`}
                      />
                      <span
                        className="fc-segment fc-seg-not-started"
                        style={{ width: `${totalImages > 0 ? (notStartedImagesCount / totalImages) * 100 : 0}%` }}
                        title={`Not Started: ${notStartedImagesCount}`}
                      />
                    </div>

                    <div className="fc-popover-rows">
                      <div className="fc-popover-row">
                        <span className="fc-progress-dot fc-dot-completed" aria-hidden="true" />
                        <div className="fc-popover-row-text">
                          <span className="fc-popover-row-name">Completed Images</span>
                          <span className="fc-popover-row-desc">Fully reviewed and marked completed</span>
                        </div>
                        <span className="fc-popover-row-count">{completedImagesCount}</span>
                      </div>

                      <div className="fc-popover-row">
                        <span className="fc-progress-dot fc-dot-in-review" aria-hidden="true" />
                        <div className="fc-popover-row-text">
                          <span className="fc-popover-row-name">Images In Review</span>
                          <span className="fc-popover-row-desc">Contain active feedback or annotations</span>
                        </div>
                        <span className="fc-popover-row-count">{inReviewImagesCount}</span>
                      </div>

                      <div className="fc-popover-row">
                        <span className="fc-progress-dot fc-dot-not-started" aria-hidden="true" />
                        <div className="fc-popover-row-text">
                          <span className="fc-popover-row-name">Not Started Images</span>
                          <span className="fc-popover-row-desc">No review feedback recorded yet</span>
                        </div>
                        <span className="fc-popover-row-count">{notStartedImagesCount}</span>
                      </div>
                    </div>

                    <div className="fc-popover-footnote">
                      Progress is calculated from manual image review completion, independent from annotation resolution status.
                    </div>

                    {canReview ? (
                      <Link
                        to={
                          selectedImageId
                            ? `/batches/${batch.id}/review?image=${selectedImageId}`
                            : `/batches/${batch.id}/review`
                        }
                        className="fc-popover-action-btn"
                      >
                        Open Review Workspace →
                      </Link>
                    ) : (
                      <Link
                        to={
                          selectedImageId
                            ? `/batches/${batch.id}/view?image=${selectedImageId}`
                            : `/batches/${batch.id}/view`
                        }
                        className="fc-popover-action-btn"
                      >
                        View Images →
                      </Link>
                    )}
                  </div>
                </div>,
                document.body
              )
            : null}
        </>
      )}
    </main>
  );
}
