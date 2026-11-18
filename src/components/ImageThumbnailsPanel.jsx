import { useEffect, useMemo, useRef, useState } from 'react';
import { getSignedImageUrl } from '../services/imageUploadService.js';
import './ImageThumbnailsPanel.css';

function VerticalThumbnailItem({
  image,
  index,
  displayNumber,
  isSelected,
  onSelect,
  scrollRootRef,
  isRecent = false,
}) {
  const itemRef = useRef(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

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
        root: scrollRootRef.current ?? null,
        rootMargin: '200px',
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRootRef, shouldLoad]);

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
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [image.storage_path, shouldLoad, url]);

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
      className={`fc-vthumb-item${isSelected ? ' fc-vthumb-item-selected' : ''}`}
      onClick={() => onSelect(image.id)}
      title={image.relative_path || image.original_filename}
      aria-current={isSelected ? 'true' : undefined}
      role="listitem"
    >
      <div className="fc-vthumb-frame">
        {!shouldLoad || (loading && !hasError) ? (
          <div className="fc-vthumb-placeholder" aria-hidden="true">
            <span className="fc-vthumb-skeleton" />
          </div>
        ) : null}

        {hasError ? (
          <div className="fc-vthumb-error">!</div>
        ) : url ? (
          <img
            src={url}
            alt={image.original_filename}
            className={`fc-vthumb-img${loading ? ' fc-vthumb-img-hidden' : ''}`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setHasError(true);
            }}
          />
        ) : null}

        <span className="fc-vthumb-index">#{displayNumber || index + 1}</span>
        {(image.current_version_number || 1) > 1 && (
          <span
            className="fc-vthumb-version-pill"
            title={`Version ${image.current_version_number}`}
            aria-label={`Version ${image.current_version_number}`}
          >
            v{image.current_version_number}
          </span>
        )}
        {image.replacement_status === 'pending_approval' && (
          <span
            className="fc-vthumb-rep-pending-badge"
            title="Replacement Pending Review"
            aria-label="Replacement Pending Review"
          >
            ⚡
          </span>
        )}
        {image.is_completed ? (
          <span
            className="fc-vthumb-completed-badge"
            title="Image marked as completed"
            aria-label="Completed"
          >
            ✓
          </span>
        ) : null}
      </div>

      <div className="fc-vthumb-info">
        <span className="fc-vthumb-filename" title={image.original_filename}>
          {image.original_filename}
        </span>
        <span className="fc-vthumb-meta">
          {image.replacement_status === 'pending_approval' ? (
            <span className="fc-vthumb-status-pending" title="Replacement version awaiting review">
              Pending Replacement
            </span>
          ) : image.is_completed ? (
            <span className="fc-vthumb-status-done">Completed</span>
          ) : (
            `Image ${displayNumber || index + 1}`
          )}
          {isRecent ? <span className="fc-vthumb-recent-pill">Recent</span> : null}
        </span>
      </div>
    </button>
  );
}

/**
 * Vertical Left Image Panel for the review workspace.
 * Replaces the horizontal top filmstrip with an independently scrollable,
 * collapsible panel displaying image thumbnails, indices, and filenames.
 */
export function ImageThumbnailsPanel({
  images = [],
  selectedImageId,
  onSelectImage,
  isCollapsed = false,
  onToggleCollapse,
  width = 250,
  onReposition = null,
  dockSide = 'left',
  onHide = null,
  canHide = true,
  recentImageIds = [],
  batchName = '',
}) {
  const scrollRef = useRef(null);
  const [activeTab, setActiveTab] = useState('all');

  // Filter accessible, valid batch images for recent navigation
  const validRecentImages = useMemo(() => {
    if (!recentImageIds || !recentImageIds.length) return [];
    const imageMap = new Map(images.map((img) => [img.id, img]));
    return recentImageIds
      .map((id) => imageMap.get(id))
      .filter(Boolean);
  }, [images, recentImageIds]);

  const displayedImages = activeTab === 'recent' ? validRecentImages : images;

  if (images.length === 0) {
    return null;
  }

  if (isCollapsed) {
    return (
      <aside
        className={`fc-thumbnails-panel fc-thumbnails-panel-collapsed${
          dockSide === 'right' ? ' fc-thumbnails-panel-right' : ''
        }`}
        aria-label="Batch images (collapsed)"
      >
        <button
          type="button"
          className="fc-panel-expand-btn"
          onClick={onToggleCollapse}
          title="Expand image panel"
          aria-label="Expand image panel"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {dockSide === 'right' ? (
              <polyline points="15 18 9 12 15 6" />
            ) : (
              <polyline points="9 18 15 12 9 6" />
            )}
          </svg>
        </button>

        <div
          className="fc-collapsed-rail-body"
          onClick={onToggleCollapse}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleCollapse();
            }
          }}
          title="Click to expand image panel"
        >
          <span className="fc-collapsed-icon" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </span>
          <span className="fc-collapsed-badge-neutral">{images.length}</span>
          <span className="fc-collapsed-vertical-text" title={batchName || 'Images'}>
            {batchName || 'Images'}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`fc-thumbnails-panel${
        dockSide === 'right' ? ' fc-thumbnails-panel-right' : ''
      }`}
      style={width ? { width: `${width}px` } : undefined}
      aria-label={batchName ? `${batchName} images` : 'Batch images'}
    >
      <div className="fc-thumbnails-panel-header">
        <div className="fc-thumbnails-title-group">
          <h2 className="fc-thumbnails-panel-title" title={batchName || 'Images'}>
            {batchName || 'Images'}
          </h2>
          <span className="fc-panel-count" title={`${images.length} images`}>
            {images.length}
          </span>
        </div>

        <div className="fc-panel-header-actions">
          {onReposition ? (
            <button
              type="button"
              className="fc-panel-reposition-btn"
              onClick={onReposition}
              title={dockSide === 'left' ? 'Move thumbnails to right side' : 'Move thumbnails to left side'}
              aria-label={dockSide === 'left' ? 'Move thumbnails to right side' : 'Move thumbnails to left side'}
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
                <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          ) : null}

          <button
            type="button"
            className="fc-panel-toggle-btn"
            onClick={onToggleCollapse}
            title="Collapse image panel"
            aria-label="Collapse image panel"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {dockSide === 'right' ? (
                <polyline points="9 18 15 12 9 6" />
              ) : (
                <polyline points="15 18 9 12 15 6" />
              )}
            </svg>
          </button>

          {onHide ? (
            <button
              type="button"
              className="fc-panel-hide-btn"
              onClick={onHide}
              disabled={!canHide}
              title={
                canHide
                  ? 'Hide image thumbnails (restore via Layout menu or Alt+1)'
                  : 'At least one panel must stay visible'
              }
              aria-label="Hide image thumbnails"
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* Navigation Filter Tabs: All vs Recent (Segmented Control) */}
      <div className="fc-thumbnails-tabs-wrapper">
        <div className="fc-thumbnails-tabs" role="tablist" aria-label="Images view modes">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            className={`fc-thumbnails-tab${activeTab === 'all' ? ' fc-thumbnails-tab-active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All ({images.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'recent'}
            className={`fc-thumbnails-tab${activeTab === 'recent' ? ' fc-thumbnails-tab-active' : ''}`}
            onClick={() => setActiveTab('recent')}
            title="View recently inspected images in this batch"
          >
            Recent ({validRecentImages.length})
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="fc-thumbnails-scroll"
        role="list"
        aria-label="Thumbnails list"
      >
        {displayedImages.length === 0 ? (
          <div className="fc-thumbnails-empty-msg">
            <span className="fc-thumbnails-empty-icon">🕒</span>
            <span className="fc-thumbnails-empty-title">No recent images</span>
            <span className="fc-thumbnails-empty-sub">
              Images you inspect in this batch will appear here for fast access.
            </span>
          </div>
        ) : (
          displayedImages.map((image, index) => {
            const originalIdx = images.findIndex((img) => img.id === image.id);
            const displayNumber = originalIdx >= 0 ? originalIdx + 1 : index + 1;
            return (
              <VerticalThumbnailItem
                key={image.id}
                image={image}
                index={index}
                displayNumber={displayNumber}
                isSelected={image.id === selectedImageId}
                onSelect={onSelectImage}
                scrollRootRef={scrollRef}
                isRecent={activeTab === 'recent'}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}

