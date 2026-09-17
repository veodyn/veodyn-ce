from veodyn_api.schemas.catalog import CamelModel


class StaticEntityOut(CamelModel):
    kind: str
    id: str
    label: str


class StaticEntitiesOut(CamelModel):
    feed_version: str
    entities: list[StaticEntityOut]
