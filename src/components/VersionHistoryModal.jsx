import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatFileSize, getSignedImageUrl } from '../services/imageUploadService.js';
import { listImageVersions } from '../services/imageVersioningService.js';
import './VersionHistoryModal.css';

function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function VersionItemCard({
  version,
  isSelected,
  onSelect,
  isCurrentActive,
}) {
  const [thumbUrl, setThumbUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    const path = version.storagePath || version.storage_path;
    if (path) {
      getSignedImageUrl(path)
        .then((url) => {
          if (!cancelled) setThumbUrl(url);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [version.storagePath, version.storage_path]);

  const getStatusBadge = () => {
    if (isCurrentActive) {
      return <span className="fc-vhm-badge fc-vhm-badge-active">Current Active</span>;
    }
    switch (version.status) {
      case 'pending_approval':
        return <span className="fc-vhm-badge fc-vhm-badge-pending">Pending Approval</span>;
      case 'approved':
        return <span className="fc-vhm-badge fc-vhm-badge-approved">Approved</span>;
      case 'rejected':
        return <span className="fc-vhm-badge fc-vhm-badge-rejected">Rejected</span>;
      case 'archived':
      default:
        return <span className="fc-vhm-badge fc-vhm-badge-archived">Archived</span>;
    }
  };

  return (
    <div
      className={`fc-vhm-item${isSelected ? ' fc-vhm-item-selected' : ''}`}
      onClick={() => onSelect(version)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(version);
        }
      }}
    >
      <div className="fc-vhm-item-thumb">
        {thumbUrl ? (
          <img src={thumbUrl} alt={`Version ${version.versionNumber}`} className="fc-vhm-thumb-img" />
        ) : (
          <div className="fc-vhm-thumb-placeholder">v{version.versionNumber}</div>
        )}
      </div>

      <div className="fc-vhm-item-info">
        <div className="fc-vhm-item-title-row">
          <span className="fc-vhm-item-version">Version {version.versionNumber}</span>
          {getStatusBadge()}
        </div>

        <div className="fc-vhm-item-meta-row">
          <span>Uploaded by {version.uploaderName}</span>
          <span className="fc-vhm-dot" aria-hidden="true">•</span>
          <span>{formatDateTime(version.uploadedAt)}</span>
          {version.fileSize ? (
            <>
              <span className="fc-vhm-dot" aria-hidden="true">•</span>
              <span>{formatFileSize(version.fileSize)}</span>
            </>
          ) : null}
        </div>

        {version.correctionMessage ? (
          <div className="fc-vhm-item-correction">
            <span className="fc-vhm-correction-label">Correction note:</span>
            <p className="fc-vhm-correction-text">"{version.correctionMessage}"</p>
          </div>
        ) : null}

        {version.status === 'rejected' && version.rejectionReason ? (
          <div className="fc-vhm-item-rejection">
            <span className="fc-vhm-rejection-label">Rejection reason:</span>
            <p className="fc-vhm-rejection-text">"{version.rejectionReason}"</p>
            <span className="fc-vhm-rejection-by">
              Decided by {version.reviewerName} on {formatDateTime(version.reviewedAt)}
            </span>
          </div>
        ) : null}

        {version.status === 'approved' && version.reviewedBy ? (
          <div className="fc-vhm-item-approval">
            <span>Approved by {version.reviewerName} on {formatDateTime(version.reviewedAt)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Version History modal dialog displaying full audit trail of image versions,
 * correction messages, reviewer approvals, and rejection feedback.
 */
export function VersionHistoryModal({
  isOpen,
  onClose,
  image,
}) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  const loadVersions = useCallback(async () => {
    if (!image?.id) return;
    setLoading(true);
    try {
      const data = await listImageVersions(image.id);
      setVersions(data);
      if (data.length > 0) {
        setSelectedVersion(data[0]);
      }
    } catch (err) {
      console.warn('Failed to fetch image versions:', err);
    } finally {
      setLoading(false);
    }
  }, [image?.id]);

  useEffect(() => {
    if (isOpen) {
      loadVersions();
    }
  }, [isOpen, loadVersions]);

  useEffect(() => {
    let cancelled = false;
    const path = selectedVersion?.storagePath || selectedVersion?.storage_path;
    if (path) {
      setLoadingPreview(true);
      getSignedImageUrl(path)
        .then((url) => {
          if (!cancelled) setPreviewUrl(url);
        })
        .catch(() => {
          if (!cancelled) setPreviewUrl('');
        })
        .finally(() => {
          if (!cancelled) setLoadingPreview(false);
        });
    } else {
      setPreviewUrl('');
    }
    return () => {
      cancelled = true;
    };
  }, [selectedVersion?.storagePath, selectedVersion?.storage_path]);

  if (!isOpen || !image) return null;

  const currentVersionNum = image.current_version_number || 1;

  return createPortal(
    <div className="fc-vhm-overlay" role="dialog" aria-modal="true" aria-labelledby="fc-vhm-title">
      <div className="fc-vhm-card">
        {/* Header */}
        <header className="fc-vhm-header">
          <div className="fc-vhm-header-text">
            <h2 id="fc-vhm-title" className="fc-vhm-title">
              Version History — Image #{image.display_order || 1}
            </h2>
            <span className="fc-vhm-subtitle">{image.original_filename}</span>
          </div>
          <button
            type="button"
            className="fc-vhm-close-btn"
            onClick={onClose}
            aria-label="Close version history"
          >
            ×
          </button>
        </header>

        {/* Content Body: Left Version List, Right Preview */}
        <div className="fc-vhm-body">
          {/* Versions List */}
          <div className="fc-vhm-list-pane">
            <div className="fc-vhm-list-header">
              <span>All Versions ({versions.length})</span>
            </div>

            {loading ? (
              <div className="fc-vhm-status-pane">
                <div className="fc-vhm-spinner" />
                <span>Loading version history…</span>
              </div>
            ) : versions.length === 0 ? (
              <div className="fc-vhm-empty-pane">
                <span>No historical versions recorded for this image.</span>
              </div>
            ) : (
              <div className="fc-vhm-list" role="list">
                {versions.map((ver) => (
                  <VersionItemCard
                    key={ver.id}
                    version={ver}
                    isSelected={selectedVersion?.id === ver.id}
                    onSelect={setSelectedVersion}
                    isCurrentActive={ver.versionNumber === currentVersionNum}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Version Preview Stage */}
          <div className="fc-vhm-preview-pane">
            {selectedVersion ? (
              <div className="fc-vhm-preview-stage">
                <div className="fc-vhm-preview-banner">
                  <span className="fc-vhm-preview-tag">
                    Viewing Version {selectedVersion.versionNumber}
                    {selectedVersion.versionNumber === currentVersionNum ? ' (Active)' : ' (Read-Only Preview)'}
                  </span>
                  <span className="fc-vhm-preview-file">{selectedVersion.originalFilename}</span>
                </div>

                <div className="fc-vhm-preview-media">
                  {loadingPreview ? (
                    <div className="fc-vhm-spinner" />
                  ) : previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={`Version ${selectedVersion.versionNumber} preview`}
                      className="fc-vhm-preview-img"
                    />
                  ) : (
                    <span className="fc-vhm-empty-text">Preview unavailable</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="fc-vhm-status-pane">
                <span>Select a version to preview</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="fc-vhm-footer">
          <button type="button" className="fc-vhm-btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
