"""Security utilities for authentication, encryption, and hashing."""

import os
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
import secrets
import hashlib

from passlib.context import CryptContext
from jose import JWTError, jwt
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.config import settings

# Password hashing context using Argon2id
pwd_context = CryptContext(
    schemes=["argon2"],
    default="argon2",
    argon2__memory_cost=65536,
    argon2__time_cost=3,
    argon2__parallelism=4,
)

# Fernet key for encryption (derived from ENCRYPTION_KEY)
def get_fernet_key() -> bytes:
    """Derive Fernet key from encryption key."""
    key = settings.ENCRYPTION_KEY.encode()
    salt = b"evidencelock_salt_2026"  # Fixed salt for consistency
    
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    return base64.urlsafe_b64encode(kdf.derive(key))


# Create Fernet instance for encryption
fernet = Fernet(get_fernet_key())


def hash_password(password: str) -> str:
    """
    Hash a password using Argon2id.
    
    Args:
        password: Plain text password
        
    Returns:
        Hashed password string
    """
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against its hash.
    
    Args:
        plain_password: Plain text password to verify
        hashed_password: Stored password hash
        
    Returns:
        True if password matches, False otherwise
    """
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create JWT access token.
    
    Args:
        data: Data to encode in token
        expires_delta: Optional custom expiry time
        
    Returns:
        JWT token string
    """
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    """
    Create JWT refresh token.
    
    Args:
        data: Data to encode in token
        
    Returns:
        JWT refresh token string
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """
    Decode and validate JWT token.
    
    Args:
        token: JWT token string
        
    Returns:
        Decoded token data or None if invalid
    """
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None


def get_password_hash(password: str) -> str:
    """Alias for hash_password."""
    return hash_password(password)


def generate_secure_random(length: int = 32) -> str:
    """
    Generate cryptographically secure random string.
    
    Args:
        length: Length of random string
        
    Returns:
        URL-safe base64 encoded random string
    """
    return secrets.token_urlsafe(length)


def encrypt_data(data: str) -> str:
    """
    Encrypt data using AES-256-GCM via Fernet.
    
    Args:
        data: String data to encrypt
        
    Returns:
        Encrypted data as string
    """
    return fernet.encrypt(data.encode()).decode()


def decrypt_data(encrypted_data: str) -> str:
    """
    Decrypt data using AES-256-GCM via Fernet.
    
    Args:
        encrypted_data: Encrypted data string
        
    Returns:
        Decrypted string
    """
    return fernet.decrypt(encrypted_data.encode()).decode()


def generate_totp_secret() -> str:
    """
    Generate TOTP secret for MFA.
    
    Returns:
        Base32 encoded TOTP secret
    """
    # Generate 20 bytes of random data (160 bits)
    secret_bytes = secrets.token_bytes(20)
    # Encode as base32 for TOTP compatibility
    return base64.b32encode(secret_bytes).decode().replace("=", "")


def generate_recovery_codes(count: int = 10, length: int = 8) -> list[str]:
    """
    Generate recovery codes for MFA backup.
    
    Args:
        count: Number of recovery codes to generate
        length: Length of each recovery code
        
    Returns:
        List of recovery codes
    """
    codes = []
    for _ in range(count):
        # Generate a code with alphanumeric characters
        code = secrets.token_urlsafe(length).replace("-", "").replace("_", "")[:length]
        codes.append(code.upper())
    return codes


def hash_recovery_code(code: str) -> str:
    """
    Hash a recovery code for storage.
    
    Args:
        code: Recovery code to hash
        
    Returns:
        SHA-256 hash of the code
    """
    return hashlib.sha256(code.encode()).hexdigest()