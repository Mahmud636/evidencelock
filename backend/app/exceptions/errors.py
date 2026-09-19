"""Custom exception classes for the application."""

from typing import Optional, Any


class AppException(Exception):
    """Base application exception."""
    
    def __init__(
        self,
        message: str = "An error occurred",
        status_code: int = 500,
        details: Optional[Any] = None,
    ):
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


class AuthenticationError(AppException):
    """Authentication related errors."""
    
    def __init__(self, message: str = "Authentication failed", details: Optional[Any] = None):
        super().__init__(message=message, status_code=401, details=details)


class AuthorizationError(AppException):
    """Authorization related errors."""
    
    def __init__(self, message: str = "Insufficient permissions", details: Optional[Any] = None):
        super().__init__(message=message, status_code=403, details=details)


class NotFoundError(AppException):
    """Resource not found errors."""
    
    def __init__(self, message: str = "Resource not found", details: Optional[Any] = None):
        super().__init__(message=message, status_code=404, details=details)


class ValidationError(AppException):
    """Request validation errors."""
    
    def __init__(self, message: str = "Validation failed", details: Optional[Any] = None):
        super().__init__(message=message, status_code=400, details=details)


class ConflictError(AppException):
    """Resource conflict errors (e.g., duplicate)."""
    
    def __init__(self, message: str = "Resource conflict", details: Optional[Any] = None):
        super().__init__(message=message, status_code=409, details=details)


class RateLimitError(AppException):
    """Rate limit exceeded errors."""
    
    def __init__(self, message: str = "Rate limit exceeded", details: Optional[Any] = None):
        super().__init__(message=message, status_code=429, details=details)


class DatabaseError(AppException):
    """Database related errors."""
    
    def __init__(self, message: str = "Database error", details: Optional[Any] = None):
        super().__init__(message=message, status_code=500, details=details)