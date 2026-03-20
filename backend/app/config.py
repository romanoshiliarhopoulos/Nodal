from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "development"
    skip_auth: bool = False

    # Firebase
    firebase_service_account_path: str = "service-account.json"

    # LiteLLM
    default_model: str = "groq/llama-3.3-70b-versatile"
    groq_api_key: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    # Session cookie (anonymous users)
    session_cookie_name: str = "nodal_session"
    session_max_age: int = 60 * 60 * 24 * 365  # 1 year

    # GCP / Secret Manager (production)
    gcp_project: str = ""
    secret_manager_key_name: str = "nodal-encryption-master-key"

    # Local dev encryption fallback (base64-encoded 32 random bytes)
    # Generate: python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
    master_key_dev: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
