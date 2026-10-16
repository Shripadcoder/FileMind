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


settings = Settings()
