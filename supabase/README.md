# FrameCheck Supabase Setup

## Phase 1: Authentication & Profiles

### 1. Apply the Phase 1 SQL Migration

Open your Supabase Dashboard -> **SQL Editor** -> **New query**, paste the contents of `supabase/migrations/001_phase1_auth_profiles.sql`, and run it.

### 2. Initial Admin Provisioning

Public registration always assigns the `uploader` role. After registering your initial admin account through the app (or creating it in Supabase **Authentication -> Users**), promote that account to `admin` once in the **SQL Editor**:

```sql
UPDATE public.profiles AS p
SET role = 'admin'
FROM auth.users AS u
WHERE u.id = p.id
  AND u.email = 'your-admin-email@example.com';
```

Verify the update succeeded:

```sql
SELECT p.id, u.email, p.display_name, p.role
FROM public.profiles AS p
JOIN auth.users AS u ON u.id = p.id
WHERE u.email = 'your-admin-email@example.com';
```

---

## Phase 2: Batches & Private Image Storage

### 1. Apply the Phase 2 SQL Migration

Open your Supabase Dashboard -> **SQL Editor** -> **New query**, paste the contents of `supabase/migrations/002_phase2_batches_and_images.sql`, and run it.

This creates:
- `public.batches` and `public.batch_images` tables with constraints, indexes, and triggers
- `public.is_reviewer_or_admin()` and `public.can_access_batch_storage_path(text, boolean)` helpers
- Row Level Security policies for Uploader, Reviewer, and Admin access
- Private storage bucket `framecheck-images` (`public = false`, 50 MB per-file limit, allowed MIME types `image/jpeg`, `image/png`, `image/webp`) and storage RLS policies

### 2. Verify Private Storage Bucket & Policies

In Supabase Dashboard -> **Storage**:
1. Confirm the bucket **`framecheck-images`** exists and is marked **Private** (not Public).
2. Under **Storage -> Policies** for `framecheck-images`, confirm both policies exist:
   - `framecheck_images_select_authorized` (`SELECT`, `TO authenticated`)
   - `framecheck_images_insert_owner_or_admin` (`INSERT`, `TO authenticated`)
3. If your project's SQL Editor permissions prevented creating policies on `storage.objects`, create those two policies manually in **Storage -> Policies -> framecheck-images** using:
   - **SELECT policy** (`authenticated`):
     ```sql
     bucket_id = 'framecheck-images' AND public.can_access_batch_storage_path(name, false)
     ```
   - **INSERT policy** (`authenticated`):
     ```sql
     bucket_id = 'framecheck-images' AND public.can_access_batch_storage_path(name, true)
     ```
4. No `UPDATE` or `DELETE` storage policies should be added in Phase 2 so original uploaded files cannot be overwritten or deleted by clients.

---

## Phase 5: Persisted Annotations, Comments & Resolution

### 1. Apply the Phase 5 SQL Migration

Open your Supabase Dashboard -> **SQL Editor** -> **New query**, paste the contents of `supabase/migrations/003_phase5_annotations.sql`, and run it.

This creates:
- `public.annotations` table with normalized circle geometry constraints (`cx`, `cy`, `r`), non-empty comments, `open`/`resolved` status tracking, `resolved_at`, and soft-delete (`deleted_at`)
- Transaction-safe per-image sequential numbering (`annotation_number` starting at `1` and never reused after deletion)
- Creator-only `UPDATE` protections, immutable column guards, and `profiles` `SELECT` policy so authorized batch viewers can display annotation creator names
- Creator-only RPC functions `public.soft_delete_annotation(uuid)` and `public.restore_annotation(uuid)` for soft deletion and Undo/Redo restoration

### 2. Verify Phase 5 Policies & RPCs

In Supabase Dashboard -> **Database -> Tables -> `annotations` -> Policies**, confirm:
1. Row Level Security is **Enabled** on `public.annotations`.
2. Three policies exist for `authenticated`:
   - `annotations_select_authorized` (`SELECT`)
   - `annotations_insert_authorized` (`INSERT`)
   - `annotations_update_creator` (`UPDATE`)
3. Confirm `profiles_select_annotation_creators` exists on `public.profiles`.
4. Confirm both RPC functions `public.soft_delete_annotation` and `public.restore_annotation` exist under **Database -> Functions**.

---

## Dashboard Review Status & Image Completion

### 1. Apply the Review Status SQL Migration

Open your Supabase Dashboard -> **SQL Editor** -> **New query**, paste the contents of `supabase/migrations/004_review_status.sql`, and run it.

This adds:
- `is_completed`, `completed_at`, and `completed_by` columns on `public.batch_images` with consistency checks and `protect_batch_image_columns()` trigger
- Column-scoped `UPDATE (is_completed)` grant and `batch_images_update_completion_authorized` RLS policy matching existing batch review authorization
- `public.list_dashboard_batches()` RPC function aggregating batch counts and deriving `not_started`, `in_review`, or `review_completed` in one RLS-enforced query

### 2. Verify Review Status Migration

1. Under **Database -> Tables -> `batch_images`**, confirm `is_completed` (`boolean`, default `false`), `completed_at`, and `completed_by` columns exist.
2. Confirm policy `batch_images_update_completion_authorized` (`UPDATE`) exists on `public.batch_images`.
3. Under **Database -> Functions**, confirm `public.list_dashboard_batches` exists.

---

## Phase 7: Real-Time Collaboration

### 1. Apply the Phase 7 SQL Migration

Open your Supabase Dashboard -> **SQL Editor** -> **New query**, paste the contents of `supabase/migrations/005_phase7_realtime.sql`, and run it.

This adds:
- `public.annotation_deletion_events` tombstone log table with `SELECT`-only grant and RLS (`public.can_view_batch_image(image_id)`) so soft-delete events synchronize securely while `public.annotations` keeps excluding soft-deleted rows
- `trg_annotations_record_soft_delete` trigger recording soft-delete transitions from `public.annotations`
- Idempotent `supabase_realtime` publication setup for `public.annotations`, `public.annotation_deletion_events`, and `public.batch_images`

### 2. Verify Realtime Publication & Policies

In Supabase Dashboard -> **Database -> Replication** (or **Publications -> `supabase_realtime`**):
1. Confirm `public.annotations`, `public.annotation_deletion_events`, and `public.batch_images` are enabled in the `supabase_realtime` publication.
2. Under **Database -> Tables -> `annotation_deletion_events` -> Policies**, confirm RLS is enabled with policy `annotation_deletion_events_select_authorized`.

---

## Fix Uploader Review Permissions

### 1. Apply Migration 006

Open your Supabase Dashboard -> **SQL Editor** -> **New query**, paste the contents of `supabase/migrations/006_fix_uploader_review_permissions.sql`, and run it.

This updates database-level permissions without altering existing tables or data:
- Adds `public.can_review_batch_image(uuid)` (`reviewer` and `admin` roles only), while preserving `public.can_view_batch_image(uuid)` so Uploaders keep read-only viewing access on their own batches.
- Restricts `annotations_insert_authorized`, `annotations_update_creator`, `soft_delete_annotation(uuid)`, `restore_annotation(uuid)`, and `batch_images_update_completion_authorized` to `reviewer` and `admin` users while preserving creator-only ownership rules on annotations.

