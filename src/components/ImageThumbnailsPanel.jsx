import { useEffect, useRef, useState } from 'react';
import { getSignedImageUrl } from '../services/imageUploadService.js';
import './ImageThumbnailsPanel.css';

function VerticalThumbnailItem({
  image,
  index,
  isSelected,
  onSelect,
  scrollRootRef,
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

        <span className="fc-vthumb-index">#{index + 1}</span>
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
          {image.is_completed ? (
            <span className="fc-vthumb-status-done">Completed</span>
          ) : (
            `Image ${index + 1}`
          )}
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
}) {
  const scrollRef = useRef(null);

  if (images.length === 0) {
    return null;
  }

  if (isCollapsed) {
    return (
      <aside
        className="fc-thumbnails-panel fc-thumbnails-panel-collapsed"
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
            <polyline points="9 18 15 12 9 6" />
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
          <span className="fc-collapsed-vertical-text">Images</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="fc-thumbnails-panel" aria-label="Batch images">
      <div className="fc-thumbnails-panel-header">
        <div className="fc-thumbnails-title-group">
          <h2 className="fc-thumbnails-panel-title">Images</h2>
          <span className="fc-panel-count">{images.length}</span>
        </div>

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
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <div
        ref={scrollRef}
        className="fc-thumbnails-scroll"
        role="list"
        aria-label="Thumbnails list"
      >
        {images.map((image, index) => (
          <VerticalThumbnailItem
            key={image.id}
            image={image}
            index={index}
            isSelected={image.id === selectedImageId}
            onSelect={onSelectImage}
            scrollRootRef={scrollRef}
          />
        ))}
      </div>
    </aside>
  );
}

