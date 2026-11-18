-- Phase 22C: Reusable Annotation Templates Migration
-- Target: Supabase PostgreSQL (run after migrations 001 through 019)
-- Prepares annotation templates schema, indices, RLS policies, and starter presets.
-- (Prepared for manual review; unexecuted per guidelines)

-- ============================================================================
-- 1. Annotation Templates Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.annotation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  tool text NOT NULL DEFAULT 'circle',
  color text NOT NULL DEFAULT '#dc2626',
  style jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_builtin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Performance & Lookup Indices
CREATE INDEX IF NOT EXISTS idx_annotation_templates_user_id
  ON public.annotation_templates (user_id);

CREATE INDEX IF NOT EXISTS idx_annotation_templates_builtin
  ON public.annotation_templates (is_builtin);

CREATE INDEX IF NOT EXISTS idx_annotation_templates_created_at
  ON public.annotation_templates (created_at DESC);

-- Automatic updated_at Trigger
CREATE OR REPLACE FUNCTION public.handle_annotation_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_annotation_templates_updated_at ON public.annotation_templates;
CREATE TRIGGER tr_annotation_templates_updated_at
  BEFORE UPDATE ON public.annotation_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_annotation_template_updated_at();

-- ============================================================================
-- 2. Row Level Security (RLS) Policies
-- ============================================================================

ALTER TABLE public.annotation_templates ENABLE ROW LEVEL SECURITY;

-- Select policy: users can view system built-ins or their own saved templates
DROP POLICY IF EXISTS "Users can view builtin and own templates" ON public.annotation_templates;
CREATE POLICY "Users can view builtin and own templates"
  ON public.annotation_templates
  FOR SELECT
  TO authenticated
  USING (is_builtin = true OR auth.uid() = user_id);

-- Insert policy: authenticated users can create their own custom templates
DROP POLICY IF EXISTS "Users can insert their own templates" ON public.annotation_templates;
CREATE POLICY "Users can insert their own templates"
  ON public.annotation_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND is_builtin = false);

-- Update policy: users can update only their own non-builtin templates
DROP POLICY IF EXISTS "Users can update their own templates" ON public.annotation_templates;
CREATE POLICY "Users can update their own templates"
  ON public.annotation_templates
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND is_builtin = false)
  WITH CHECK (auth.uid() = user_id AND is_builtin = false);

-- Delete policy: users can delete only their own non-builtin templates
DROP POLICY IF EXISTS "Users can delete their own templates" ON public.annotation_templates;
CREATE POLICY "Users can delete their own templates"
  ON public.annotation_templates
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id AND is_builtin = false);

-- ============================================================================
-- 3. Seed Built-In Starter Templates
-- ============================================================================

INSERT INTO public.annotation_templates (id, user_id, name, description, tool, color, style, custom_properties, labels, is_builtin)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    NULL,
    'Critical Bug / Defect',
    'High-visibility red indicator with bug marker and urgent priority styling',
    'circle',
    '#dc2626',
    '{"strokeWidth": 4, "lineStyle": "solid", "strokeOpacity": 1.0, "fillEnabled": true, "fillColor": "#dc2626", "fillOpacity": 0.25, "marker": "bug", "stamp": "priority"}'::jsonb,
    '{"severity": "critical", "category": "bug"}'::jsonb,
    '["Bug", "P0"]'::jsonb,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    NULL,
    'UI Polish & Alignment',
    'Blue dashed rectangle for layout offset, spacing, and alignment notes',
    'rectangle',
    '#3b82f6',
    '{"strokeWidth": 3, "lineStyle": "dashed", "strokeOpacity": 0.9, "fillEnabled": true, "fillColor": "#3b82f6", "fillOpacity": 0.15, "marker": null, "stamp": null}'::jsonb,
    '{"component": "layout", "aspect": "alignment"}'::jsonb,
    '["UI", "Polish"]'::jsonb,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    NULL,
    'Review Callout & Attention',
    'Amber callout box with pointer line for general review inquiries',
    'callout',
    '#f59e0b',
    '{"strokeWidth": 3, "lineStyle": "solid", "strokeOpacity": 1.0, "fillEnabled": false, "marker": "warning", "stamp": "warning", "fontSize": 14}'::jsonb,
    '{"question": "needs-clarification"}'::jsonb,
    '["Review", "Question"]'::jsonb,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    NULL,
    'Typography & Copy Issue',
    'Purple text callout for editorial, spelling, and typographic feedback',
    'textbox',
    '#8b5cf6',
    '{"strokeWidth": 2, "lineStyle": "solid", "fontSize": 16, "fontStyle": "italic", "fontWeight": "bold", "fontFamily": "sans-serif"}'::jsonb,
    '{"type": "copyedit"}'::jsonb,
    '["Copy", "Typography"]'::jsonb,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    NULL,
    'Security / PII Redaction',
    'High-intensity blur mask for sensitive information obscuration',
    'blur',
    '#334155',
    '{"strokeWidth": 2, "lineStyle": "solid", "strokeOpacity": 0.8}'::jsonb,
    '{"redaction": "PII", "compliance": "confidential"}'::jsonb,
    '["Redaction", "Security"]'::jsonb,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000006',
    NULL,
    'Approved / Quality Sign-off',
    'Emerald marker with star badge to signify approved visual component',
    'marker',
    '#10b981',
    '{"strokeWidth": 3, "lineStyle": "solid", "marker": "star", "markerColor": "#10b981", "stamp": "issue"}'::jsonb,
    '{"status": "verified", "signoff": true}'::jsonb,
    '["Approved", "Verified"]'::jsonb,
    true
  )
ON CONFLICT (id) DO NOTHING;

