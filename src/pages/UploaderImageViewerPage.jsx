import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { getBatchById, listBatchImages } from '../services/batchService.js';
import { listBatchAnnotations } from '../services/annotationService.js';
import { formatFileSize, getSignedImageUrl } from '../services/imageUploadService.js';
import {
  cancelImageReplacement,
  subscribeToBatchVersionEvents,
} from '../services/imageVersioningService.js';
import { ReplaceImageModal } from '../components/ReplaceImageModal.jsx';
import { VersionHistoryModal } from '../components/VersionHistoryModal.jsx';
import { UploaderAnnotationOverlay } from '../components/UploaderAnnotationOverlay.jsx';
import { UploaderCommentCard } from '../components/UploaderCommentCard.jsx';
import { listImageReferences } from '../services/referenceImageService.js';
import { ReferenceImagesPanel } from '../components/ReferenceImagesPanel.jsx';
import { ReferenceViewerModal } from '../components/ReferenceViewerModal.jsx';
import { ReferenceComparisonModal } from '../components/ReferenceComparisonModal.jsx';
import './UploaderImageViewerPage.css';

/**
 * Lazy-loaded vertical thumbnail card for the uploader filmstrip.
 */
function UploaderFilmstripItem({
  image,
  index,
  isSelected,
  onSelect,
  scrollRootRef,
  annotationCount = 0,
}) {
  const itemRef = useRef(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Lazy load thumbnail when scrolled into view
  useEffect(() => {
    const node = itemRef.current;
    if (!node || shouldLoad) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      {
        root: scrollRootRef?.current ?? null,
        rootMargin: '240px',
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRootRef, shouldLoad]);

  // Fetch signed URL once intersecting
  useEffect(() => {
    if (!shouldLoad || url) return undefined;

    let cancelled = false;
    setLoading(true);
    setHasError(false);

    getSignedImageUrl(image.storage_path)
      .then((signedUrl) => {
        if (!cancelled) {
          setUrl(signedUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [image.storage_path, shouldLoad, url]);

  // Smoothly scroll selected item into view within the rail
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [isSelected]);

  return (
    <button
      ref={itemRef}
      type="button"
      className={`fc-uiv-thumb-card${isSelected ? ' fc-uiv-thumb-selected' : ''}`}
      onClick={() => onSelect(image.id)}
      title={`Image #${index + 1}: ${image.original_filename}${annotationCount > 0 ? ` (${annotationCount} reviewer correction${annotationCount === 1 ? '' : 's'})` : ''}`}
      aria-current={isSelected ? 'true' : undefined}
      role="listitem"
    >
      <div className="fc-uiv-thumb-media">
        {!shouldLoad || (loading && !hasError) ? (
          <div className="fc-uiv-thumb-skeleton" aria-hidden="true" />
        ) : null}

        {hasError ? (
          <div className="fc-uiv-thumb-error">Failed to load</div>
        ) : url ? (
          <img
            src={url}
            alt={image.original_filename}
            className="fc-uiv-thumb-img"
            loading="lazy"
            decoding="async"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setHasError(true);
            }}
          />
        ) : null}

        <span className="fc-uiv-thumb-badge">#{index + 1}</span>

        {annotationCount > 0 ? (
          <span
            className="fc-uiv-thumb-ann-badge"
            title={`${annotationCount} reviewer correction${annotationCount === 1 ? '' : 's'}`}
          >
            💬 {annotationCount}
          </span>
        ) : null}

        {image.replacement_status === 'pending_approval' ? (
          <span className="fc-uiv-thumb-rep-badge fc-uiv-thumb-rep-pending" title="Replacement pending approval">
            Pending
          </span>
        ) : null}

        {(image.current_version_number || 1) > 1 ? (
          <span className="fc-uiv-thumb-ver-badge">v{image.current_version_number}</span>
        ) : null}
      </div>

      <div className="fc-uiv-thumb-info">
        <span className="fc-uiv-thumb-name" title={image.original_filename}>
          {image.original_filename}
        </span>
        {annotationCount > 0 ? (
          <span className="fc-uiv-thumb-ann-sub">
            {annotationCount} {annotationCount === 1 ? 'correction' : 'corrections'}
          </span>
        ) : image.file_size_bytes ? (
          <span className="fc-uiv-thumb-size">
            {formatFileSize(image.file_size_bytes)}
          </span>
        ) : null}
      </div>
    </button>
  );
}

/**
 * Dedicated Uploader Image Viewer.
 * Provides a clean, distraction-free, read-only viewing experience for uploaders.
 * Features a collapsible left-side vertical filmstrip and a maximized image canvas.
 */
export function UploaderImageViewerPage() {
  const { batchId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const [batch, setBatch] = useState(null);
  const [images, setImages] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const [selectedImageId, setSelectedImageId] = useState(
    searchParams.get('image') || null
  );
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [naturalDimensions, setNaturalDimensions] = useState(null);
  const [viewportDimensions, setViewportDimensions] = useState({ width: 0, height: 0 });
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Reference Images state
  const [references, setReferences] = useState([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referencesError, setReferencesError] = useState('');
  const [isReferencesOpen, setIsReferencesOpen] = useState(true);
  const [selectedReferenceForView, setSelectedReferenceForView] = useState(null);
  const [comparisonReference, setComparisonReference] = useState(null);

  // Replacement & Versioning Modals
  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isCancellingProposal, setIsCancellingProposal] = useState(false);

  // Main stage image state
  const [mainImageUrl, setMainImageUrl] = useState('');
  const [loadingMainImage, setLoadingMainImage] = useState(false);
  const [mainImageError, setMainImageError] = useState(false);

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [isFitMode, setIsFitMode] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const scrollRootRef = useRef(null);
  const viewportRef = useRef(null);

  // 1. Initial Data Fetching for Batch
  const loadBatchData = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const [batchRow, imageRows, annotationRows] = await Promise.all([
        getBatchById(batchId),
        listBatchImages(batchId),
        listBatchAnnotations(batchId).catch(() => []),
      ]);

      if (!batchRow) {
        setBatch(null);
        setImages([]);
        setAnnotations([]);
        return;
      }

      setBatch(batchRow);
      setImages(imageRows || []);
      setAnnotations(annotationRows || []);

      // Resolve initial selection without creating an unstable dependency on searchParams
      setSelectedImageId((prevId) => {
        if (prevId && (imageRows || []).some((img) => img.id === prevId)) {
          return prevId;
        }
        const initialParam = new URLSearchParams(window.location.search).get('image');
        const validParamImage = (imageRows || []).find((img) => img.id === initialParam);
        if (validParamImage) {
          return validParamImage.id;
        }
        return (imageRows && imageRows.length > 0) ? imageRows[0].id : null;
      });
    } catch (err) {
      setErrorMessage(err?.message || 'Unable to load batch images.');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    loadBatchData();
  }, [loadBatchData]);

  const urlImageId = searchParams.get('image');

  // Synchronize URL query parameters for direct links & browser Back/Forward navigation
  useEffect(() => {
    if (!urlImageId || loading || images.length === 0) return;
    if (urlImageId !== selectedImageId) {
      const matched = images.find((img) => img.id === urlImageId);
      if (matched) {
        setSelectedImageId(matched.id);
      }
    }
  }, [urlImageId, selectedImageId, images, loading]);

  // Ensure URL query param is populated on initial load if not already present
  useEffect(() => {
    if (loading || !selectedImageId) return;
    if (!searchParams.get('image')) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('image', selectedImageId);
          return next;
        },
        { replace: true }
      );
    }
  }, [loading, selectedImageId, searchParams, setSearchParams]);

  // Track viewport dimensions for responsive coordinate mapping
  useEffect(() => {
    const updateViewportSize = () => {
      if (viewportRef.current) {
        setViewportDimensions({
          width: viewportRef.current.clientWidth,
          height: viewportRef.current.clientHeight,
        });
      }
    };

    updateViewportSize();
    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, [isCollapsed, isReferencesOpen]);

  // Load reference images for the currently selected image
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
      setReferences(items || []);
    } catch (err) {
      console.error('[UploaderImageViewer] Error loading reference images:', err);
      setReferencesError(err?.message || 'Failed to load reference images.');
    } finally {
      setReferencesLoading(false);
    }
  }, []);

  // Fetch references and reset transient modal states on active image change
  useEffect(() => {
    setSelectedAnnotationId(null);
    setNaturalDimensions(null);
    setSelectedReferenceForView(null);
    setComparisonReference(null);

    if (selectedImageId) {
      loadReferences(selectedImageId);
    } else {
      setReferences([]);
    }
  }, [selectedImageId, loadReferences]);

  // Realtime subscription for image version updates
  useEffect(() => {
    if (!batchId) return undefined;
    const unsubscribe = subscribeToBatchVersionEvents(batchId, () => {
      loadBatchData();
    });
    return () => {
      unsubscribe();
    };
  }, [batchId, loadBatchData]);

  // Cancel pending replacement proposal
  const handleCancelProposal = async () => {
    if (isCancellingProposal) return;
    if (!selectedImage?.pending_version_id && !selectedImage?.pendingVersionId) return;
    const versionId = selectedImage.pending_version_id || selectedImage.pendingVersionId;
    setIsCancellingProposal(true);
    try {
      await cancelImageReplacement({ versionId });
      await loadBatchData();
    } catch (err) {
      alert(err?.message || 'Failed to cancel proposal');
    } finally {
      setIsCancellingProposal(false);
    }
  };

  // 2. Compute current image index and object
  const currentIndex = useMemo(() => {
    return images.findIndex((img) => img.id === selectedImageId);
  }, [images, selectedImageId]);

  const selectedImage = useMemo(() => {
    if (currentIndex >= 0 && currentIndex < images.length) {
      return images[currentIndex];
    }
    return images[0] || null;
  }, [images, currentIndex]);

  // Group annotations by imageId
  const annotationsByImageId = useMemo(() => {
    const map = new Map();
    for (const ann of annotations) {
      const imgId = ann.imageId || ann.image_id;
      if (!imgId) continue;
      if (!map.has(imgId)) {
        map.set(imgId, []);
      }
      map.get(imgId).push(ann);
    }
    return map;
  }, [annotations]);

  // Active version annotation count per image for filmstrip badges
  const annotationCountsByImageId = useMemo(() => {
    const counts = new Map();
    for (const img of images) {
      const targetVersion = img.current_version_number || 1;
      const imgAnnotations = annotationsByImageId.get(img.id) || [];
      const count = imgAnnotations.filter(
        (a) => (a.versionNumber || a.version_number || 1) === targetVersion
      ).length;
      counts.set(img.id, count);
    }
    return counts;
  }, [images, annotationsByImageId]);

  // Filtered annotations for currently selected image & active version
  const currentImageAnnotations = useMemo(() => {
    if (!selectedImage) return [];
    const targetVersion = selectedImage.current_version_number || 1;
    const allForImg = annotationsByImageId.get(selectedImage.id) || [];
    return allForImg.filter(
      (a) => (a.versionNumber || a.version_number || 1) === targetVersion
    );
  }, [selectedImage, annotationsByImageId]);

  // Selected annotation object and index in current image list
  const selectedAnnotationIndex = useMemo(() => {
    if (!selectedAnnotationId) return -1;
    return currentImageAnnotations.findIndex((a) => a.id === selectedAnnotationId);
  }, [currentImageAnnotations, selectedAnnotationId]);

  const selectedAnnotation = useMemo(() => {
    if (selectedAnnotationIndex >= 0) {
      return currentImageAnnotations[selectedAnnotationIndex];
    }
    return null;
  }, [currentImageAnnotations, selectedAnnotationIndex]);

  const handleCardPrev = useCallback(() => {
    if (selectedAnnotationIndex > 0) {
      setSelectedAnnotationId(currentImageAnnotations[selectedAnnotationIndex - 1].id);
    }
  }, [selectedAnnotationIndex, currentImageAnnotations]);

  const handleCardNext = useCallback(() => {
    if (
      selectedAnnotationIndex >= 0 &&
      selectedAnnotationIndex < currentImageAnnotations.length - 1
    ) {
      setSelectedAnnotationId(currentImageAnnotations[selectedAnnotationIndex + 1].id);
    }
  }, [selectedAnnotationIndex, currentImageAnnotations]);

  // Compute base dimensions for pixel-perfect image & overlay lock
  const { baseWidth, baseHeight, fitScale } = useMemo(() => {
    if (!naturalDimensions?.width || !naturalDimensions?.height) {
      return { baseWidth: 0, baseHeight: 0, fitScale: 1 };
    }

    const naturalW = naturalDimensions.width;
    const naturalH = naturalDimensions.height;
    const viewW = viewportDimensions.width || 800;
    const viewH = viewportDimensions.height || 600;

    const availW = Math.max(100, viewW - 32);
    const availH = Math.max(100, viewH - 32);

    const scale = Math.min(availW / naturalW, availH / naturalH, 1);
    const w = Math.round(naturalW * scale);
    const h = Math.round(naturalH * scale);

    return { baseWidth: w, baseHeight: h, fitScale: scale };
  }, [naturalDimensions, viewportDimensions]);

  // Keep selectedImageId synchronized if changed externally
  useEffect(() => {
    if (selectedImage && selectedImage.id !== selectedImageId) {
      setSelectedImageId(selectedImage.id);
    }
  }, [selectedImage, selectedImageId]);

  // 3. Selection handler
  const handleSelectImage = useCallback(
    (id) => {
      if (!id || id === selectedImageId) return;
      setSelectedImageId(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('image', id);
          return next;
        },
        { replace: true }
      );
    },
    [selectedImageId, setSearchParams]
  );

  // Prev / Next stepper
  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      handleSelectImage(images[currentIndex - 1].id);
    }
  }, [currentIndex, images, handleSelectImage]);

  const handleNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < images.length - 1) {
      handleSelectImage(images[currentIndex + 1].id);
    }
  }, [currentIndex, images, handleSelectImage]);

  // 4. Fetch full signed URL for the main preview stage
  useEffect(() => {
    if (!selectedImage?.storage_path) {
      setMainImageUrl('');
      setLoadingMainImage(false);
      return undefined;
    }

    let cancelled = false;
    setLoadingMainImage(true);
    setMainImageError(false);
    // Reset view transforms when switching images
    setZoom(1);
    setIsFitMode(true);
    setPan({ x: 0, y: 0 });

    getSignedImageUrl(selectedImage.storage_path)
      .then((url) => {
        if (!cancelled) {
          setMainImageUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMainImageError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingMainImage(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedImage?.id, selectedImage?.storage_path]);

  // 5. Zoom & Pan handlers
  const handleZoomIn = useCallback(() => {
    setIsFitMode(false);
    setZoom((prev) => Math.min(prev * 1.25, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setIsFitMode(false);
    setZoom((prev) => Math.max(prev / 1.25, 0.25));
  }, []);

  const handleFitToScreen = useCallback(() => {
    setIsFitMode(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleActualSize = useCallback(() => {
    setIsFitMode(false);
    setZoom(fitScale > 0 ? 1 / fitScale : 1);
    setPan({ x: 0, y: 0 });
  }, [fitScale]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setIsFitMode(false);
    setZoom((prev) => Math.min(Math.max(prev * factor, 0.25), 5));
  }, []);

  // Drag to pan
  const handleMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return; // primary click only
      if (isFitMode && zoom <= 1) return; // panning unnecessary when fitted
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    },
    [isFitMode, zoom, pan]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPan({
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      });
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 6. Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept if focused in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          handlePrev();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
          e.preventDefault();
          handleNext();
          break;
        case 'f':
        case 'F':
        case '0':
          e.preventDefault();
          handleFitToScreen();
          break;
        case '+':
        case '=':
          e.preventDefault();
          handleZoomIn();
          break;
        case '-':
        case '_':
          e.preventDefault();
          handleZoomOut();
          break;
        case 'b':
        case 'B':
          e.preventDefault();
          setIsCollapsed((prev) => !prev);
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          setIsReferencesOpen((prev) => !prev);
          break;
        case 'Escape':
          setSelectedAnnotationId(null);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrev, handleNext, handleFitToScreen, handleZoomIn, handleZoomOut]);

  // --------------------------------------------------------------------------
  // Render States: Loading & Error
  // --------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="fc-uiv-container" aria-busy="true">
        <header className="fc-uiv-header">
          <Link to={`/batches/${batchId}`} className="fc-uiv-back-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Batch Details</span>
          </Link>
        </header>
        <div className="fc-uiv-body">
          <div className="fc-uiv-stage">
            <div className="fc-uiv-stage-status">
              <div className="fc-uiv-stage-spinner" aria-hidden="true" />
              <span>Loading batch images…</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (errorMessage || !batch) {
    return (
      <div className="fc-uiv-container">
        <header className="fc-uiv-header">
          <Link to={`/batches/${batchId}`} className="fc-uiv-back-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Batch Details</span>
          </Link>
        </header>
        <div className="fc-uiv-body">
          <div className="fc-uiv-stage">
            <div className="fc-uiv-error-card">
              <span className="fc-uiv-error-title">Batch Unavailable</span>
              <p className="fc-uiv-error-text">
                {errorMessage || 'This batch does not exist or you do not have permission to view it.'}
              </p>
              <Link to="/dashboard" className="fc-uiv-back-btn">
                Return to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="fc-uiv-container">
        <header className="fc-uiv-header">
          <Link to={`/batches/${batchId}`} className="fc-uiv-back-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Batch Details</span>
          </Link>
          <div className="fc-uiv-batch-identity">
            <span className="fc-uiv-batch-title">{batch.name}</span>
          </div>
        </header>
        <div className="fc-uiv-body">
          <div className="fc-uiv-stage">
            <div className="fc-uiv-error-card">
              <span className="fc-uiv-error-title">No Images Found</span>
              <p className="fc-uiv-error-text">
                This batch has no uploaded images yet.
              </p>
              <Link to={`/batches/${batchId}`} className="fc-uiv-back-btn">
                Back to Batch Details to Add Images
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const zoomPercentDisplay = isFitMode
    ? 'Fit'
    : `${Math.round(zoom * (fitScale > 0 ? fitScale : 1) * 100)}%`;

  return (
    <div className="fc-uiv-container">
      {/* --------------------------------------------------------------------
          Top Header Bar
          -------------------------------------------------------------------- */}
      <header className="fc-uiv-header" role="banner">
        <div className="fc-uiv-header-left">
          <Link
            to={`/batches/${batch.id}`}
            className="fc-uiv-back-btn"
            title="Return to Batch Details"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Batch</span>
          </Link>

          <span className="fc-uiv-sep" aria-hidden="true">•</span>

          <div className="fc-uiv-batch-identity">
            <h1 className="fc-uiv-batch-title" title={batch.name}>
              {batch.name}
            </h1>
            <span className="fc-uiv-badge-count" title={`${images.length} total images`}>
              {images.length} {images.length === 1 ? 'image' : 'images'}
            </span>
          </div>
        </div>

        {/* Center: Image stepper and filename */}
        <div className="fc-uiv-header-center">
          <div className="fc-uiv-stepper" role="group" aria-label="Image navigation">
            <button
              type="button"
              className="fc-uiv-nav-btn"
              onClick={handlePrev}
              disabled={currentIndex <= 0}
              title="Previous Image (← or PageUp)"
              aria-label="Previous image"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <span className="fc-uiv-stepper-label">
              Image {currentIndex + 1} of {images.length}
            </span>

            <button
              type="button"
              className="fc-uiv-nav-btn"
              onClick={handleNext}
              disabled={currentIndex >= images.length - 1}
              title="Next Image (→ or PageDown)"
              aria-label="Next image"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {selectedImage ? (
            <span
              className="fc-uiv-filename-pill"
              title={selectedImage.original_filename}
            >
              {selectedImage.original_filename}
            </span>
          ) : null}

          {currentImageAnnotations.length > 0 ? (
            <span
              className="fc-uiv-stage-annotations-pill"
              title={`${currentImageAnnotations.length} reviewer annotation${
                currentImageAnnotations.length === 1 ? '' : 's'
              } on this image`}
            >
              💬 {currentImageAnnotations.length}{' '}
              {currentImageAnnotations.length === 1 ? 'Correction' : 'Corrections'}
            </span>
          ) : null}
        </div>

        {/* Right: Zoom controls, replacement action, and layout toggles */}
        <div className="fc-uiv-header-right">
          {selectedImage ? (
            <div className="fc-uiv-action-group" role="group" aria-label="Version actions">
              <button
                type="button"
                className="fc-uiv-action-btn fc-uiv-btn-replace"
                onClick={() => setIsReplaceModalOpen(true)}
                title="Upload a corrected replacement version of this image"
                disabled={selectedImage.replacement_status === 'pending_approval'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>{selectedImage.replacement_status === 'pending_approval' ? 'Pending Approval' : 'Replace Image'}</span>
              </button>

              <button
                type="button"
                className="fc-uiv-action-btn fc-uiv-btn-versions"
                onClick={() => setIsHistoryModalOpen(true)}
                title="View full version history and reviewer decisions"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>History (v{selectedImage.current_version_number || 1})</span>
              </button>
            </div>
          ) : null}

          {/* References Toggle Button */}
          <button
            type="button"
            className={`fc-uiv-action-btn fc-uiv-btn-references${
              isReferencesOpen ? ' fc-uiv-btn-references-active' : ''
            }`}
            onClick={() => setIsReferencesOpen((prev) => !prev)}
            title={isReferencesOpen ? 'Hide Reference Images (R)' : 'Show Reference Images (R)'}
            aria-label={isReferencesOpen ? 'Hide Reference Images' : 'Show Reference Images'}
            aria-pressed={isReferencesOpen}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>References</span>
            {references.length > 0 ? (
              <span className="fc-uiv-badge-count fc-uiv-badge-count-ref">
                {references.length}
              </span>
            ) : null}
          </button>

          <div className="fc-uiv-zoom-group" role="group" aria-label="Zoom controls">
            <button
              type="button"
              className="fc-uiv-zoom-btn"
              onClick={handleZoomOut}
              disabled={zoom <= 0.25}
              title="Zoom out (-)"
              aria-label="Zoom out"
            >
              −
            </button>

            <button
              type="button"
              className="fc-uiv-zoom-btn fc-uiv-zoom-pct"
              onClick={isFitMode ? handleActualSize : handleFitToScreen}
              title={isFitMode ? 'Click for 100% Actual Size' : 'Click to Fit Screen (0 or F)'}
              aria-label={`Current view scale: ${zoomPercentDisplay}`}
            >
              {zoomPercentDisplay}
            </button>

            <button
              type="button"
              className="fc-uiv-zoom-btn"
              onClick={handleZoomIn}
              disabled={zoom >= 5}
              title="Zoom in (+)"
              aria-label="Zoom in"
            >
              +
            </button>

            <button
              type="button"
              className="fc-uiv-zoom-btn"
              onClick={handleFitToScreen}
              title="Fit to Screen (F or 0)"
            >
              Fit
            </button>
          </div>

          <button
            type="button"
            className={`fc-uiv-icon-btn${!isCollapsed ? ' fc-uiv-icon-btn-active' : ''}`}
            onClick={() => setIsCollapsed((prev) => !prev)}
            title={isCollapsed ? 'Expand Filmstrip (B)' : 'Collapse Filmstrip (B)'}
            aria-label={isCollapsed ? 'Expand Filmstrip' : 'Collapse Filmstrip'}
            aria-pressed={!isCollapsed}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>

          <button
            type="button"
            className="fc-uiv-icon-btn"
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* --------------------------------------------------------------------
          Body: Filmstrip (Left) & Image Viewer Stage (Main)
          -------------------------------------------------------------------- */}
      <div className="fc-uiv-body">
        {/* Left Panel: Image Filmstrip */}
        <aside
          className={`fc-uiv-filmstrip${isCollapsed ? ' fc-uiv-filmstrip-collapsed' : ''}`}
          aria-label="Batch thumbnails"
        >
          {isCollapsed ? (
            <div
              className="fc-uiv-collapsed-rail"
              onClick={() => setIsCollapsed(false)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsCollapsed(false);
                }
              }}
              title="Expand image filmstrip (B)"
            >
              <button
                type="button"
                className="fc-uiv-toggle-rail-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCollapsed(false);
                }}
                title="Expand filmstrip"
                aria-label="Expand filmstrip"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              <div className="fc-uiv-collapsed-indicator">
                <span>{images.length} Images</span>
              </div>
            </div>
          ) : (
            <>
              <div className="fc-uiv-filmstrip-header">
                <div className="fc-uiv-filmstrip-title-row">
                  <span className="fc-uiv-filmstrip-title">Thumbnails</span>
                  <span className="fc-uiv-badge-count">{images.length}</span>
                </div>

                <button
                  type="button"
                  className="fc-uiv-toggle-rail-btn"
                  onClick={() => setIsCollapsed(true)}
                  title="Collapse filmstrip (B)"
                  aria-label="Collapse filmstrip"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              </div>

              <div
                ref={scrollRootRef}
                className="fc-uiv-filmstrip-list"
                role="list"
              >
                {images.map((image, index) => (
                  <UploaderFilmstripItem
                    key={image.id}
                    image={image}
                    index={index}
                    isSelected={image.id === selectedImageId}
                    onSelect={handleSelectImage}
                    scrollRootRef={scrollRootRef}
                    annotationCount={annotationCountsByImageId.get(image.id) || 0}
                  />
                ))}
              </div>
            </>
          )}
        </aside>

        {/* Main Area: Image Viewer Stage */}
        <main
          className="fc-uiv-stage"
          aria-label="Current image viewing area"
        >
          {/* Status Banner above Stage */}
          {selectedImage?.replacement_status === 'pending_approval' ? (
            <div className="fc-uiv-status-banner fc-uiv-banner-pending">
              <span>⏳ Replacement version proposal is pending reviewer approval. Original remains active.</span>
              <button
                type="button"
                className="fc-uiv-banner-btn"
                onClick={handleCancelProposal}
                disabled={isCancellingProposal}
              >
                {isCancellingProposal ? 'Cancelling…' : 'Cancel Proposal'}
              </button>
              <button
                type="button"
                className="fc-uiv-banner-btn"
                onClick={() => setIsHistoryModalOpen(true)}
              >
                View Details
              </button>
            </div>
          ) : selectedImage?.replacement_status === 'rejected' ? (
            <div className="fc-uiv-status-banner fc-uiv-banner-rejected">
              <span>⚠️ A previous replacement proposal for this image was rejected by a reviewer.</span>
              <button
                type="button"
                className="fc-uiv-banner-btn"
                onClick={() => setIsReplaceModalOpen(true)}
              >
                Submit New Replacement
              </button>
              <button
                type="button"
                className="fc-uiv-banner-btn"
                onClick={() => setIsHistoryModalOpen(true)}
              >
                View Rejection Reason
              </button>
            </div>
          ) : (selectedImage?.current_version_number || 1) > 1 ? (
            <div className="fc-uiv-status-banner fc-uiv-banner-approved">
              <span>✓ Currently viewing Version {selectedImage.current_version_number} (Approved)</span>
              <button
                type="button"
                className="fc-uiv-banner-btn"
                onClick={() => setIsHistoryModalOpen(true)}
              >
                Version History
              </button>
            </div>
          ) : null}

          <div
            ref={viewportRef}
            className={`fc-uiv-stage-viewport${
              !isFitMode || zoom > 1 ? ' fc-uiv-can-pan' : ''
            }${isDragging ? ' fc-uiv-is-panning' : ''}`}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={() => {
              if (selectedAnnotationId) {
                setSelectedAnnotationId(null);
              }
            }}
          >
            {loadingMainImage ? (
              <div className="fc-uiv-stage-status">
                <div className="fc-uiv-stage-spinner" aria-hidden="true" />
                <span>Loading image…</span>
              </div>
            ) : mainImageError ? (
              <div className="fc-uiv-error-card">
                <span className="fc-uiv-error-title">Image Unavailable</span>
                <p className="fc-uiv-error-text">
                  Unable to load high-resolution image preview.
                </p>
                <button
                  type="button"
                  className="fc-uiv-back-btn"
                  onClick={() => {
                    if (selectedImage?.storage_path) {
                      setLoadingMainImage(true);
                      setMainImageError(false);
                      getSignedImageUrl(selectedImage.storage_path)
                        .then((url) => setMainImageUrl(url))
                        .catch(() => setMainImageError(true))
                        .finally(() => setLoadingMainImage(false));
                    }
                  }}
                >
                  Retry Loading
                </button>
              </div>
            ) : mainImageUrl ? (
              <div
                className="fc-uiv-main-image-wrap"
                style={{
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                  width: baseWidth ? `${baseWidth}px` : (isFitMode ? '100%' : 'auto'),
                  height: baseHeight ? `${baseHeight}px` : (isFitMode ? '100%' : 'auto'),
                  position: 'relative',
                }}
              >
                <img
                  src={mainImageUrl}
                  alt={selectedImage?.original_filename || 'Batch image'}
                  className="fc-uiv-main-img"
                  draggable={false}
                  style={{
                    width: baseWidth ? `${baseWidth}px` : 'auto',
                    height: baseHeight ? `${baseHeight}px` : 'auto',
                    maxWidth: 'none',
                    maxHeight: 'none',
                    display: 'block',
                  }}
                  onLoad={(e) => {
                    setLoadingMainImage(false);
                    const nw = e.currentTarget.naturalWidth;
                    const nh = e.currentTarget.naturalHeight;
                    if (nw && nh) {
                      setNaturalDimensions({ width: nw, height: nh });
                    }
                  }}
                />

                {baseWidth > 0 && baseHeight > 0 && currentImageAnnotations.length > 0 ? (
                  <UploaderAnnotationOverlay
                    annotations={currentImageAnnotations}
                    baseWidth={baseWidth}
                    baseHeight={baseHeight}
                    selectedAnnotationId={selectedAnnotationId}
                    onSelectAnnotation={(annId) => {
                      setSelectedAnnotationId(annId);
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Dedicated Correction Comment Card for Selected Annotation */}
          {selectedAnnotation ? (
            <UploaderCommentCard
              annotation={selectedAnnotation}
              totalCount={currentImageAnnotations.length}
              currentIndex={selectedAnnotationIndex}
              onPrev={selectedAnnotationIndex > 0 ? handleCardPrev : null}
              onNext={
                selectedAnnotationIndex < currentImageAnnotations.length - 1
                  ? handleCardNext
                  : null
              }
              onClose={() => setSelectedAnnotationId(null)}
              references={references.filter(
                (r) => r.annotationId === selectedAnnotation.id
              )}
              onSelectReference={(ref) => setSelectedReferenceForView(ref)}
            />
          ) : null}
        </main>

        {/* Right Panel: Reference Images Sidebar */}
        {isReferencesOpen ? (
          <aside
            className="fc-uiv-references-sidebar"
            aria-label="Reference images for selected image"
          >
            <div className="fc-uiv-ref-sidebar-header">
              <div className="fc-uiv-filmstrip-title-row">
                <span className="fc-uiv-filmstrip-title">Reference Images</span>
                <span className="fc-uiv-badge-count">{references.length}</span>
              </div>

              <button
                type="button"
                className="fc-uiv-toggle-rail-btn"
                onClick={() => setIsReferencesOpen(false)}
                title="Hide reference images panel (R)"
                aria-label="Hide reference images panel"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="fc-uiv-ref-sidebar-content">
              <ReferenceImagesPanel
                references={references}
                isLoading={referencesLoading}
                error={referencesError}
                onRetry={() => loadReferences(selectedImageId)}
                onSelectReferenceForView={(ref) => setSelectedReferenceForView(ref)}
                onOpenComparison={(ref) => setComparisonReference(ref)}
                readOnly
                canReview={false}
                currentUserId={user?.id}
                userRole="user"
                selectedImage={selectedImage}
                annotations={currentImageAnnotations}
                selectedAnnotationId={selectedAnnotationId}
                onNavigateAnnotation={(annId) => setSelectedAnnotationId(annId)}
              />
            </div>
          </aside>
        ) : null}
      </div>

      {/* Modals */}
      {selectedReferenceForView ? (
        <ReferenceViewerModal
          reference={selectedReferenceForView}
          parentAnnotation={
            selectedReferenceForView.annotationId
              ? annotations.find((a) => a.id === selectedReferenceForView.annotationId)
              : null
          }
          isOpen={Boolean(selectedReferenceForView)}
          onClose={() => setSelectedReferenceForView(null)}
          canManage={false}
          onCompare={
            selectedImage
              ? (ref) => {
                  setSelectedReferenceForView(null);
                  setComparisonReference(ref);
                }
              : null
          }
        />
      ) : null}

      {comparisonReference && selectedImage ? (
        <ReferenceComparisonModal
          isOpen={Boolean(comparisonReference)}
          originalImage={selectedImage}
          currentReference={comparisonReference}
          allReferences={references}
          allAnnotations={currentImageAnnotations}
          onSelectReference={(ref) => setComparisonReference(ref)}
          onClose={() => setComparisonReference(null)}
        />
      ) : null}

      {isReplaceModalOpen && selectedImage && batch ? (
        <ReplaceImageModal
          isOpen={isReplaceModalOpen}
          onClose={() => setIsReplaceModalOpen(false)}
          image={selectedImage}
          batch={batch}
          onReplacementSubmitted={() => {
            loadBatchData();
          }}
        />
      ) : null}

      {isHistoryModalOpen && selectedImage ? (
        <VersionHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          image={selectedImage}
        />
      ) : null}
    </div>
  );
}
