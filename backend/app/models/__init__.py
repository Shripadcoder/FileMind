"""Import every model so Base.metadata covers the full schema (Alembic)."""

from app.models.file import File, file_tags  # noqa: F401
from app.models.folder import Folder  # noqa: F401
from app.models.taxonomy import Category, Tag  # noqa: F401
from app.models.user import User  # noqa: F401
