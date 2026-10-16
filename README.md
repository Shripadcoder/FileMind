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

## Phase 2 — file manager
- Auth (bcrypt + JWT, per-user 404s), folders (move/trash-cascade/explicit
  permanent delete), file upload/download/preview, 8 system + custom categories,
  tags, SHA-256 duplicates, trash/recovery, metadata search.

## Phase 3 — goals & activity
- **Goals**: 6 types (course, assignment, coding, project, reading, custom) with
  per-type progress derivation (tasks / milestones / manual target+unit) and
  pace-based health (on track / behind / at risk / overdue / completed / on hold).
  Fields: category, priority, status, start/target dates, notes, external links,
  reminder. `GET /api/goal-types` documents the defaults.
- **Tasks & milestones**: CRUD nested under goals; completing either (or a goal,
  or a progress change) writes an auto `Activity` row alongside the mutation.
- **Activities**: fixed type vocabulary, manual logging with value + date +
  optional goal link, filters, delete. Goal deletion preserves history
  (goal_id nulled explicitly, never relying on DB-specific cascades).
- File uploads auto-log `file_uploaded` with the real file id.
- **Dashboard**: `GET /api/dashboard/summary` aggregates active/completed,
  overdue + upcoming + today's tasks, reminders, progress by category/type,
  weekly series, 90-day calendar, course/coding/project spotlights, recent
  files and activities — all from live rows, category/date-range filterable.
- **UI**: Goals (filters, create, detail editor, tasks/milestones, links,
  history), Activity (log form, filters, feed), Dashboard (stat cards, today's
  + overdue, recharts weekly bar, category bars, spotlights, heatmap).

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
- Goals ↔ files linking (related-file attachments) lands in Phase 4.
- Folder permanent delete requires the folder to be empty (no recursive wipe).
- No goal reminders delivery yet (reminder_at stored + surfaced; no email/push).
- Frontend bundle grew with recharts (~630 KB) — code-split in a later pass.
