from veodyn_api.schemas.catalog import CamelModel


class EntityNeedsOut(CamelModel):
    query: bool
    static_reference: bool
    column_map: bool


class StandardCapabilityOut(CamelModel):
    standard: str
    versions: list[str]
    entities: list[str]
    entity_needs: dict[str, EntityNeedsOut]
    timezones: list[str]


class FeedCapabilitiesOut(CamelModel):
    standards: list[StandardCapabilityOut]
