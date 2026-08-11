from fastapi import FastAPI
from pydantic import BaseModel

from veodyn_api.errors import register_error_handlers


class Health(BaseModel):
    status: str


def create_app() -> FastAPI:
    app = FastAPI(title="veodyn-api", version="0.1.0")
    register_error_handlers(app)

    @app.get("/health", response_model=Health, tags=["meta"])
    def health() -> Health:
        # Liveness only: no auth, no database round trip. A probe that touches
        # Postgres turns a slow database into a restart loop.
        return Health(status="ok")

    _register_routers(app)
    return app


def _register_routers(app: FastAPI) -> None:
    """Mount whatever registered itself, in registration order.

    Two steps, and the order between them is the contract: the built-in routers
    register when `veodyn_api.routers` is imported, and a pack registers when
    the extras setting names its module, so a pack is always mounted after the
    built-ins it may be extending.

    Imported inside the function rather than at module scope, because importing
    the routers package is what pulls in the whole service, and this module is
    also the one `openapi.py` and every test import first.
    """
    from veodyn_api.extras import load_registrations
    from veodyn_api.registry import routers
    from veodyn_api.settings import get_settings

    load_registrations(get_settings().extra_modules)
    for router in routers():
        app.include_router(router)


app = create_app()
