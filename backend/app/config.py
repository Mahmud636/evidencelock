from typing import List
from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str
    DATABASE_SYNC_URL: str

    # Security
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # MFA
    MFA_ISSUER_NAME: str = "EvidenceLock"

    # File Storage
    UPLOAD_DIR: str = "./uploads"
    REPORT_DIR: str = "./reports"
    MAX_UPLOAD_SIZE: int = 104857600  # 100MB

    # Encryption
    ENCRYPTION_KEY: str

    # Environment
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    LOG_LEVEL: str = "DEBUG"

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    # Rate Limiting
    RATE_LIMIT_AUTH: str = "5/minute"
    RATE_LIMIT_UPLOAD: str = "10/hour"
    RATE_LIMIT_DEFAULT: str = "60/minute"

    @field_validator("SECRET_KEY")
    def validate_secret_key(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters")
        return v

    @field_validator("ENCRYPTION_KEY")
    def validate_encryption_key(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("ENCRYPTION_KEY must be at least 32 characters")
        return v

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()