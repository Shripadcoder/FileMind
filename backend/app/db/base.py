from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base. Domain models are imported in app.models so that
    Alembic autogenerate sees them. Never call create_all() in app code."""

    pass
