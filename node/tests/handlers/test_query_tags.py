from tests import BaseTestCase


class TestQueryTagsResourceGet(BaseTestCase):
    def test_counts_tags_only_on_queries_the_user_can_list(self):
        self.factory.create_query(tags=["shared"])
        self.factory.create_query(tags=["mine"], is_draft=True)
        someone_else = self.factory.create_user()
        self.factory.create_query(tags=["shared", "their-draft"], is_draft=True, user=someone_else)

        rv = self.make_request("get", "/api/queries/tags")

        assert {tag["name"]: tag["count"] for tag in rv.json["tags"]} == {"shared": 1, "mine": 1}
