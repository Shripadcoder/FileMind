# FileMind — Phase 1 (Foundation)

Full-stack monorepo: `backend/` (FastAPI) + `frontend/` (React + Vite).

## Prerequisites
- Python 3.12+, Node 20+, Git, VS Code
- PostgreSQL via `docker compose up -d` (optional for Phase 1; SQLite fallback is default)

## Backend
```powershell
cd backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
# health: http://localhost:8000/api/health
pytest
```

Migrations (no tables yet in Phase 1; strategy is Alembic, not `create_all`):
```powershell
alembic upgrade head
alembic revision --autogenerate -m "describe change"
```

## Frontend
```powershell
cd frontend
npm install
npm run dev
# http://localhost:5173
```

## Security notes (initial)
- SQLite default has no auth layer yet; auth + per-user authorization land before file binaries are stored (Phase 2).
- Secrets only via `.env` (see `backend/.env.example`); never committed.
- External AI is disabled by default (`AI_PROCESSING_ENABLED=false`).
