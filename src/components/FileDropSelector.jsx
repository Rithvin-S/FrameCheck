import { useEffect, useRef } from 'react';
import {
  FILE_ACCEPT_ATTRIBUTE,
  formatFileSize,
  getFormatLabel,
} from '../services/imageUploadService.js';
import './FileDropSelector.css';

const STATUS_LABELS = {
  ready: 'Ready',
  invalid: 'Skipped',
  uploading: 'Uploading…',
  uploaded: 'Uploaded',
  failed: 'Failed',
};

/**
 * Reusable multi-image and folder file selector with validation summary,
 * duplicate filename indicators, per-file upload statuses, and honest file-count progress.
 */
export function FileDropSelector({
  items,
  onFilesSelected,
  onRemoveItem,
  onClearPending,
  disabled = false,
  isUploading = false,
}) {
  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.webkitdirectory = true;
      folderInputRef.current.directory = true;
    }
  }, []);

  const handleFileInputChange = (event) => {
    const selected = event.target.files;
    if (selected && selected.length > 0) {
      onFilesSelected(selected);
    }
    event.target.value = '';
  };

  const counts = items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    { ready: 0, invalid: 0, uploading: 0, uploaded: 0, failed: 0 }
  );

  const uploadableTotal =
    counts.ready + counts.uploading + counts.uploaded + counts.failed;
  const processedCount = counts.uploaded + counts.failed;
  const showProgress =
    isUploading || counts.uploaded > 0 || counts.failed > 0;
  const progressPercent =
    uploadableTotal > 0 ? Math.round((processedCount / uploadableTotal) * 100) : 0;

  return (
    <div className="fc-upload-selector">
      <div className="fc-picker-box">
        <div className="fc-picker-copy">
          <h2 className="fc-picker-title">Select images or a folder</h2>
          <p className="fc-picker-subtitle">
            Supported formats: JPG, JPEG, PNG, WEBP (up to 50 MB per file). Original
            files and filenames are preserved.
          </p>
        </div>

        <div className="fc-picker-actions">
          <input
            ref={filesInputRef}
            type="file"
            multiple
            accept={FILE_ACCEPT_ATTRIBUTE}
            onChange={handleFileInputChange}
            className="fc-sr-input"
            disabled={disabled}
            tabIndex={-1}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            onChange={handleFileInputChange}
            className="fc-sr-input"
            disabled={disabled}
            tabIndex={-1}
          />

          <button
            type="button"
            className="fc-btn fc-btn-secondary"
            onClick={() => filesInputRef.current?.click()}
            disabled={disabled}
          >
            Select Images
          </button>
          <button
            type="button"
            className="fc-btn fc-btn-secondary"
            onClick={() => folderInputRef.current?.click()}
            disabled={disabled}
          >
            Select Folder
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="fc-staging-section">
          <div className="fc-staging-toolbar">
            <div className="fc-staging-counts">
              <span className="fc-count-pill">Total selected: {items.length}</span>
              <span className="fc-count-pill fc-count-ready">
                Ready: {counts.ready}
              </span>
              {counts.invalid > 0 ? (
                <span className="fc-count-pill fc-count-invalid">
                  Invalid: {counts.invalid}
                </span>
              ) : null}
              {counts.uploaded > 0 ? (
                <span className="fc-count-pill fc-count-uploaded">
                  Uploaded: {counts.uploaded}
                </span>
              ) : null}
              {counts.failed > 0 ? (
                <span className="fc-count-pill fc-count-failed">
                  Failed: {counts.failed}
                </span>
              ) : null}
            </div>

            {onClearPending && !isUploading && counts.ready + counts.invalid + counts.failed > 0 ? (
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm"
                onClick={onClearPending}
                disabled={disabled}
              >
                Clear Queue
              </button>
            ) : null}
          </div>

          {showProgress && uploadableTotal > 0 ? (
            <div className="fc-progress-block" aria-live="polite">
              <div className="fc-progress-meta">
                <span>
                  {isUploading
                    ? `Uploading files (${processedCount} of ${uploadableTotal} processed)`
                    : `Processed ${processedCount} of ${uploadableTotal} valid files`}
                </span>
                <span>
                  {counts.uploaded} uploaded
                  {counts.failed > 0 ? ` · ${counts.failed} failed` : ''}
                </span>
              </div>
              <div
                className="fc-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={uploadableTotal}
                aria-valuenow={processedCount}
              >
                <div
                  className="fc-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          ) : null}

          <div className="fc-staging-table-wrap">
            <table className="fc-staging-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Format</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th className="fc-col-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="fc-file-cell">
                        <div className="fc-file-name-row">
                          <span className="fc-file-name">{item.originalFilename}</span>
                          {item.isDuplicateName ? (
                            <span
                              className="fc-dup-badge"
                              title="Duplicate filename; stored with a unique ID without overwriting existing files."
                            >
                              Duplicate name
                            </span>
                          ) : null}
                        </div>
                        {item.relativePath ? (
                          <span className="fc-file-path">{item.relativePath}</span>
                        ) : null}
                        {item.error ? (
                          <span className="fc-file-error">{item.error}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {item.mimeType
                        ? getFormatLabel(item.mimeType)
                        : item.extension
                          ? item.extension.toUpperCase()
                          : '—'}
                    </td>
                    <td>{formatFileSize(item.size)}</td>
                    <td>
                      <span className={`fc-upload-status fc-upload-status-${item.status}`}>
                        {STATUS_LABELS[item.status] ?? item.status}
                      </span>
                    </td>
                    <td className="fc-col-action">
                      {item.status !== 'uploading' && item.status !== 'uploaded' ? (
                        <button
                          type="button"
                          className="fc-btn fc-btn-secondary fc-btn-sm"
                          onClick={() => onRemoveItem(item.id)}
                          disabled={disabled}
                        >
                          Remove
                        </button>
                      ) : (
                        <span className="fc-muted-dash">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

