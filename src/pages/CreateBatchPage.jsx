import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDropSelector } from '../components/FileDropSelector.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { createBatch } from '../services/batchService.js';
import {
  prepareStagedFiles,
  recomputeDuplicateFlags,
  uploadBatchImages,
} from '../services/imageUploadService.js';
import './DashboardPage.css';
import './CreateBatchPage.css';

/**
 * Guided Create Batch and Upload page supporting multi-file and nested folder uploads.
 */
export function CreateBatchPage() {
  const { user } = useAuth();

  const [batchName, setBatchName] = useState('');
  const [stagedItems, setStagedItems] = useState([]);
  const [createdBatch, setCreatedBatch] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [summaryMessage, setSummaryMessage] = useState('');

  const handleFilesSelected = useCallback(async (fileList) => {
    setErrorMessage('');
    setSummaryMessage('');
    const nextItems = await prepareStagedFiles(fileList, [], stagedItems);
    setStagedItems(nextItems);
  }, [stagedItems]);

  const handleRemoveItem = useCallback((itemId) => {
    setStagedItems((prev) =>
      recomputeDuplicateFlags(
        prev.filter((item) => item.id !== itemId),
        []
      )
    );
  }, []);

  const handleClearPending = useCallback(() => {
    setStagedItems((prev) =>
      recomputeDuplicateFlags(
        prev.filter((item) => item.status === 'uploaded'),
        []
      )
    );
    setErrorMessage('');
  }, []);

  const handleItemUpdate = useCallback((itemId, patch) => {
    setStagedItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
    );
  }, []);

  const readyOrFailedCount = stagedItems.filter(
    (item) => item.status === 'ready' || item.status === 'failed'
  ).length;
  const failedCount = stagedItems.filter((item) => item.status === 'failed').length;
  const uploadedCount = stagedItems.filter(
    (item) => item.status === 'uploaded'
  ).length;

  const handleStartUpload = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setSummaryMessage('');

    const trimmedName = batchName.trim();
    if (!createdBatch) {
      if (!trimmedName) {
        setErrorMessage('Enter a batch name before uploading.');
        return;
      }
      if (trimmedName.length > 120) {
        setErrorMessage('Batch name must be 120 characters or fewer.');
        return;
      }
    }

    if (readyOrFailedCount === 0) {
      setErrorMessage(
        'Select at least one valid JPG, JPEG, PNG, or WEBP image to upload.'
      );
      return;
    }

    setIsUploading(true);
    try {
      let targetBatch = createdBatch;
      if (!targetBatch) {
        targetBatch = await createBatch({
          name: trimmedName,
          ownerId: user.id,
        });
        setCreatedBatch(targetBatch);
      }

      const result = await uploadBatchImages({
        batchId: targetBatch.id,
        ownerId: targetBatch.owner_id,
        items: stagedItems,
        onItemUpdate: handleItemUpdate,
      });

      if (result.failedCount > 0) {
        setSummaryMessage(
          `Batch "${targetBatch.name}" saved: ${result.uploadedCount} uploaded, ${result.failedCount} failed. Review the failed items below and retry.`
        );
      } else {
        setSummaryMessage(
          `Batch "${targetBatch.name}" created with ${result.uploadedCount} ${
            result.uploadedCount === 1 ? 'image' : 'images'
          }.`
        );
      }
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to create batch or upload images.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <main className="fc-page-main">
      <div className="fc-page-header">
        <div className="fc-page-title-group">
          <Link to="/dashboard" className="fc-breadcrumb-link">
            ← Back to Batches
          </Link>
          <h1 className="fc-page-title">Create New Batch</h1>
          <p className="fc-page-subtitle">
            Name your batch, review selected images or folders, and upload originals to
            private storage.
          </p>
        </div>

        {createdBatch ? (
          <Link to={`/batches/${createdBatch.id}`} className="fc-btn fc-btn-primary">
            Open Created Batch
          </Link>
        ) : null}
      </div>

      {errorMessage ? (
        <div className="fc-alert fc-alert-error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {summaryMessage ? (
        <div
          className={`fc-alert ${failedCount > 0 ? 'fc-alert-info' : 'fc-alert-success'}`}
          role="status"
        >
          {summaryMessage}
        </div>
      ) : null}

      <form className="fc-create-card" onSubmit={handleStartUpload} noValidate>
        <div className="fc-batch-name-field">
          <label htmlFor="batch-name" className="fc-label">
            1. Batch name
          </label>
          <input
            id="batch-name"
            type="text"
            className="fc-input"
            value={batchName}
            onChange={(event) => setBatchName(event.target.value)}
            maxLength={120}
            placeholder="e.g. Product Packaging — Round 1"
            disabled={isUploading || Boolean(createdBatch)}
            required
          />
          {createdBatch ? (
            <span className="fc-field-hint">
              Batch created. You can still retry failed files or add more images.
            </span>
          ) : (
            <span className="fc-field-hint">
              You will be recorded as the owner of this batch.
            </span>
          )}
        </div>

        <FileDropSelector
          items={stagedItems}
          onFilesSelected={handleFilesSelected}
          onRemoveItem={handleRemoveItem}
          onClearPending={handleClearPending}
          disabled={isUploading}
          isUploading={isUploading}
        />

        <div className="fc-create-footer">
          <span className="fc-create-note">
            {uploadedCount > 0 && readyOrFailedCount === 0
              ? 'All staged valid images have been uploaded.'
              : `${readyOrFailedCount} valid ${
                  readyOrFailedCount === 1 ? 'image' : 'images'
                } ready to upload.`}
          </span>

          <div className="fc-create-footer-actions">
            {createdBatch ? (
              <Link
                to={`/batches/${createdBatch.id}`}
                className="fc-btn fc-btn-secondary"
              >
                Open Batch
              </Link>
            ) : (
              <Link to="/dashboard" className="fc-btn fc-btn-secondary">
                Cancel
              </Link>
            )}

            <button
              type="submit"
              className="fc-btn fc-btn-primary"
              disabled={isUploading || readyOrFailedCount === 0}
            >
              {isUploading
                ? 'Uploading…'
                : createdBatch && failedCount > 0
                  ? `Retry Failed (${failedCount})`
                  : createdBatch
                    ? 'Upload Selected Images'
                    : 'Create Batch & Upload'}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}

