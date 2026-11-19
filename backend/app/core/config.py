from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    Never hardcode credentials or service-role secrets here.
    """

    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = Field(default="development")
    app_name: str = Field(default="VisionX AI API")
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)
    log_level: str = Field(default="INFO")
    cors_origins: str = Field(default="http://localhost:3000")

    database_url: str = Field(default="")
    supabase_url: str = Field(default="")
    supabase_anon_key: str = Field(default="")
    supabase_service_role_key: str = Field(default="")
    supabase_jwt_secret: str = Field(default="")

    object_storage_driver: str = Field(default="local")
    object_storage_local_dir: str = Field(default="./storage")

    @field_validator("app_env")
    @classmethod
    def validate_env(cls, value: str) -> str:
        allowed = {"development", "test", "staging", "production"}
        normalized = value.strip().lower()
        if normalized not in allowed:
            raise ValueError(f"APP_ENV must be one of {sorted(allowed)}")
        return normalized

    @property
    def cors_origin_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def supabase_configured(self) -> bool:
        return bool(
            self.supabase_url
            and "YOUR_PROJECT_REF" not in self.supabase_url
            and (self.supabase_jwt_secret or self.supabase_url.startswith("https://"))
        )

    @property
    def database_configured(self) -> bool:
        return bool(
            self.database_url
            and "YOUR_DB_PASSWORD" not in self.database_url
            and "YOUR_PROJECT_REF" not in self.database_url
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
