from redash.models import db
from tests import BaseTestCase


class TestQueryListOrderByLastChange(BaseTestCase):
    def test_lists_the_most_recently_edited_query_first(self):
        edited = self.factory.create_query(name="created first")
        untouched = self.factory.create_query(name="created second")
        edited.name = "created first, edited later"
        db.session.add(edited)
        db.session.commit()

        rv = self.make_request("get", "/api/queries?order=-updated_at")

        assert [query["id"] for query in rv.json["results"]] == [edited.id, untouched.id]
