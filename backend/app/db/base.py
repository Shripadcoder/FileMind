from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base. Phase 1 has no tables; domain models land in Phase 2/3."""

    pass
