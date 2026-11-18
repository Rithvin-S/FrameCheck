import { isSupabaseConfigured, supabase } from './supabaseClient.js';
import { getReviewerColor } from './annotationState.js';

export const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'comments', label: 'Comments & Discussions' },
  { id: 'status', label: 'Status & Resolution' },
  { id: 'handoffs', label: 'Assignments & Handoffs' },
  { id: 'completions', label: 'Completions' },
  { id: 'annotations', label: 'Drawings & Edits' },
  { id: 'whiteboard', label: 'Whiteboard' },
];

/**
 * Categorizes an activity event into one of the UI filter tabs.
 */
export function getActivityCategory(eventType, metadata = {}) {
  if (
    eventType === 'reviewer_handoff' ||
    eventType === 'annotation_assigned' ||
    metadata?.subType === 'reviewer_handoff' ||
    metadata?.subType === 'annotation_assignment'
  ) {
    return 'handoffs';
  }
  if (
    eventType === 'checklist_item_completed' ||
    eventType === 'checklist_item_reopened' ||
    eventType === 'image_completed' ||
    eventType === 'batch_review_completed'
  ) {
    return 'completions';
  }
  switch (eventType) {
    case 'annotation_resolved':
    case 'annotation_reopened':
      return 'status';
    case 'annotation_created':
    case 'annotation_geometry_edited':
    case 'annotation_deleted':
    case 'annotation_edited':
      return 'annotations';
    case 'comment_added':
    case 'comment_mention':
    case 'reaction_added':
      return 'comments';
    case 'whiteboard_created':
    case 'whiteboard_updated':
      return 'whiteboard';
    case 'presence_joined':
    case 'presence_left':
      return 'presence';
    default:
      return 'all';
  }
}

/**
 * Returns a human-friendly relative timestamp.
 */
export function formatActivityRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (Number.isNaN(diffMs)) return '';

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) return 'Just now';
  if (diffSec < 90) return '1m ago';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Generates an action description line for an activity event.
 */
export function getActivityActionText(activity) {
  if (!activity) return '';
  const num = activity.annotationNumber ? `#${activity.annotationNumber}` : '';

  switch (activity.eventType) {
    case 'annotation_created':
      return num ? `added annotation ${num}` : 'added an annotation';
    case 'annotation_geometry_edited':
      return num ? `adjusted geometry for annotation ${num}` : 'adjusted annotation geometry';
    case 'annotation_resolved':
      return num ? `resolved feedback ${num}` : 'resolved feedback';
    case 'annotation_reopened':
      return num ? `reopened feedback ${num}` : 'reopened feedback';
    case 'annotation_deleted':
      return num ? `deleted annotation ${num}` : 'deleted an annotation';
    case 'annotation_edited':
      return num ? `edited annotation ${num}` : 'edited annotation';
    case 'comment_added':
      return num ? `added explanation for annotation ${num}` : 'added a comment';
    case 'comment_mention':
      return activity.details || 'mentioned a reviewer';
    case 'reviewer_handoff': {
      const fromName = activity.metadata?.fromName;
      const toName = activity.metadata?.toName;
      if (fromName && toName) {
        return num ? `handed off ${num} from ${fromName} to ${toName}` : `handed off annotation from ${fromName} to ${toName}`;
      }
      return num ? `handed off annotation ${num}` : 'handed off an annotation';
    }
    case 'annotation_assigned': {
      if (activity.metadata?.subType === 'reviewer_handoff') {
        const fromName = activity.metadata?.fromName;
        const toName = activity.metadata?.toName;
        if (fromName && toName) {
          return num ? `handed off ${num} from ${fromName} to ${toName}` : `handed off annotation from ${fromName} to ${toName}`;
        }
      }
      const toName = activity.metadata?.assigneeName || activity.metadata?.toName;
      if (toName) {
        return num ? `assigned ${num} to ${toName}` : `assigned annotation to ${toName}`;
      }
      return num ? `assigned annotation ${num}` : 'assigned an annotation';
    }
    case 'checklist_item_completed':
      return activity.details ? `checked off "${activity.details}"` : 'completed review criterion';
    case 'checklist_item_reopened':
      return activity.details ? `reopened "${activity.details}"` : 'reopened review criterion';
    case 'whiteboard_created': {
      const type = activity.elementType || 'shape';
      return `added ${type} to whiteboard`;
    }
    case 'whiteboard_updated': {
      const type = activity.elementType || 'shape';
      return `updated ${type} on whiteboard`;
    }
    case 'image_completed':
      return activity.imagePosition
        ? `marked image #${activity.imagePosition} complete`
        : 'marked image as complete';
    case 'batch_review_completed':
      return 'completed the batch review';
    case 'presence_joined':
      return 'joined the review workspace';
    case 'presence_left':
      return 'left the review workspace';
    case 'reaction_added':
      return `reacted with ${activity.details || 'an emoji'}`;
    default:
      return activity.details || 'performed an action';
  }
}

/**
 * Constructs a semantic key for an activity item to prevent duplicate events
 * generated concurrently across database triggers, Realtime events, and optimistic client updates.
 */
function getActivitySemanticKey(item) {
  if (!item || !item.eventType) return item?.id || null;
  const timeMs = item.occurredAt ? new Date(item.occurredAt).getTime() : 0;

  switch (item.eventType) {
    case 'annotation_created':
      return item.annotationId ? `annotation_created:${item.annotationId}` : item.id;
    case 'annotation_resolved':
    case 'annotation_reopened':
    case 'annotation_geometry_edited':
    case 'annotation_edited':
    case 'annotation_deleted':
    case 'comment_added':
      return item.annotationId
        ? `${item.eventType}:${item.annotationId}:${Math.floor(timeMs / 4000)}`
        : item.id;
    case 'reviewer_handoff':
    case 'annotation_assigned': {
      const targetUser = item.metadata?.toUserId || item.metadata?.assignedTo || '';
      return item.annotationId
        ? `${item.eventType}:${item.annotationId}:${targetUser}:${Math.floor(timeMs / 4000)}`
        : item.id;
    }
    case 'checklist_item_completed':
    case 'checklist_item_reopened':
      return `${item.eventType}:${item.elementId || item.details}:${Math.floor(timeMs / 4000)}`;
    case 'comment_mention': {
      const mentionId = item.metadata?.mentioned_user_id || item.details || '';
      return item.annotationId
        ? `comment_mention:${item.annotationId}:${mentionId}:${Math.floor(timeMs / 4000)}`
        : item.id;
    }
    case 'image_completed':
      return item.imageId
        ? `image_completed:${item.imageId}:${Math.floor(timeMs / 10000)}`
        : item.id;
    case 'batch_review_completed':
      return `batch_review_completed:${Math.floor(timeMs / 60000)}`;
    case 'whiteboard_created':
      return item.elementId ? `whiteboard_created:${item.elementId}` : item.id;
    case 'whiteboard_updated':
      return item.elementId
        ? `whiteboard_updated:${item.elementId}:${Math.floor(timeMs / 4000)}`
        : item.id;
    case 'presence_joined':
    case 'presence_left':
      return `${item.eventType}:${item.actorId}:${Math.floor(timeMs / 15000)}`;
    case 'reaction_added': {
      const ann = item.annotationId || '';
      const act = item.actorId || '';
      const det = item.details || '';
      return `reaction_added:${ann}:${act}:${det}:${Math.floor(timeMs / 5000)}`;
    }
    default:
      return item.id;
  }
}

/**
 * Merges two equivalent activity items, prioritizing persistent UUIDs and complete metadata.
 */
function mergeActivityItems(existing, incoming) {
  const isExistingUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    existing.id
  );
  const isIncomingUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    incoming.id
  );

  const preferredId = isIncomingUuid
    ? incoming.id
    : isExistingUuid
    ? existing.id
    : existing.id;
  const preferredActorName =
    incoming.actorName && incoming.actorName !== 'Reviewer'
      ? incoming.actorName
      : existing.actorName || incoming.actorName || 'Reviewer';
  const preferredImageFilename =
    incoming.imageFilename || existing.imageFilename || null;
  const preferredImagePosition =
    incoming.imagePosition ?? existing.imagePosition ?? null;
  const preferredDetails = incoming.details || existing.details || '';

  return {
    ...existing,
    ...incoming,
    id: preferredId,
    actorName: preferredActorName,
    imageFilename: preferredImageFilename,
    imagePosition: preferredImagePosition,
    details: preferredDetails,
    occurredAt: existing.occurredAt || incoming.occurredAt,
  };
}

/**
 * Deduplicates activities by ID and semantic key, and sorts deterministically:
 * newest occurredAt first; ties broken by stable id comparison.
 */
export function deduplicateAndSortActivities(activities = []) {
  if (!Array.isArray(activities) || activities.length === 0) return [];
  const idMap = new Map();
  const semanticMap = new Map();

  for (const item of activities) {
    if (!item || !item.id) continue;

    // Direct ID match
    if (idMap.has(item.id)) {
      const merged = mergeActivityItems(idMap.get(item.id), item);
      idMap.set(item.id, merged);
      continue;
    }

    // Semantic key match (merges DB event with optimistic or synthesized event)
    const semKey = getActivitySemanticKey(item);
    if (semKey && semanticMap.has(semKey)) {
      const existing = semanticMap.get(semKey);
      const merged = mergeActivityItems(existing, item);
      idMap.delete(existing.id);
      idMap.set(merged.id, merged);
      semanticMap.set(semKey, merged);
    } else {
      idMap.set(item.id, item);
      if (semKey) {
        semanticMap.set(semKey, item);
      }
    }
  }

  return Array.from(idMap.values()).sort((a, b) => {
    const timeA = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
    const timeB = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
    const diff = timeB - timeA;
    if (diff !== 0) return diff;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

/**
 * Attempts to persist an activity event to public.batch_activity_events,
 * returning the normalized activity object.
 */
export async function recordActivityEvent({
  batchId,
  eventType,
  actorId,
  actorName = 'Reviewer',
  imageId = null,
  imageFilename = null,
  imagePosition = null,
  annotationId = null,
  annotationNumber = null,
  elementId = null,
  elementType = null,
  details = '',
  metadata = {},
  occurredAt = null,
}) {
  const timestamp = occurredAt || new Date().toISOString();
  const generatedId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const activityItem = {
    id: generatedId,
    eventType,
    occurredAt: timestamp,
    actorId,
    actorName,
    imageId,
    imageFilename,
    imagePosition,
    annotationId,
    annotationNumber,
    elementId,
    elementType,
    details,
    metadata,
  };

  if (!isSupabaseConfigured || !supabase || !batchId || !actorId) {
    return activityItem;
  }

  // Never persist transient presence events
  if (eventType === 'presence_joined' || eventType === 'presence_left') {
    return activityItem;
  }

  try {
    const insertPayload = {
      batch_id: batchId,
      event_type: eventType,
      occurred_at: timestamp,
      actor_id: actorId,
      image_id: imageId,
      annotation_id: annotationId,
      annotation_number: annotationNumber,
      element_id: elementId,
      element_type: elementType,
      details,
      metadata,
    };

    const { data, error } = await supabase
      .from('batch_activity_events')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error && error.message?.includes('violates check constraint') && (
      eventType === 'reviewer_handoff' ||
      eventType === 'annotation_assigned' ||
      eventType === 'checklist_item_completed' ||
      eventType === 'checklist_item_reopened'
    )) {
      // If 017 migration is not yet applied, fallback gracefully to a standard event_type while preserving full metadata
      const fallbackType = eventType.startsWith('checklist') ? 'image_completed' : 'annotation_geometry_edited';
      const retryResult = await supabase
        .from('batch_activity_events')
        .insert({
          ...insertPayload,
          event_type: fallbackType,
          metadata: {
            ...metadata,
            original_event_type: eventType,
          },
        })
        .select('id')
        .single();
      if (!retryResult.error && retryResult.data?.id) {
        activityItem.id = retryResult.data.id;
      }
    } else if (!error && data?.id) {
      activityItem.id = data.id;
    }
  } catch (err) {
    // If table doesn't exist yet (migration unapplied), gracefully keep in-memory activityItem
    console.debug('Direct activity event write unmigrated, operating in-memory:', err);
  }

  return activityItem;
}

/**
 * Convenience helper to record a reviewer handoff activity event.
 */
export async function recordHandoffActivity({
  batchId,
  annotationId,
  annotationNumber,
  imageId = null,
  imageFilename = null,
  imagePosition = null,
  actorId,
  actorName = 'Reviewer',
  fromUserId = null,
  fromUserName = 'Reviewer',
  toUserId = null,
  toUserName = 'Unassigned',
}) {
  const details = toUserId
    ? `Handed off #${annotationNumber || ''} from ${fromUserName} to ${toUserName}`
    : `Unassigned #${annotationNumber || ''}`;

  return recordActivityEvent({
    batchId,
    eventType: 'reviewer_handoff',
    actorId,
    actorName,
    imageId,
    imageFilename,
    imagePosition,
    annotationId,
    annotationNumber,
    details,
    metadata: {
      subType: 'reviewer_handoff',
      fromUserId,
      fromName: fromUserName,
      toUserId,
      toName: toUserName,
      assignedTo: toUserId,
      assigneeName: toUserName,
    },
  });
}

/**
 * Assembles a comprehensive, deduplicated, chronologically sorted activity history for a specific annotation.
 */
export function getAnnotationHistory(activities = [], annotation = null, discussions = []) {
  if (!annotation || !annotation.id) return [];

  const history = [];

  // 1. Collect all matching activities from the batch activity feed
  (activities || []).forEach((act) => {
    if (act && String(act.annotationId) === String(annotation.id)) {
      history.push(act);
    }
  });

  // 2. Synthesize discussion replies if they are not already in history
  (discussions || []).forEach((disc) => {
    if (!disc || !disc.message) return;
    const exists = history.some(
      (h) => (h.eventType === 'comment_added' && (h.id === disc.id || h.details === disc.message))
    );
    if (!exists) {
      history.push({
        id: `disc-${disc.id}`,
        eventType: 'comment_added',
        actorId: disc.userId,
        actorName: disc.authorName || 'Reviewer',
        occurredAt: disc.createdAt || new Date().toISOString(),
        annotationId: annotation.id,
        annotationNumber: annotation.displayNumber || annotation.annotationNumber,
        details: disc.message,
        metadata: { isDiscussion: true },
      });
    }
  });

  // 3. Ensure initial creation event exists
  const hasCreation = history.some((h) => h.eventType === 'annotation_created');
  if (!hasCreation && annotation.createdAt) {
    history.push({
      id: `ann-created-${annotation.id}`,
      eventType: 'annotation_created',
      actorId: annotation.createdBy,
      actorName: annotation.creatorName || 'Reviewer',
      occurredAt: annotation.createdAt,
      annotationId: annotation.id,
      annotationNumber: annotation.displayNumber || annotation.annotationNumber,
      details: annotation.comment || 'Created annotation',
      metadata: { initialComment: annotation.comment },
    });
  }

  // 4. Ensure resolved event exists if annotation is resolved
  if (annotation.status === 'resolved' && annotation.resolvedAt) {
    const hasResolved = history.some((h) => h.eventType === 'annotation_resolved');
    if (!hasResolved) {
      history.push({
        id: `ann-resolved-${annotation.id}-${new Date(annotation.resolvedAt).getTime()}`,
        eventType: 'annotation_resolved',
        actorId: annotation.resolvedBy || annotation.createdBy,
        actorName: 'Reviewer',
        occurredAt: annotation.resolvedAt,
        annotationId: annotation.id,
        annotationNumber: annotation.displayNumber || annotation.annotationNumber,
        details: `Resolved feedback #${annotation.displayNumber || annotation.annotationNumber || ''}`,
        metadata: { status: 'resolved' },
      });
    }
  }

  // 5. Ensure current assignment/handoff is represented if not already in history
  if (annotation.assignedTo) {
    const hasAssignmentOrHandoff = history.some(
      (h) => h.eventType === 'reviewer_handoff' || h.eventType === 'annotation_assigned' || h.metadata?.subType === 'reviewer_handoff'
    );
    if (!hasAssignmentOrHandoff) {
      history.push({
        id: `ann-asg-${annotation.id}`,
        eventType: 'annotation_assigned',
        actorId: annotation.createdBy,
        actorName: annotation.creatorName || 'Reviewer',
        occurredAt: annotation.updatedAt || annotation.createdAt || new Date().toISOString(),
        annotationId: annotation.id,
        annotationNumber: annotation.displayNumber || annotation.annotationNumber,
        details: `Assigned #${annotation.displayNumber || annotation.annotationNumber || ''} to ${annotation.assigneeName || 'Reviewer'}`,
        metadata: { assignedTo: annotation.assignedTo, assigneeName: annotation.assigneeName },
      });
    }
  }

  // Deduplicate and sort chronologically: newest first
  return deduplicateAndSortActivities(history);
}

/**
 * Client-side fallback fetcher if RPC is not yet available in the database.
 * Strictly relies only on verified PostgreSQL columns:
 * - batch_images: id, batch_id, original_filename, display_order, is_completed, completed_at, completed_by
 * - annotations: id, image_id, annotation_number, comment, type, color, status, created_by, created_at, updated_at, resolved_at, deleted_at
 * - batch_whiteboard_elements: id, batch_id, type, text, color, created_by, created_at, updated_at
 */
async function fetchBatchActivityFallback({ batchId, limit = 50 }) {
  if (!supabase || !batchId) return [];

  try {
    // 1. Try querying batch_activity_events table directly if RPC is missing
    const { data: tableEvents, error: tableErr } = await supabase
      .from('batch_activity_events')
      .select('id, batch_id, event_type, occurred_at, actor_id, image_id, annotation_id, annotation_number, element_id, element_type, details, metadata')
      .eq('batch_id', batchId)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (!tableErr && Array.isArray(tableEvents) && tableEvents.length > 0) {
      // Enrich with image details if needed
      const imgIds = tableEvents.map((e) => e.image_id).filter(Boolean);
      let imgMap = new Map();
      if (imgIds.length > 0) {
        const { data: imgRows } = await supabase
          .from('batch_images')
          .select('id, original_filename, display_order')
          .in('id', imgIds);
        if (imgRows) {
          imgMap = new Map(imgRows.map((im) => [im.id, im]));
        }
      }

      // Enrich with actor display names
      const actorIds = Array.from(new Set(tableEvents.map((e) => e.actor_id).filter(Boolean)));
      let profileMap = new Map();
      if (actorIds.length > 0) {
        const { data: profRows } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', actorIds);
        if (profRows) {
          profileMap = new Map(profRows.map((p) => [p.id, p.display_name]));
        }
      }

      return tableEvents.map((row) => {
        const img = row.image_id ? imgMap.get(row.image_id) : null;
        return {
          id: row.id,
          eventType: row.event_type,
          occurredAt: row.occurred_at,
          actorId: row.actor_id,
          actorName: profileMap.get(row.actor_id) || 'Reviewer',
          imageId: row.image_id,
          imageFilename: img?.original_filename || null,
          imagePosition: img?.display_order || null,
          annotationId: row.annotation_id,
          annotationNumber: row.annotation_number,
          elementId: row.element_id,
          elementType: row.element_type,
          details: row.details,
          metadata: row.metadata || {},
        };
      });
    }

    // 2. Fallback: synthesize from underlying tables
    const { data: images, error: imgErr } = await supabase
      .from('batch_images')
      .select('id, batch_id, original_filename, display_order, is_completed, completed_at, completed_by')
      .eq('batch_id', batchId);

    if (imgErr) throw imgErr;
    const imgList = images || [];
    const imageMap = new Map(imgList.map((im) => [im.id, im]));
    const imageIds = imgList.map((im) => im.id);

    const activities = [];

    // Completed images
    imgList.forEach((im) => {
      if (im.is_completed && im.completed_at) {
        activities.push({
          id: `img-completed-${im.id}-${new Date(im.completed_at).getTime()}`,
          eventType: 'image_completed',
          occurredAt: im.completed_at,
          actorId: im.completed_by,
          actorName: 'Reviewer',
          imageId: im.id,
          imageFilename: im.original_filename,
          imagePosition: im.display_order,
          annotationId: null,
          annotationNumber: null,
          elementId: null,
          elementType: null,
          details: `Marked image #${im.display_order || 1} as completed`,
          metadata: { is_completed: true, display_order: im.display_order },
        });
      }
    });

    // Annotations
    if (imageIds.length > 0) {
      const { data: annotations, error: annErr } = await supabase
        .from('annotations')
        .select('id, image_id, annotation_number, comment, type, color, status, created_by, created_at, updated_at, resolved_at, deleted_at')
        .in('image_id', imageIds)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!annErr && annotations) {
        annotations.forEach((ann) => {
          const img = imageMap.get(ann.image_id);

          activities.push({
            id: `ann-created-${ann.id}`,
            eventType: 'annotation_created',
            occurredAt: ann.created_at,
            actorId: ann.created_by,
            actorName: 'Reviewer',
            imageId: ann.image_id,
            imageFilename: img?.original_filename || '',
            imagePosition: img?.display_order || null,
            annotationId: ann.id,
            annotationNumber: ann.annotation_number,
            elementId: null,
            elementType: null,
            details: ann.comment,
            metadata: {
              type: ann.type || 'circle',
              color: ann.color,
              status: ann.status,
            },
          });

          if (ann.status === 'resolved' && ann.resolved_at) {
            activities.push({
              id: `ann-resolved-${ann.id}-${new Date(ann.resolved_at).getTime()}`,
              eventType: 'annotation_resolved',
              occurredAt: ann.resolved_at,
              actorId: ann.created_by,
              actorName: 'Reviewer',
              imageId: ann.image_id,
              imageFilename: img?.original_filename || '',
              imagePosition: img?.display_order || null,
              annotationId: ann.id,
              annotationNumber: ann.annotation_number,
              elementId: null,
              elementType: null,
              details: 'Resolved feedback',
              metadata: {
                type: ann.type || 'circle',
                comment_snippet: (ann.comment || '').slice(0, 80),
              },
            });
          }

          if (
            ann.updated_at &&
            ann.created_at &&
            new Date(ann.updated_at).getTime() - new Date(ann.created_at).getTime() > 15000 &&
            ann.status !== 'resolved'
          ) {
            activities.push({
              id: `ann-geom-${ann.id}-${new Date(ann.updated_at).getTime()}`,
              eventType: 'annotation_geometry_edited',
              occurredAt: ann.updated_at,
              actorId: ann.created_by,
              actorName: 'Reviewer',
              imageId: ann.image_id,
              imageFilename: img?.original_filename || '',
              imagePosition: img?.display_order || null,
              annotationId: ann.id,
              annotationNumber: ann.annotation_number,
              elementId: null,
              elementType: null,
              details: 'Updated annotation geometry',
              metadata: { type: ann.type || 'circle' },
            });
          }
        });
      }
    }

    // Whiteboard elements
    try {
      const { data: wbElements } = await supabase
        .from('batch_whiteboard_elements')
        .select('id, batch_id, type, text, color, created_by, created_at, updated_at')
        .eq('batch_id', batchId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (wbElements) {
        wbElements.forEach((el) => {
          activities.push({
            id: `wb-created-${el.id}`,
            eventType: 'whiteboard_created',
            occurredAt: el.created_at,
            actorId: el.created_by,
            actorName: 'Reviewer',
            imageId: null,
            imageFilename: null,
            imagePosition: null,
            annotationId: null,
            annotationNumber: null,
            elementId: el.id,
            elementType: el.type,
            details: el.text ? el.text.slice(0, 100) : `Added ${el.type} to whiteboard`,
            metadata: { element_type: el.type, color: el.color },
          });
        });
      }
    } catch {
      // Table may not exist if whiteboard migration unapplied
    }

    return deduplicateAndSortActivities(activities).slice(0, limit);
  } catch (err) {
    console.warn('Error in fetchBatchActivityFallback:', err);
    return [];
  }
}

/**
 * Fetches the batch activity feed with RPC call and graceful fallback.
 */
export async function fetchBatchActivityFeed({ batchId, limit = 50, offset = 0 }) {
  if (!isSupabaseConfigured || !supabase || !batchId) {
    return [];
  }

  try {
    const { data, error } = await supabase.rpc('get_batch_activity_feed', {
      target_batch_id: batchId,
      limit_count: limit,
      offset_count: offset,
    });

    if (!error && Array.isArray(data)) {
      const mapped = data.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
        actorId: row.actor_id,
        actorName: row.actor_name || 'Reviewer',
        imageId: row.image_id,
        imageFilename: row.image_filename,
        imagePosition: row.image_position,
        annotationId: row.annotation_id,
        annotationNumber: row.annotation_number,
        elementId: row.element_id,
        elementType: row.element_type,
        details: row.details,
        metadata: row.metadata || {},
      }));
      return deduplicateAndSortActivities(mapped);
    }
  } catch (err) {
    console.warn('RPC get_batch_activity_feed not available, using fallback:', err);
  }

  return fetchBatchActivityFallback({ batchId, limit });
}
