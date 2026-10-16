from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Single source for backend configuration. All secrets come from env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "FileMind API"
    database_url: str = "sqlite:///./filemind_dev.db"
    secret_key: str = "change-me-in-local-env-only"
    jwt_secret_key: str = "change-me-in-local-env-only"
    jwt_expire_minutes: int = 60 * 24
    storage_dir: str = "./storage"
    max_upload_mb: int = 50
    # External AI (embeddings/LLM) is opt-in. Default off so private
    # documents are never sent anywhere without explicit user consent.
    ai_processing_enabled: bool = False
    # OpenAI-compatible endpoint for the optional external providers.
    # Empty base URL/key means "no external provider configured".
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    embedding_model: str = "tfidf-local"
    extraction_max_chars: int = 200_000
    semantic_default_limit: int = 10


settings = Settings()
