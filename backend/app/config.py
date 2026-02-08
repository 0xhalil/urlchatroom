from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "URLChatroom API"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/urlchatroom"
    cors_allow_origins: str = "*"
    auth_secret: str = "change-this-in-production"
    access_token_ttl_seconds: int = 604800
    magic_link_ttl_minutes: int = 15
    magic_link_base_url: str = "http://localhost:8000/auth/magic"
    google_client_id: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False


settings = Settings()
