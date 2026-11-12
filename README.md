# FrameCheck

FrameCheck is a desktop-first collaborative image review web application built with **React**, **Vite**, **Supabase** (Auth, PostgreSQL, Storage, and Realtime), and **jsPDF**, prepared for frontend hosting on **Vercel** *(awaiting deployment)*.

---

## Implemented Capabilities

### 1. Authentication & Role-Based Access
- **Roles:** `Admin`, `Reviewer`, and `Uploader`.
- **Self-Registration Guard:** New sign-ups via `/register` are always assigned the `uploader` role server-side by the `handle_new_user()` PostgreSQL trigger (client role selection is not permitted).
- **Admin User & Role Management:** Administrators can list users and update roles on `/admin/users` via secure RPCs (`admin_list_users`, `admin_update_user_role`) with self-modification protection and a last-Admin safeguard.

### 2. Batch & Image Management
- **Multi-Image & Folder Uploads:** Upload multiple files or nested folders with client-side magic-byte inspection, duplicate-filename warnings, and per-file retry support.
- **Supported Formats:** `JPG`, `JPEG`, `PNG`, and `WEBP` (50 MB per-file limit).
- **Private Supabase Storage:** Original files are stored in the private `framecheck-images` bucket under `{owner_id}/{batch_id}/{image_uuid}.{ext}` with no client `UPDATE` or `DELETE` policies so uploaded originals cannot be overwritten or removed.
- **Ownership & Visibility:** Uploaders can create batches, upload images to their own batches, and view only their own batches. Reviewers and Admins can view all batches across the workspace.

### 3. Image Review Workspace
- **Horizontal Filmstrip & Preview:** Lazy-loaded thumbnail strip (`IntersectionObserver`) with completion badges (`✓`) and Previous/Next navigation.
- **Circle Annotations:** Draw normalized circle annotations (`cx`, `cy`, `r`) over images with monotonic **per-image sequential numbering** starting at `#1` (numbers are never reused after deletion).
- **Editing & Comments:** Move, 4-handle resize, recolor, edit comments, soft-delete, and toggle `Open` / `Resolved` states with `All`, `Open`, and `Resolved` sidebar filters.
- **Undo / Redo:** Per-image command-based undo/redo history synchronized with PostgreSQL (`CREATE`, `GEOMETRY`, `COLOR`, and `DELETE` / `restore_annotation`).

### 4. Collaborative Review & Permission Enforcement
- **Supabase Realtime Sync:** Live `postgres_changes` synchronization across active viewers for annotation inserts, edits, status changes, soft-delete tombstones (`annotation_deletion_events`), and image completion updates, with automatic reconnect resync that preserves local undo/redo history.
- **Creator-Only Modifications:** Only an annotation's creator (`created_by = auth.uid()`) can move, resize, recolor, edit, resolve, reopen, soft-delete, or restore it.
- **Uploader Read-Only Enforcement:** Uploaders can monitor annotations, comments, reviewer names, timestamps, and review progress in read-only mode on their own batches. Annotation drawing, selection, editing, deleting, resolving, and image completion controls are disabled/hidden in the UI and blocked server-side by RLS and RPCs.

### 5. Review Completion & Status Tracking
- **Batch Review Statuses:** Displayed on the Dashboard and Review Workspace header as `Not Started`, `In Review`, or `Review Completed`.
- **Manual Image Completion:** Reviewers and Admins can toggle each image between `In Review` and `Completed`.
- **Completion Rule:** A batch transitions to `Review Completed` only when it contains at least one image, **every** image is manually marked `Completed`, and **zero** open annotations remain across the entire batch.

### 6. PDF Reporting
- **Individual Image Report:** Downloads an A4 PDF containing batch metadata, image filename and completion status, the clean original image from private Storage, total annotation count, and all active (`Open` and `Resolved`) annotation details (number, comment, reviewer name, status, and created/updated/resolved timestamps).
- **Combined Batch Report:** Downloads an A4 PDF with batch summary metrics, overall batch status, an image index, and sequential per-image sections with clean original images, annotations, page headers, and `Page X of Y` footers.
- **Progress & Lazy Loading:** Displays live `Generating PDF (X/Y)…` progress after each processed image while streaming Storage images sequentially, and dynamically imports `jsPDF` only when a report is requested.

---

## Technology Stack

- **Frontend:** React 19, Vite 8, React Router (`react-router-dom`)
- **Backend / BaaS:** Supabase (`@supabase/supabase-js`) — Auth, PostgreSQL (RLS, Triggers, RPCs), Private Storage, and Realtime
- **PDF Generation:** `jsPDF` (lazy-loaded client-side)
- **Intended Hosting:** Vercel (frontend static SPA; awaiting deployment)

---

## Local Setup Instructions

### Prerequisites
- **Node.js** (LTS recommended) and **npm**
- A **Supabase** project

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and populate your Supabase project values:

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_ANON_KEY=your-supabase-publishable-or-anon-key
```

### 3. Apply Supabase SQL Migrations (In Order)

Open **Supabase Dashboard → SQL Editor → New query** and execute each migration file in `supabase/migrations/` in exact numeric order:

1. `001_phase1_auth_profiles.sql` — `profiles` table, signup trigger (`uploader` default), column protection, Admin RPCs
2. `002_phase2_batches_and_images.sql` — `batches`, `batch_images`, `is_reviewer_or_admin()`, private bucket `framecheck-images`, Storage RLS
3. `003_phase5_annotations.sql` — `annotations`, `can_view_batch_image()`, monotonic per-image numbering, soft-delete/restore RPCs
4. `004_review_status.sql` — `batch_images` completion columns/trigger and `list_dashboard_batches()` RPC
5. `005_phase7_realtime.sql` — `annotation_deletion_events` tombstone log, trigger, and `supabase_realtime` publication
6. `006_fix_uploader_review_permissions.sql` — `can_review_batch_image()` and database-level Uploader restrictions on annotations, RPCs, and image completion

### 4. Verify Supabase Dashboard Configuration

Detailed verification steps are documented in [supabase/README.md](supabase/README.md):
- **Initial Admin User:** Promote your first registered account to `admin` once via SQL Editor (see `supabase/README.md`).
- **Private Storage:** Confirm bucket `framecheck-images` is marked **Private** (`public = false`) and that `framecheck_images_select_authorized` (`SELECT`) and `framecheck_images_insert_owner_or_admin` (`INSERT`) exist under **Storage → Policies**.
- **Realtime:** Confirm `public.annotations`, `public.annotation_deletion_events`, and `public.batch_images` are included in the `supabase_realtime` publication.

### 5. Run Locally & Build

```bash
# Start development server
npm run dev

# Build production bundle into dist/
npm run build

# Preview production build locally
npm run preview
```

### 6. Deployment Preparation (Vercel)

FrameCheck is not yet deployed. To prepare a Vercel deployment:
- Configure **Build Command** as `npm run build` and **Output Directory** as `dist`.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel project Environment Variables.
- Ensure client-side SPA routing rewrites all non-asset routes to `/index.html` for deep links (e.g., `/batches/:batchId/review`, `/admin/users`).
- Add your Vercel domain to **Supabase → Authentication → URL Configuration** (`Site URL` and `Redirect URLs`).

---

## Project Structure

```text
├── .env.example                                  # Template for public Vite Supabase env vars
├── index.html                                    # HTML entry document
├── package.json                                  # Project metadata, scripts, and dependencies
├── vite.config.js                                # Vite configuration
├── src/
│   ├── components/
│   │   ├── AnnotationLayer.jsx / .css            # Interactive normalized SVG circle overlay & read-only guard
│   │   ├── AnnotationToolbar.jsx / .css          # Mode, color swatch, undo/redo, delete, & read-only strip
│   │   ├── FileDropSelector.jsx / .css           # Multi-file & folder drag/drop selector
│   │   ├── Header.jsx / .css                     # App navigation bar & role badge
│   │   ├── ImagePreview.jsx / .css               # Main image canvas container & navigation
│   │   ├── ProtectedRoute.jsx                    # Auth, profile, & role-guarded routing
│   │   ├── PublicOnlyRoute.jsx                   # Redirects signed-in users away from auth routes
│   │   ├── ReviewHeader.jsx / .css               # Workspace header with batch review status badge
│   │   ├── ReviewSidebar.jsx / .css              # Draft composer, All/Open/Resolved tabs, & comment cards
│   │   ├── ThumbnailFilmstrip.jsx / .css         # Lazy-loaded horizontal filmstrip with completion badges
│   │   └── StatusViews.css                       # Shared loading & error state styles
│   ├── context/
│   │   └── AuthContext.jsx                       # Supabase session/profile state & cache cleanup on sign-out
│   ├── pages/
│   │   ├── AdminUsersPage.jsx / .css             # Admin user & role management UI
│   │   ├── AuthPages.css                         # Login & registration form styling
│   │   ├── BatchDetailPage.jsx / .css            # Batch overview, image append upload, & batch PDF export
│   │   ├── CreateBatchPage.jsx / .css            # New batch creation & multi-image/folder upload
│   │   ├── DashboardPage.jsx / .css              # Role-filtered batch table with live review status
│   │   ├── LoginPage.jsx                         # Email/password sign-in
│   │   ├── RegisterPage.jsx                      # User registration (Uploader role assigned server-side)
│   │   └── ReviewWorkspacePage.jsx / .css        # Full review workspace, realtime sync, & image PDF export
│   ├── services/
│   │   ├── annotationService.js                  # Annotation CRUD, soft-delete/restore RPCs, & Realtime
│   │   ├── annotationState.js                    # Normalized geometry helpers & per-image undo/redo reducer
│   │   ├── authService.js                        # Supabase Auth wrappers
│   │   ├── batchPdfReportService.js              # Combined batch PDF generation with progress reporting
│   │   ├── batchService.js                       # Batch queries, image completion, & review status derivation
│   │   ├── imagePdfReportService.js              # Single-image PDF review report generation
│   │   ├── imageUploadService.js                 # File validation, Storage upload, & signed URL cache
│   │   ├── pdfReportHelpers.js                   # Shared A4 layout helpers, image streaming, & lazy jsPDF loader
│   │   ├── profileService.js                     # Role constants, profile fetch, & Admin RPC calls
│   │   ├── supabaseClient.js                     # Singleton Supabase JS client
│   │   └── supabaseConfig.js                     # Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
│   ├── styles/
│   │   ├── global.css                            # Global resets & shared button/alert classes
│   │   └── tokens.css                            # Light-theme CSS design tokens
│   ├── App.jsx / .css                            # Root router & application shell
│   └── main.jsx                                  # React DOM entry point
└── supabase/
    ├── migrations/
    │   ├── 001_phase1_auth_profiles.sql
    │   ├── 002_phase2_batches_and_images.sql
    │   ├── 003_phase5_annotations.sql
    │   ├── 004_review_status.sql
    │   ├── 005_phase7_realtime.sql
    │   └── 006_fix_uploader_review_permissions.sql
    └── README.md                                 # Supabase setup & verification checklist
```

---

## Security Notes

- **Protect Secrets:** Never commit `.env`, `.env.*` files (ignored via `.gitignore`), database passwords, or Supabase `service_role` keys to version control or client code.
- **Client Key Scope:** The React frontend uses only `VITE_SUPABASE_URL` and the public `VITE_SUPABASE_ANON_KEY`. All security boundaries are enforced in PostgreSQL via RLS policies, column-scoped `GRANT`s, triggers, and `SECURITY DEFINER` RPCs.
- **Role & Write Isolation:** Uploaders cannot promote themselves, inspect other users' batches, create/modify/delete annotations, or alter image completion status—even through direct REST or RPC calls (enforced by migration `006`). Reviewers cannot edit, resolve, or delete annotations created by other reviewers.
- **Private Storage Access:** Images in `framecheck-images` are accessible only to authorized batch owners, Reviewers, and Admins via path-checked RLS policies, short-lived signed URLs for previews, and authenticated blob downloads for PDF generation. Signed URL caches are cleared on explicit sign-out, session expiration, and cross-tab sign-out.
