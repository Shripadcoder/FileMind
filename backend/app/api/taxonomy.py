from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.models.file import File
from app.models.taxonomy import Category, Tag
from app.models.user import User
from app.db.session import get_db
from app.schemas.library import CategoryCreate, CategoryOut, CategoryUpdate, TagCreate, TagOut

router = APIRouter(tags=["taxonomy"])


def _clean(value: str, limit: str = "name") -> str:
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        raise HTTPException(status_code=422, detail="Name must not be empty")
    return cleaned


# ---------- Categories ----------


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(
    db: Session = Depends(get_db), current: User = Depends(get_current_user)
):
    rows = db.execute(
        select(Category)
        .where(or_(Category.is_system.is_(True), Category.owner_id == current.id))
        .order_by(Category.is_system.desc(), Category.name)
    ).scalars()
    return [CategoryOut(id=c.id, name=c.name, is_system=c.is_system) for c in rows]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    body: CategoryCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    name = _clean(body.name)
    clash = db.execute(
        select(Category).where(
            or_(Category.is_system.is_(True), Category.owner_id == current.id),
            Category.name == name,
        )
    ).scalar_one_or_none()
    if clash is not None:
        raise HTTPException(status_code=409, detail="This category already exists")
    category = Category(owner_id=current.id, name=name, is_system=False)
    db.add(category)
    db.commit()
    db.refresh(category)
    return CategoryOut(id=category.id, name=category.name, is_system=False)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def rename_category(
    category_id: int,
    body: CategoryUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    category = db.get(Category, category_id)
    if category is None or (
        category.owner_id != current.id and not category.is_system
    ):
        raise HTTPException(status_code=404, detail="Category not found")
    if category.is_system:
        raise HTTPException(status_code=403, detail="System categories are read-only")
    name = _clean(body.name)
    clash = db.execute(
        select(Category).where(
            or_(Category.is_system.is_(True), Category.owner_id == current.id),
            Category.name == name,
            Category.id != category.id,
        )
    ).scalar_one_or_none()
    if clash is not None:
        raise HTTPException(status_code=409, detail="This category already exists")
    category.name = name
    db.commit()
    db.refresh(category)
    return CategoryOut(id=category.id, name=category.name, is_system=False)


@router.delete("/categories/{category_id}")
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    category = db.get(Category, category_id)
    if category is None or category.owner_id != current.id:
        raise HTTPException(status_code=404, detail="Category not found")
    if category.is_system:
        raise HTTPException(status_code=403, detail="System categories are read-only")
    db.delete(category)  # files referencing it fall back to NULL via FK
    db.commit()
    return {"id": category_id, "deleted": True}


# ---------- Tags ----------


@router.get("/tags", response_model=list[TagOut])
def list_tags(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    rows = db.execute(
        select(Tag).where(Tag.owner_id == current.id).order_by(Tag.name)
    ).scalars()
    return [TagOut(id=t.id, name=t.name) for t in rows]


@router.post("/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(
    body: TagCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    from app.services.library import normalize_tag_name

    name = normalize_tag_name(body.name)
    if not name:
        raise HTTPException(status_code=422, detail="Name must not be empty")
    existing = db.execute(
        select(Tag).where(Tag.owner_id == current.id, Tag.name == name)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This tag already exists")
    tag = Tag(owner_id=current.id, name=name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return TagOut(id=tag.id, name=tag.name)


@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    tag = db.get(Tag, tag_id)
    if tag is None or tag.owner_id != current.id:
        raise HTTPException(status_code=404, detail="Tag not found")
    # Detach from the user's files first so no orphan link rows remain.
    files = db.execute(select(File).where(File.owner_id == current.id)).scalars()
    for file in files:
        if tag in file.tags:
            file.tags.remove(tag)
    db.delete(tag)
    db.commit()
    return {"id": tag_id, "deleted": True}
