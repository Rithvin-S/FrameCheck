# FrameCheck

FrameCheck is a desktop-first collaborative image review web application built with React, Vite, and Supabase (Auth, PostgreSQL, Storage, and Realtime), targeting Vercel for hosting.

## Current Status (Phase 2)

Phase 1 and Phase 2 implement Supabase authentication, `profiles` with role-based access (`uploader`, `reviewer`, `admin`), Admin user/role management, batch management (`batches`, `batch_images`), multi-file and folder image uploads (`JPG`/`JPEG`/`PNG`/`WEBP`) to private Supabase Storage (`framecheck-images`), and a basic horizontal-filmstrip batch image viewer.

Review workspace zoom/pan, circular annotations, real-time collaboration, and PDF reporting belong to later phases.

## Local Development

### Prerequisites

- Node.js (LTS recommended) and npm
- A Supabase project

### Setup & Run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure environment variables by copying `.env.example` to `.env` and filling in your Supabase project URL and publishable/anon key:

   ```bash
   cp .env.example .env
   ```

3. Apply the SQL migrations in `supabase/migrations/` in order (`001_phase1_auth_profiles.sql`, then `002_phase2_batches_and_images.sql`) via the Supabase SQL Editor (see `supabase/README.md` for initial Admin provisioning and private Storage policy verification).

4. Start the Vite development server:

   ```bash
   npm run dev
   ```

### Other Scripts

- `npm run build` — Build production static assets into `dist/`
- `npm run preview` — Preview the production build locally

## Project Structure

```text
src/
├── components/   # Header, ProtectedRoute, PublicOnlyRoute, FileDropSelector, ThumbnailFilmstrip, ImagePreview
├── context/      # AuthContext session and profile state
├── pages/        # LoginPage, RegisterPage, DashboardPage, CreateBatchPage, BatchDetailPage, AdminUsersPage
├── services/     # Supabase config/client, authService, profileService, batchService, imageUploadService
├── styles/       # Light-theme design tokens and global styles
├── App.jsx       # Root application shell & route definitions
└── main.jsx      # React entry point

supabase/
├── migrations/   # PostgreSQL schema, triggers, RLS policies, Admin RPCs, and Storage policies
└── README.md     # SQL setup, Admin promotion, and Storage configuration steps
```
