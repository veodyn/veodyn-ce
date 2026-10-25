from veodyn_api.routers import ai, ai_chat
from veodyn_api.services import ai_catalog_grounding


def test_generate_sql_and_chat_ground_through_the_catalog_module() -> None:
    assert ai.build_grounding is ai_catalog_grounding.build_grounding
    assert ai_chat.build_grounding is ai_catalog_grounding.build_grounding
