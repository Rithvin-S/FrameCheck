/**
 * FrameCheck - Annotation Templates Service (Phase 22C)
 * Manages reusable annotation styling, labels, and custom property templates.
 * Provides fallback built-in presets, per-user local storage, and safe template application.
 */

import { supabase } from './supabaseClient.js';
import { normalizeAnnotationStyle, DEFAULT_ANNOTATION_STYLE } from './annotationState.js';

export const BUILTIN_TEMPLATES = Object.freeze([
  {
    id: 'builtin-critical-bug',
    name: 'Critical Bug / Defect',
    description: 'High-visibility red indicator with bug marker and urgent styling',
    tool: 'circle',
    color: '#dc2626',
    style: {
      strokeWidth: 4,
      lineStyle: 'solid',
      strokeOpacity: 1.0,
      fillEnabled: true,
      fillColor: '#dc2626',
      fillOpacity: 0.25,
      marker: 'bug',
      stamp: 'priority',
    },
    customProperties: { severity: 'critical', category: 'bug' },
    labels: ['Bug', 'P0'],
    isBuiltin: true,
  },
  {
    id: 'builtin-ui-polish',
    name: 'UI Polish & Alignment',
    description: 'Blue dashed rectangle for layout offset, spacing, and alignment notes',
    tool: 'rectangle',
    color: '#3b82f6',
    style: {
      strokeWidth: 3,
      lineStyle: 'dashed',
      strokeOpacity: 0.9,
      fillEnabled: true,
      fillColor: '#3b82f6',
      fillOpacity: 0.15,
      marker: null,
      stamp: null,
    },
    customProperties: { component: 'layout', aspect: 'alignment' },
    labels: ['UI', 'Polish'],
    isBuiltin: true,
  },
  {
    id: 'builtin-review-callout',
    name: 'Review Callout & Question',
    description: 'Amber callout box with pointer line for general review inquiries',
    tool: 'callout',
    color: '#f59e0b',
    style: {
      strokeWidth: 3,
      lineStyle: 'solid',
      strokeOpacity: 1.0,
      fillEnabled: false,
      marker: 'warning',
      stamp: 'warning',
      fontSize: 14,
    },
    customProperties: { question: 'needs-clarification' },
    labels: ['Review', 'Question'],
    isBuiltin: true,
  },
  {
    id: 'builtin-typography',
    name: 'Typography & Copy Issue',
    description: 'Purple text callout for editorial, spelling, and typographic feedback',
    tool: 'textbox',
    color: '#8b5cf6',
    style: {
      strokeWidth: 2,
      lineStyle: 'solid',
      fontSize: 16,
      fontStyle: 'italic',
      fontWeight: 'bold',
      fontFamily: 'sans-serif',
    },
    customProperties: { type: 'copyedit' },
    labels: ['Copy', 'Typography'],
    isBuiltin: true,
  },
  {
    id: 'builtin-redaction',
    name: 'Security / PII Redaction',
    description: 'High-intensity blur mask for sensitive information obscuration',
    tool: 'blur',
    color: '#334155',
    style: {
      strokeWidth: 2,
      lineStyle: 'solid',
      strokeOpacity: 0.8,
    },
    customProperties: { redaction: 'PII', compliance: 'confidential' },
    labels: ['Redaction', 'Security'],
    isBuiltin: true,
  },
  {
    id: 'builtin-signoff',
    name: 'Approved / Quality Sign-off',
    description: 'Emerald marker with star badge to signify approved visual component',
    tool: 'marker',
    color: '#10b981',
    style: {
      strokeWidth: 3,
      lineStyle: 'solid',
      marker: 'star',
      markerColor: '#10b981',
      stamp: 'issue',
    },
    customProperties: { status: 'verified', signoff: true },
    labels: ['Approved', 'Verified'],
    isBuiltin: true,
  },
]);

const TEMPLATES_STORAGE_KEY_PREFIX = 'fc_annotation_templates_';

/**
 * Validates and sanitizes a template object.
 */
export function sanitizeTemplate(raw = {}) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled Template';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const tool = typeof raw.tool === 'string' && raw.tool.trim() ? raw.tool.trim() : 'circle';
  const color = typeof raw.color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.color)
    ? raw.color
    : '#dc2626';

  const style = normalizeAnnotationStyle(raw.style, color);

  const customProperties =
    raw.customProperties && typeof raw.customProperties === 'object' && !Array.isArray(raw.customProperties)
      ? { ...raw.customProperties }
      : {};

  const labels = Array.isArray(raw.labels)
    ? raw.labels.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim())
    : [];

  return {
    id: raw.id || `tpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name,
    description,
    tool,
    color,
    style,
    customProperties,
    labels,
    isBuiltin: Boolean(raw.isBuiltin),
    createdBy: raw.createdBy || null,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

/**
 * Retrieves all templates available to the user (built-in presets + custom saved templates).
 */
export async function fetchTemplates(userId = 'guest') {
  let customTemplates = [];
  const localKey = `${TEMPLATES_STORAGE_KEY_PREFIX}${userId || 'guest'}`;

  // 1. Read from localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(localKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          customTemplates = parsed.map(sanitizeTemplate).filter(Boolean);
        }
      }
    } catch (err) {
      console.warn('[annotationTemplateService] Failed reading localStorage templates:', err);
    }
  }

  // 2. Optionally sync with Supabase if table exists and user is authenticated
  if (supabase && userId && userId !== 'guest') {
    try {
      const { data, error } = await supabase
        .from('annotation_templates')
        .select('*')
        .or(`user_id.eq.${userId},is_builtin.eq.true`)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data) && data.length > 0) {
        // Map database records
        const dbCustom = [];
        for (const row of data) {
          if (!row.is_builtin && row.user_id === userId) {
            dbCustom.push(
              sanitizeTemplate({
                id: row.id,
                name: row.name,
                description: row.description,
                tool: row.tool,
                color: row.color,
                style: row.style,
                customProperties: row.custom_properties,
                labels: row.labels,
                isBuiltin: false,
                createdBy: row.user_id,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              })
            );
          }
        }
        if (dbCustom.length > 0) {
          customTemplates = dbCustom;
          if (typeof window !== 'undefined' && window.localStorage) {
            try {
              window.localStorage.setItem(localKey, JSON.stringify(customTemplates));
            } catch {
              // Ignore quota issues
            }
          }
        }
      }
    } catch (err) {
      // Table may not exist yet if migration has not been run; gracefully fallback
    }
  }

  // Combine built-in with user custom templates
  return [...BUILTIN_TEMPLATES, ...customTemplates];
}

/**
 * Saves or updates a custom template for a user.
 */
export async function saveUserTemplate(userId = 'guest', templateData) {
  const sanitized = sanitizeTemplate({
    ...templateData,
    isBuiltin: false,
    createdBy: userId,
    updatedAt: new Date().toISOString(),
  });

  const localKey = `${TEMPLATES_STORAGE_KEY_PREFIX}${userId || 'guest'}`;
  let existingList = [];

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(localKey);
      if (raw) {
        existingList = JSON.parse(raw);
        if (!Array.isArray(existingList)) existingList = [];
      }
    } catch {
      existingList = [];
    }
  }

  const existingIdx = existingList.findIndex((t) => t.id === sanitized.id);
  if (existingIdx >= 0) {
    existingList[existingIdx] = sanitized;
  } else {
    existingList.push(sanitized);
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(localKey, JSON.stringify(existingList));
    } catch (err) {
      console.error('[annotationTemplateService] Failed saving template to localStorage:', err);
    }
  }

  // Attempt Supabase upsert if connected
  if (supabase && userId && userId !== 'guest') {
    try {
      await supabase.from('annotation_templates').upsert({
        id: sanitized.id.startsWith('tpl_') ? undefined : sanitized.id,
        user_id: userId,
        name: sanitized.name,
        description: sanitized.description,
        tool: sanitized.tool,
        color: sanitized.color,
        style: sanitized.style,
        custom_properties: sanitized.customProperties,
        labels: sanitized.labels,
        is_builtin: false,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // Non-fatal if table not migrated yet
    }
  }

  return sanitized;
}

/**
 * Deletes a custom template for a user.
 */
export async function deleteUserTemplate(userId = 'guest', templateId) {
  if (BUILTIN_TEMPLATES.some((t) => t.id === templateId)) {
    throw new Error('Built-in system templates cannot be deleted.');
  }

  const localKey = `${TEMPLATES_STORAGE_KEY_PREFIX}${userId || 'guest'}`;
  let updatedList = [];

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(localKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          updatedList = parsed.filter((t) => t.id !== templateId);
          window.localStorage.setItem(localKey, JSON.stringify(updatedList));
        }
      }
    } catch (err) {
      console.error('[annotationTemplateService] Failed removing template from localStorage:', err);
    }
  }

  if (supabase && userId && userId !== 'guest') {
    try {
      await supabase.from('annotation_templates').delete().eq('id', templateId).eq('user_id', userId);
    } catch {
      // Non-fatal
    }
  }

  return true;
}

/**
 * Resets a user's templates by removing custom items and restoring default starter templates.
 */
export function resetUserTemplates(userId = 'guest') {
  const localKey = `${TEMPLATES_STORAGE_KEY_PREFIX}${userId || 'guest'}`;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(localKey);
    } catch {
      // Ignore
    }
  }
  return [...BUILTIN_TEMPLATES];
}

/**
 * Applies a template to an existing annotation.
 * Preserves annotation geometry, ID, and numbering (does NOT overwrite geometry or metadata).
 */
export function applyTemplateToAnnotation(template, existingAnnotation) {
  if (!template || !existingAnnotation) return existingAnnotation;

  const nextColor = template.color || existingAnnotation.color;
  const mergedStyle = normalizeAnnotationStyle(
    {
      ...(existingAnnotation.style || DEFAULT_ANNOTATION_STYLE),
      ...(template.style || {}),
    },
    nextColor
  );

  const mergedCustomProps = {
    ...(existingAnnotation.customProperties || {}),
    ...(template.customProperties || {}),
  };

  // Merge unique labels
  const existingLabels = Array.isArray(existingAnnotation.labels) ? existingAnnotation.labels : [];
  const templateLabels = Array.isArray(template.labels) ? template.labels : [];
  const combinedLabels = Array.from(new Set([...existingLabels, ...templateLabels]));

  return {
    ...existingAnnotation,
    // Strictly preserve geometry, ID, and numbering
    id: existingAnnotation.id,
    imageId: existingAnnotation.imageId,
    annotationNumber: existingAnnotation.annotationNumber,
    displayNumber: existingAnnotation.displayNumber,
    geometry: existingAnnotation.geometry,
    cx: existingAnnotation.cx,
    cy: existingAnnotation.cy,
    r: existingAnnotation.r,
    type: existingAnnotation.type,
    // Update style, color, customProperties, and labels
    color: nextColor,
    style: mergedStyle,
    customProperties: mergedCustomProps,
    labels: combinedLabels,
  };
}

/**
 * Creates a template data object extracted from a given annotation.
 */
export function extractTemplateFromAnnotation(annotation, name = '', description = '') {
  if (!annotation) return null;

  return {
    name: name.trim() || `Template from #${annotation.displayNumber || annotation.annotationNumber || 'Annotation'}`,
    description: description.trim(),
    tool: annotation.type || annotation.geometry?.type || 'circle',
    color: annotation.color || '#dc2626',
    style: annotation.style ? { ...annotation.style } : { ...DEFAULT_ANNOTATION_STYLE },
    customProperties: annotation.customProperties ? { ...annotation.customProperties } : {},
    labels: Array.isArray(annotation.labels) ? [...annotation.labels] : [],
  };
}

