# FileMind — Phase 2 (Functional File Manager)

Full-stack monorepo: `backend/` (FastAPI) + `frontend/` (React + Vite).

## Prerequisites
- Python 3.12+, Node 20+, Git, VS Code
- PostgreSQL via `docker compose up -d` (optional; SQLite fallback is default)

## Backend
```powershell
cd backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000
# health: http://localhost:8000/api/health
pytest
```

Migrations are the schema strategy (Alembic) — app code never calls `create_all`.
New migration: `alembic/versions/*_phase2_auth_and_file_manager.py`
(users, folders, categories, tags, files, file_tags).

## Frontend
```powershell
cd frontend
npm install
npm run dev
# http://localhost:5173
```

## Phase 2 — what works
- **Auth**: register / login / me (bcrypt passwords, JWT bearer). Every
  library endpoint is per-user; foreign ids return 404 (no enumeration).
- **Folders**: create, rename, move (cycle-safe), trash/restore (cascades to
  subfolders + files), permanent delete only with `?permanent=true` on empty
  folders. Breadcrumb path endpoint included.
- **Files**: multipart upload (size cap from `MAX_UPLOAD_MB`, executables
  rejected with 415), download (attachment), inline preview for
  images / PDF / text-code (others 415), rename / move / favorite /
  description / tags / category correction.
- **Organization**: 8 system categories seeded at startup (read-only) + custom
  categories; per-user tags; rule-based category suggestion reported as
  `suggestion_source: "rule"` (correctable — learned suggestions land in Phase 5).
- **Search**: filename, description, MIME prefix, category, tag, favorite,
  created-date range, trashed/duplicates filters, sorting, pagination.
- **Duplicates**: SHA-256 grouping (`GET /api/files/duplicates` + counts on
  every file). Copies keep separate blobs — deleting one never affects others.
- **Trash**: soft-delete everywhere; restore; permanent delete is explicit and
  removes the stored bytes too.
- **UI**: Sign in/Register, My Files (browse / duplicates / trash views,
  upload, filters, detail editor, preview modal, confirm dialogs).

## Security notes
- Passwords hashed with bcrypt; JWT secret via `JWT_SECRET_KEY` (set it in `.env`).
- SQLite FK enforcement (`PRAGMA foreign_keys=ON`) so `ON DELETE` actions hold.
- Uploads stream to disk with a size cap; stored under
  `STORAGE_DIR/<owner_id>/<uuid-hex>` — client filenames never touch the
  filesystem (no path traversal, no overwrites).
- Downloads served as `attachment`; previews as `text/plain` (never HTML) or
  inline image/PDF with `nosniff`. Uploaded files are never executed.
- External AI is disabled by default (`AI_PROCESSING_ENABLED=false`); Phase 2
  suggestions are a local extension map, so no document bytes leave the server.

## Known limitations (to be addressed later)
- No refresh tokens / password reset yet; single JWT lifetime (`JWT_EXPIRE_MINUTES`).
- No full-text content indexing or semantic search (Phase 5).
- No goal/activity system yet (Phase 3); dashboard metrics still placeholder.
- Folder permanent delete requires the folder to be empty (no recursive wipe).
