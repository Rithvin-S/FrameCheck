import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileDropSelector } from '../components/FileDropSelector.jsx';
import { ImagePreview } from '../components/ImagePreview.jsx';
import { ThumbnailFilmstrip } from '../components/ThumbnailFilmstrip.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { listBatchAnnotations } from '../services/annotationService.js';
import { downloadBatchReviewReport } from '../services/batchPdfReportService.js';
import { getBatchById, listBatchImages } from '../services/batchService.js';
import {
  prepareStagedFiles,
  recomputeDuplicateFlags,
  uploadBatchImages,
} from '../services/imageUploadService.js';
import { ROLES } from '../services/profileService.js';
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

/**
 * Batch detail and basic image viewer page.
 * Owners and Admins can add more images; Reviewers have read-only access.
 */
export function BatchDetailPage() {
  const { batchId } = useParams();
  const { user, profile } = useAuth();

  const [batch, setBatch] = useState(null);
  const [images, setImages] = useState([]);
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

  const loadBatchData = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      const batchRow = await getBatchById(batchId);
      if (!batchRow) {
        setBatch(null);
        setImages([]);
        return;
      }

      const imageRows = await listBatchImages(batchId);
      setBatch(batchRow);
      setImages(imageRows);
      setSelectedImageId((prevId) => {
        if (prevId && imageRows.some((img) => img.id === prevId)) {
          return prevId;
        }
        return imageRows[0]?.id ?? null;
      });
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to load batch details.');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    loadBatchData();
  }, [loadBatchData]);

  const canAddImages = Boolean(
    batch && (batch.owner_id === user.id || profile.role === ROLES.ADMIN)
  );

  const existingFilenames = useMemo(
    () => images.map((img) => img.original_filename),
    [images]
  );

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
      if (freshBatch) {
        setBatch(freshBatch);
      }
      setImages(freshImages);

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

  const selectedIndex = useMemo(
    () => images.findIndex((img) => img.id === selectedImageId),
    [images, selectedImageId]
  );

  const selectedImage = selectedIndex >= 0 ? images[selectedIndex] : null;

  if (loading) {
    return (
      <main className="fc-page-main">
        <div className="fc-batch-panel">
          <div className="fc-empty-state" aria-busy="true">
            <div className="fc-spinner-row">
              <span className="fc-spinner" aria-hidden="true" />
              <span>Loading batch…</span>
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
    <main className="fc-page-main">
      <div className="fc-page-header">
        <div className="fc-page-title-group">
          <Link to="/dashboard" className="fc-breadcrumb-link">
            ← Back to Batches
          </Link>
          <h1 className="fc-page-title">{batch.name}</h1>
          <div className="fc-batch-meta-row">
            <span className="fc-batch-meta-item">
              Owner: <strong>{batch.ownerName}</strong>
              {batch.owner_id === user.id ? ' (You)' : ''}
            </span>
            <span className="fc-batch-meta-item">
              Images: <strong>{images.length}</strong>
            </span>
            <span className="fc-batch-meta-item">
              Created: {formatDateTime(batch.created_at)}
            </span>
            <span className="fc-batch-meta-item">
              Updated: {formatDateTime(batch.updated_at)}
            </span>
          </div>
        </div>

        <div className="fc-page-header-actions">
          {images.length > 0 ? (
            <Link
              to={
                selectedImageId
                  ? `/batches/${batch.id}/review?image=${selectedImageId}`
                  : `/batches/${batch.id}/review`
              }
              className="fc-btn fc-btn-primary"
            >
              Open Review Workspace
            </Link>
          ) : null}

          <button
            type="button"
            className="fc-btn fc-btn-secondary"
            onClick={handleDownloadBatchReport}
            disabled={reportProgress.generating || isUploading}
          >
            {reportProgress.generating
              ? reportProgress.total > 0
                ? `Generating PDF (${reportProgress.current}/${reportProgress.total})…`
                : 'Generating PDF…'
              : 'Download Batch Report'}
          </button>

          {canAddImages ? (
            <button
              type="button"
              className={`fc-btn ${
                images.length > 0 ? 'fc-btn-secondary' : 'fc-btn-primary'
              }`}
              onClick={() => setShowAddPanel((prev) => !prev)}
              disabled={isUploading || reportProgress.generating}
            >
              {showAddPanel ? 'Hide Uploader' : 'Add Images'}
            </button>
          ) : (
            <span className="fc-readonly-pill">View-only access</span>
          )}
        </div>
      </div>

      {reportNotice ? (
        <div
          className={`fc-alert fc-alert-${reportNotice.type}`}
          role={reportNotice.type === 'error' ? 'alert' : 'status'}
        >
          {reportNotice.text}
        </div>
      ) : null}

      {canAddImages && showAddPanel ? (
        <section className="fc-add-images-card" aria-label="Add images to batch">
          <div className="fc-add-images-header">
            <h2 className="fc-add-images-title">Add Images to Batch</h2>
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
            <div
              className={`fc-alert fc-alert-${uploadNotice.type}`}
              role={uploadNotice.type === 'error' ? 'alert' : 'status'}
            >
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
                  : `Upload ${readyOrFailedCount} ${
                      readyOrFailedCount === 1 ? 'Image' : 'Images'
                    }`}
            </button>
          </div>
        </section>
      ) : null}

      {images.length === 0 ? (
        <section className="fc-batch-panel">
          <div className="fc-empty-state">
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
          <ThumbnailFilmstrip
            images={images}
            selectedImageId={selectedImageId}
            onSelectImage={setSelectedImageId}
          />

          <ImagePreview
            image={selectedImage}
            imageIndex={selectedIndex}
            totalImages={images.length}
            onPrev={() => {
              if (selectedIndex > 0) {
                setSelectedImageId(images[selectedIndex - 1].id);
              }
            }}
            onNext={() => {
              if (selectedIndex < images.length - 1) {
                setSelectedImageId(images[selectedIndex + 1].id);
              }
            }}
          />
        </>
      )}
    </main>
  );
}

