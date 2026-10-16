from datetime import datetime

from pydantic import BaseModel, Field


class ExtractOut(BaseModel):
    file_id: int
    extracted: bool
    method: str | None = None
    char_count: int = 0
    reason: str | None = None


class ContentOut(BaseModel):
    file_id: int
    filename: str
    method: str
    char_count: int
    page_refs: list[dict]
    text: str
    extracted_at: datetime


class SummaryOut(BaseModel):
    file_id: int
    summary: str
    source: str
    sentence_count: int


class SuggestOut(BaseModel):
    file_id: int
    current_category: str | None
    suggested_category: str | None = None
    confidence: float | None = None
    suggested_tags: list[str] = Field(default_factory=list)
    novel_tags: list[str] = Field(default_factory=list)
    source: str


class SemanticHit(BaseModel):
    file_id: int
    filename: str
    category_name: str | None = None
    score: float
    snippet: str


class SemanticSearchIn(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=50)
    folder_id: int | None = None


class SemanticSearchOut(BaseModel):
    query: str
    engine: str
    hits: list[SemanticHit]


class Citation(BaseModel):
    file_id: int
    filename: str
    page: int | None = None
    chunk: int
    score: float


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    file_ids: list[int] | None = None
    top_k: int = Field(default=5, ge=1, le=10)


class AskOut(BaseModel):
    question: str
    answer: str
    citations: list[Citation]
    source: str
    engine: str


class AssistantIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


class AssistantOut(BaseModel):
    question: str
    intent: str
    answer: str
    facts: list[str]
    suggestions: list[str]
    source: str


class AIStatusOut(BaseModel):
    local_engine: str
    extraction_methods: list[str]
    ai_processing_enabled: bool
    provider_configured: bool
    external_allowed_for_user: bool
    embedding_model: str
    llm_model: str


class SettingsOut(BaseModel):
    ai_consent_external: bool
    ai_processing_enabled: bool
    provider_configured: bool


class SettingsUpdate(BaseModel):
    ai_consent_external: bool
