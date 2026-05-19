from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import api_router

# HTTP API：``/health`` 根级；业务接口见 ``api_router``（``/api/v1``，子路由见 ``app.routes``）。
app = FastAPI(title="EasyAnnotate API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
