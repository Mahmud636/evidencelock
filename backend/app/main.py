from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.openapi.utils import get_openapi
from contextlib import asynccontextmanager
import logging
from app.config import settings
from app.database import engine, Base
from app.middleware.auth import auth_middleware

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting EvidenceLock application...")
    if settings.ENVIRONMENT == "development":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables created/verified")
    yield
    logger.info("Shutting down EvidenceLock application...")


app = FastAPI(
    title="EvidenceLock API",
    description="Digital Evidence Integrity & Chain-of-Custody System",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url="/api/redoc" if settings.DEBUG else None,
)


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title="EvidenceLock API",
        version="1.0.0",
        description="Digital Evidence Integrity & Chain-of-Custody System",
        routes=app.routes,
    )
    openapi_schema["components"]["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Enter your JWT access token",
        }
    }
    for path in openapi_schema["paths"]:
        for method in openapi_schema["paths"][path]:
            if method in ("get", "post", "put", "delete", "patch"):
                openapi_schema["paths"][path][method]["security"] = [{"BearerAuth": []}]
    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"] if settings.DEBUG else ["localhost", "127.0.0.1"],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(auth_middleware)


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "environment": settings.ENVIRONMENT, "version": "1.0.0"}


@app.get("/api/")
async def root():
    return {
        "name": "EvidenceLock API",
        "version": "1.0.0",
        "documentation": "/api/docs" if settings.DEBUG else None,
        "status": "operational",
    }


from app.api.v1 import (
    auth, cases, evidence, dashboard, reports, users, audit, custody,
    access_requests, field,
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
app.include_router(cases.router, prefix="/api/v1/cases", tags=["Cases"])
app.include_router(evidence.router, prefix="/api/v1/evidence", tags=["Evidence"])
app.include_router(dashboard.router, prefix="/api/v1/dashboard", tags=["Dashboard"])
app.include_router(reports.router, prefix="/api/v1/reports", tags=["Reports"])
app.include_router(audit.router, prefix="/api/v1/audit", tags=["Audit"])
app.include_router(custody.router, prefix="/api/v1/custody", tags=["Custody"])
app.include_router(
    access_requests.router,
    prefix="/api/v1/access-requests",
    tags=["Access Requests"],
)
app.include_router(field.router, prefix="/api/v1/field", tags=["Field Collection"])


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Uncaught exception: {exc}", exc_info=True)
    return {
        "status": "error",
        "message": "An internal error occurred",
        "detail": str(exc) if settings.DEBUG else None,
    }