import calendar
import datetime
import logging
import numbers
import re
import time

import pytz
from sqlalchemy import UniqueConstraint, and_, cast, distinct, func, or_, text
from sqlalchemy.dialects.postgresql import ARRAY, DOUBLE_PRECISION, JSONB
from sqlalchemy.event import listens_for
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import (
    backref,
    contains_eager,
    joinedload,
    load_only,
    subqueryload,
)
from sqlalchemy.orm.exc import NoResultFound  # noqa: F401
from sqlalchemy_utils import generic_relationship
from sqlalchemy_utils.models import generic_repr
from sqlalchemy_utils.types import TSVectorType
from sqlalchemy_utils.types.encrypted.encrypted_type import FernetEngine

from redash import redis_connection, settings, utils
from redash.destinations import (
    get_configuration_schema_for_destination_type,
    get_destination,
)
from redash.metrics import database  # noqa: F401
from redash.models.base import (
    Column,
    GFKBase,
    SearchBaseQuery,
    db,
    gfk_type,
    key_type,
    primary_key,
)
from redash.models.changes import Change, ChangeTrackingMixin  # noqa
from redash.models.mixins import BelongsToOrgMixin, TimestampMixin
from redash.models.organizations import Organization
from redash.models.parameterized_query import (
    InvalidParameterError,
    ParameterizedQuery,
    QueryDetachedFromDataSourceError,
)
from redash.models.types import (
    Configuration,
    EncryptedConfiguration,
    JSONText,
    MutableDict,
    MutableList,
    json_cast_property,
)
from redash.models.users import (  # noqa
    AccessPermission,
    AnonymousUser,
    ApiUser,
    Group,
    User,
)
from redash.query_runner import (
    TYPE_BOOLEAN,
    TYPE_DATE,
    TYPE_DATETIME,
    BaseQueryRunner,
    get_configuration_schema_for_query_runner_type,
    get_query_runner,
    with_ssh_tunnel,
)
from redash.utils import (
    base_url,
    gen_query_hash,
    generate_token,
    json_dumps,
    json_loads,
    mustache_render,
    mustache_render_escape,
    sentry,
)
from redash.utils.configuration import ConfigurationContainer

logger = logging.getLogger(__name__)


class ScheduledQueriesExecutions:
    KEY_NAME = "sq:executed_at"

    def __init__(self):
        self.executions = {}

    def refresh(self):
        self.executions = redis_connection.hgetall(self.KEY_NAME)

    def update(self, query_id):
        redis_connection.hset(self.KEY_NAME, mapping={query_id: time.time()})

    def get(self, query_id):
        timestamp = self.executions.get(str(query_id))
        if timestamp:
            timestamp = utils.dt_from_timestamp(timestamp)

        return timestamp


scheduled_queries_executions = ScheduledQueriesExecutions()


@generic_repr("id", "name", "type", "org_id", "created_at")
class DataSource(BelongsToOrgMixin, db.Model):
    id = primary_key("DataSource")
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))
    org = db.relationship(Organization, backref="data_sources")

    name = Column(db.String(255))
    type = Column(db.String(255))
    options = Column(
        "encrypted_options",
        ConfigurationContainer.as_mutable(
            EncryptedConfiguration(db.Text, settings.DATASOURCE_SECRET_KEY, FernetEngine)
        ),
    )
    queue_name = Column(db.String(255), default="queries")
    scheduled_queue_name = Column(db.String(255), default="scheduled_queries")
    created_at = Column(db.DateTime(True), default=db.func.now())

    data_source_groups = db.relationship("DataSourceGroup", back_populates="data_source", cascade="all")
    __tablename__ = "data_sources"
    __table_args__ = (
        db.Index("data_sources_org_id_name", "org_id", "name"),
        {"extend_existing": True},
    )

    def __eq__(self, other):
        return self.id == other.id

    def __hash__(self):
        return hash(self.id)

    def to_dict(self, all=False, with_permissions_for=None):
        d = {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "syntax": self.query_runner.syntax,
            "paused": self.paused,
            "pause_reason": self.pause_reason,
            "supports_auto_limit": self.query_runner.supports_auto_limit,
        }

        if all:
            schema = get_configuration_schema_for_query_runner_type(self.type)
            self.options.set_schema(schema)
            d["options"] = self.options.to_dict(mask_secrets=True)
            d["queue_name"] = self.queue_name
            d["scheduled_queue_name"] = self.scheduled_queue_name
            d["groups"] = self.groups

        if with_permissions_for is not None:
            d["view_only"] = (
                db.session.query(DataSourceGroup.view_only)
                .filter(
                    DataSourceGroup.group == with_permissions_for,
                    DataSourceGroup.data_source == self,
                )
                .one()[0]
            )

        return d

    def __str__(self):
        return str(self.name)

    @classmethod
    def create_with_group(cls, *args, **kwargs):
        data_source = cls(*args, **kwargs)
        groups = [data_source.org.default_group]
        # settings.ADDITIONAL_DATA_SOURCE_GROUPS is empty unless a deployment sets it, so
        # this loop does nothing and the behaviour is upstream's. See that setting's own
        # comment for why it exists: without it a data source is reachable only from the
        # default group, and a least-privilege service account cannot be moved out of that
        # group without losing access to every data source created after it was seeded.
        # A name matching no group is skipped rather than raising, because creating a data
        # source must not start failing when an unrelated group is renamed or deleted.
        #
        # Not .first(): groups.name carries no unique constraint and POST /api/groups
        # accepts a name that already exists, so a duplicated name made this an arbitrary
        # pick by insertion order. An ambiguous name grants access to whichever row came
        # first, which is not a decision this should be making silently, so both zero
        # matches and more than one are skipped and logged.
        for name in settings.ADDITIONAL_DATA_SOURCE_GROUPS:
            matches = Group.query.filter(Group.org == data_source.org, Group.name == name).all()
            if len(matches) != 1:
                logger.warning(
                    "ADDITIONAL_DATA_SOURCE_GROUPS: %s group(s) named %r in org %s, skipping it; "
                    "the new data source is reachable from the default group only.",
                    len(matches),
                    name,
                    data_source.org_id,
                )
                continue
            if matches[0] not in groups:
                groups.append(matches[0])
        db.session.add_all([data_source] + [DataSourceGroup(data_source=data_source, group=g) for g in groups])
        return data_source

    @classmethod
    def all(cls, org, group_ids=None):
        data_sources = cls.query.filter(cls.org == org).order_by(cls.id.asc())

        if group_ids:
            data_sources = data_sources.join(DataSourceGroup).filter(DataSourceGroup.group_id.in_(group_ids))

        return data_sources.distinct()

    @classmethod
    def get_by_id(cls, _id):
        return cls.query.filter(cls.id == _id).one()

    def delete(self):
        Query.query.filter(Query.data_source == self).update(dict(data_source_id=None, latest_query_data_id=None))
        QueryResult.query.filter(QueryResult.data_source == self).delete()
        res = db.session.delete(self)
        db.session.commit()

        redis_connection.delete(self._schema_key)

        return res

    def get_cached_schema(self):
        cache = redis_connection.get(self._schema_key)
        return json_loads(cache) if cache else None

    def get_schema(self, refresh=False):
        out_schema = None
        if not refresh:
            out_schema = self.get_cached_schema()

        if out_schema is None:
            query_runner = self.query_runner
            schema = query_runner.get_schema(get_stats=refresh)

            try:
                out_schema = self._sort_schema(schema)
            except Exception:
                logging.exception("Error sorting schema columns for data_source {}".format(self.id))
                out_schema = schema
            finally:
                ttl = int(datetime.timedelta(minutes=settings.SCHEMAS_REFRESH_SCHEDULE, days=7).total_seconds())
                redis_connection.set(self._schema_key, json_dumps(out_schema), ex=ttl)

        return out_schema

    def _sort_schema(self, schema):
        return [
            {**i, "columns": sorted(i["columns"], key=lambda x: x["name"] if isinstance(x, dict) else x)}
            for i in sorted(schema, key=lambda x: x["name"])
        ]

    @property
    def _schema_key(self):
        return "data_source:schema:{}".format(self.id)

    @property
    def _pause_key(self):
        return "ds:{}:pause".format(self.id)

    @property
    def paused(self):
        return redis_connection.exists(self._pause_key)

    @property
    def pause_reason(self):
        return redis_connection.get(self._pause_key)

    def pause(self, reason=None):
        redis_connection.set(self._pause_key, reason or "")

    def resume(self):
        redis_connection.delete(self._pause_key)

    def add_group(self, group, view_only=False):
        dsg = DataSourceGroup(group=group, data_source=self, view_only=view_only)
        db.session.add(dsg)
        return dsg

    def remove_group(self, group):
        DataSourceGroup.query.filter(DataSourceGroup.group == group, DataSourceGroup.data_source == self).delete()
        db.session.commit()

    def update_group_permission(self, group, view_only):
        dsg = DataSourceGroup.query.filter(DataSourceGroup.group == group, DataSourceGroup.data_source == self).one()
        dsg.view_only = view_only
        db.session.add(dsg)
        return dsg

    @property
    def uses_ssh_tunnel(self):
        return self.options and "ssh_tunnel" in self.options

    @property
    def query_runner(self):
        query_runner = get_query_runner(self.type, self.options)

        if self.uses_ssh_tunnel:
            query_runner = with_ssh_tunnel(query_runner, self.options.get("ssh_tunnel"))

        return query_runner

    @classmethod
    def get_by_name(cls, name):
        return cls.query.filter(cls.name == name).one()

    # XXX examine call sites to see if a regular SQLA collection would work better
    @property
    def groups(self):
        groups = DataSourceGroup.query.filter(DataSourceGroup.data_source == self)
        return dict([(group.group_id, group.view_only) for group in groups])


@generic_repr("id", "data_source_id", "group_id", "view_only")
class DataSourceGroup(db.Model):
    # XXX drop id, use datasource/group as PK
    id = primary_key("DataSourceGroup")
    data_source_id = Column(key_type("DataSource"), db.ForeignKey("data_sources.id"))
    data_source = db.relationship(DataSource, back_populates="data_source_groups")
    group_id = Column(key_type("Group"), db.ForeignKey("groups.id"))
    group = db.relationship(Group, back_populates="data_sources")
    view_only = Column(db.Boolean, default=False)

    __tablename__ = "data_source_groups"
    __table_args__ = ({"extend_existing": True},)


@generic_repr("id", "org_id", "data_source_id", "query_hash", "runtime", "retrieved_at")
class QueryResult(db.Model, BelongsToOrgMixin):
    id = primary_key("QueryResult")
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))
    org = db.relationship(Organization)
    data_source_id = Column(key_type("DataSource"), db.ForeignKey("data_sources.id"))
    data_source = db.relationship(DataSource, backref=backref("query_results"))
    query_hash = Column(db.String(32), index=True)
    query_text = Column("query", db.Text)
    data = Column(JSONText, nullable=True)
    runtime = Column(DOUBLE_PRECISION)
    retrieved_at = Column(db.DateTime(True))

    __tablename__ = "query_results"

    def __str__(self):
        return "%d | %s | %s" % (self.id, self.query_hash, self.retrieved_at)

    def to_dict(self):
        return {
            "id": self.id,
            "query_hash": self.query_hash,
            "query": self.query_text,
            "data": self.data,
            "data_source_id": self.data_source_id,
            "runtime": self.runtime,
            "retrieved_at": self.retrieved_at,
        }

    @classmethod
    def unused(cls, days=7):
        age_threshold = datetime.datetime.now() - datetime.timedelta(days=days)
        return (cls.query.filter(Query.id.is_(None), cls.retrieved_at < age_threshold).outerjoin(Query)).options(
            load_only("id")
        )

    @classmethod
    def get_latest(cls, data_source, query, max_age=0):
        query_hash = gen_query_hash(query)

        if max_age == -1 and settings.QUERY_RESULTS_EXPIRED_TTL_ENABLED:
            max_age = settings.QUERY_RESULTS_EXPIRED_TTL

        if max_age == -1:
            query = cls.query.filter(cls.query_hash == query_hash, cls.data_source == data_source)
        else:
            query = cls.query.filter(
                cls.query_hash == query_hash,
                cls.data_source == data_source,
                (
                    db.func.timezone("utc", cls.retrieved_at) + datetime.timedelta(seconds=max_age)
                    >= db.func.timezone("utc", db.func.now())
                ),
            )

        return query.order_by(cls.retrieved_at.desc()).first()

    @classmethod
    def store_result(cls, org, data_source, query_hash, query, data, run_time, retrieved_at):
        query_result = cls(
            org_id=org,
            query_hash=query_hash,
            query_text=query,
            runtime=run_time,
            data_source=data_source,
            retrieved_at=retrieved_at,
            data=data,
        )

        db.session.add(query_result)
        logging.info("Inserted query (%s) data; id=%s", query_hash, query_result.id)

        return query_result

    @property
    def groups(self):
        return self.data_source.groups


def should_schedule_next(previous_iteration, now, interval, time=None, day_of_week=None, failures=0):
    # if previous_iteration is None, it means the query has never been run before
    # so we should schedule it immediately
    if previous_iteration is None:
        return True
    # if time exists then interval > 23 hours (82800s)
    # if day_of_week exists then interval > 6 days (518400s)
    if time is None:
        ttl = int(interval)
        next_iteration = previous_iteration + datetime.timedelta(seconds=ttl)
    else:
        hour, minute = time.split(":")
        hour, minute = int(hour), int(minute)

        # The following logic is needed for cases like the following:
        # - The query scheduled to run at 23:59.
        # - The scheduler wakes up at 00:01.
        # - Using naive implementation of comparing timestamps, it will skip the execution.
        normalized_previous_iteration = previous_iteration.replace(hour=hour, minute=minute)

        if normalized_previous_iteration > previous_iteration:
            previous_iteration = normalized_previous_iteration - datetime.timedelta(days=1)

        days_delay = int(interval) / 60 / 60 / 24

        days_to_add = 0
        if day_of_week is not None:
            days_to_add = list(calendar.day_name).index(day_of_week) - normalized_previous_iteration.weekday()

        next_iteration = (
            previous_iteration + datetime.timedelta(days=days_delay) + datetime.timedelta(days=days_to_add)
        ).replace(hour=hour, minute=minute)
    if failures:
        try:
            next_iteration += datetime.timedelta(minutes=2**failures)
        except OverflowError:
            return False
    return now > next_iteration


@gfk_type
@generic_repr(
    "id",
    "name",
    "query_hash",
    "version",
    "user_id",
    "org_id",
    "data_source_id",
    "query_hash",
    "last_modified_by_id",
    "is_archived",
    "is_draft",
    "schedule",
    "schedule_failures",
)
class Query(ChangeTrackingMixin, TimestampMixin, BelongsToOrgMixin, db.Model):
    id = primary_key("Query")
    version = Column(db.Integer, default=1)
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))
    org = db.relationship(Organization, backref="queries")
    data_source_id = Column(key_type("DataSource"), db.ForeignKey("data_sources.id"), nullable=True)
    data_source = db.relationship(DataSource, backref="queries")
    latest_query_data_id = Column(key_type("QueryResult"), db.ForeignKey("query_results.id"), nullable=True)
    latest_query_data = db.relationship(QueryResult)
    name = Column(db.String(255))
    description = Column(db.String(4096), nullable=True)
    query_text = Column("query", db.Text)
    query_hash = Column(db.String(32))
    api_key = Column(db.String(40), default=lambda: generate_token(40))
    user_id = Column(key_type("User"), db.ForeignKey("users.id"))
    user = db.relationship(User, foreign_keys=[user_id])
    last_modified_by_id = Column(key_type("User"), db.ForeignKey("users.id"), nullable=True)
    last_modified_by = db.relationship(User, backref="modified_queries", foreign_keys=[last_modified_by_id])
    is_archived = Column(db.Boolean, default=False, index=True)
    is_draft = Column(db.Boolean, default=True, index=True)
    schedule = Column(MutableDict.as_mutable(JSONB), nullable=True)
    interval = json_cast_property(db.Integer, "schedule", "interval", default=0)
    schedule_failures = Column(db.Integer, default=0)
    visualizations = db.relationship("Visualization", cascade="all, delete-orphan")
    options = Column(MutableDict.as_mutable(JSONB), default={})
    search_vector = Column(
        TSVectorType(
            "id",
            "name",
            "description",
            "query",
            weights={"name": "A", "id": "B", "description": "C", "query": "D"},
        ),
        nullable=True,
    )
    tags = Column("tags", MutableList.as_mutable(ARRAY(db.Unicode)), nullable=True)

    query_class = SearchBaseQuery
    __tablename__ = "queries"
    __mapper_args__ = {"version_id_col": version, "version_id_generator": False}

    def __str__(self):
        return str(self.id)

    def archive(self, user=None):
        db.session.add(self)
        self.is_archived = True
        self.schedule = None

        # Embed tokens on these visualizations are revoked by
        # revoke_share_tokens_when_target_is_archived on the way out, not here.
        # This method is not the only way is_archived gets set, so a revoke
        # written here would only cover the callers who came through it.
        for vis in self.visualizations:
            for w in vis.widgets:
                db.session.delete(w)

        for a in self.alerts:
            db.session.delete(a)

        if user:
            self.record_changes(user)

    def regenerate_api_key(self):
        self.api_key = generate_token(40)

    @classmethod
    def create(cls, **kwargs):
        query = cls(**kwargs)
        db.session.add(
            Visualization(
                query_rel=query,
                name="Table",
                description="",
                type="TABLE",
                options={},
            )
        )
        return query

    @classmethod
    def all_queries(cls, group_ids, user_id=None, include_drafts=False, include_archived=False):
        query_ids = (
            db.session.query(distinct(cls.id))
            .join(DataSourceGroup, Query.data_source_id == DataSourceGroup.data_source_id)
            .filter(Query.is_archived.is_(include_archived))
            .filter(DataSourceGroup.group_id.in_(group_ids))
        )
        queries = (
            cls.query.options(
                joinedload(Query.user),
                joinedload(Query.latest_query_data).load_only("runtime", "retrieved_at"),
            )
            .filter(cls.id.in_(query_ids))
            # Adding outer joins to be able to order by relationship
            .outerjoin(User, User.id == Query.user_id)
            .outerjoin(QueryResult, QueryResult.id == Query.latest_query_data_id)
            .options(contains_eager(Query.user), contains_eager(Query.latest_query_data))
        )

        if not include_drafts:
            queries = queries.filter(or_(Query.is_draft.is_(False), Query.user_id == user_id))
        return queries

    @classmethod
    def favorites(cls, user, base_query=None):
        if base_query is None:
            base_query = cls.all_queries(user.group_ids, user.id, include_drafts=True)
        return base_query.join(
            (
                Favorite,
                and_(Favorite.object_type == "Query", Favorite.object_id == Query.id),
            )
        ).filter(Favorite.user_id == user.id)

    @classmethod
    def all_tags(cls, user, include_drafts=False):
        queries = cls.all_queries(group_ids=user.group_ids, user_id=user.id, include_drafts=include_drafts)

        tag_column = func.unnest(cls.tags).label("tag")
        usage_count = func.count(1).label("usage_count")

        query = (
            db.session.query(tag_column, usage_count)
            .group_by(tag_column)
            .filter(Query.id.in_(queries.options(load_only("id"))))
            .order_by(tag_column)
        )
        return query

    @classmethod
    def by_user(cls, user):
        return cls.all_queries(user.group_ids, user.id).filter(Query.user == user)

    @classmethod
    def by_api_key(cls, api_key):
        return cls.query.filter(cls.api_key == api_key).one()

    @classmethod
    def past_scheduled_queries(cls):
        now = utils.utcnow()
        queries = Query.query.filter(func.jsonb_typeof(Query.schedule) != "null").order_by(Query.id)
        return [
            query
            for query in queries
            if "until" in query.schedule
            and query.schedule["until"] is not None
            and pytz.utc.localize(datetime.datetime.strptime(query.schedule["until"], "%Y-%m-%d")) <= now
        ]

    @classmethod
    def outdated_queries(cls):
        queries = (
            Query.query.options(joinedload(Query.latest_query_data).load_only("retrieved_at"))
            .filter(func.jsonb_typeof(Query.schedule) != "null")
            .order_by(Query.id)
            .all()
        )

        now = utils.utcnow()
        outdated_queries = {}
        scheduled_queries_executions.refresh()

        for query in queries:
            try:
                if query.schedule.get("disabled"):
                    continue

                # Skip queries that have None for all schedule values. It's unclear whether this
                # something that can happen in practice, but we have a test case for it.
                if all(value is None for value in query.schedule.values()):
                    continue

                if query.schedule["until"]:
                    schedule_until = pytz.utc.localize(datetime.datetime.strptime(query.schedule["until"], "%Y-%m-%d"))

                    if schedule_until <= now:
                        continue

                retrieved_at = scheduled_queries_executions.get(query.id) or (
                    query.latest_query_data and query.latest_query_data.retrieved_at
                )

                if should_schedule_next(
                    retrieved_at,
                    now,
                    query.schedule["interval"],
                    query.schedule["time"],
                    query.schedule["day_of_week"],
                    query.schedule_failures,
                ):
                    key = "{}:{}".format(query.query_hash, query.data_source_id)
                    outdated_queries[key] = query
            except Exception as e:
                query.schedule["disabled"] = True
                db.session.commit()

                message = (
                    "Could not determine if query %d is outdated due to %s. The schedule for this query has been disabled."
                    % (query.id, repr(e))
                )
                logging.info(message)
                sentry.capture_exception(type(e)(message).with_traceback(e.__traceback__))

        return list(outdated_queries.values())

    @classmethod
    def _do_multi_byte_search(cls, all_queries, term, limit=None):
        # term examples:
        #    - word
        #    - name:word
        #    - query:word
        #    - "multiple words"
        #    - name:"multiple words"
        #    - word1 word2 word3
        #    - word1 "multiple word" query:"select foo"
        tokens = re.findall(r'(?:([^:\s]+):)?(?:"([^"]+)"|(\S+))', term)
        conditions = []
        for token in tokens:
            key = None
            if token[0]:
                key = token[0]

            if token[1]:
                value = token[1]
            else:
                value = token[2]

            pattern = f"%{value}%"

            if key == "id" and value.isdigit():
                conditions.append(cls.id.equal(int(value)))
            elif key == "name":
                conditions.append(cls.name.ilike(pattern))
            elif key == "query":
                conditions.append(cls.query_text.ilike(pattern))
            elif key == "description":
                conditions.append(cls.description.ilike(pattern))
            else:
                conditions.append(or_(cls.name.ilike(pattern), cls.description.ilike(pattern)))

        return all_queries.filter(and_(*conditions)).order_by(Query.id).limit(limit)

    @classmethod
    def search(
        cls,
        term,
        group_ids,
        user_id=None,
        include_drafts=False,
        limit=None,
        include_archived=False,
        multi_byte_search=False,
    ):
        all_queries = cls.all_queries(
            group_ids,
            user_id=user_id,
            include_drafts=include_drafts,
            include_archived=include_archived,
        )

        if multi_byte_search:
            # Since tsvector doesn't work well with CJK languages, use `ilike` too
            return cls._do_multi_byte_search(all_queries, term, limit)

        # sort the result using the weight as defined in the search vector column
        return all_queries.search(term, sort=True).limit(limit)

    @classmethod
    def search_by_user(cls, term, user, limit=None, multi_byte_search=False):
        if multi_byte_search:
            # Since tsvector doesn't work well with CJK languages, use `ilike` too
            return cls._do_multi_byte_search(cls.by_user(user), term, limit)

        return cls.by_user(user).search(term, sort=True).limit(limit)

    @classmethod
    def recent(cls, group_ids, user_id=None, limit=20):
        query = (
            cls.query.filter(Event.created_at > (db.func.current_date() - 7))
            .join(Event, Query.id == Event.object_id.cast(db.Integer))
            .join(DataSourceGroup, Query.data_source_id == DataSourceGroup.data_source_id)
            .filter(
                Event.action.in_(["edit", "execute", "edit_name", "edit_description", "view_source"]),
                Event.object_id is not None,
                Event.object_type == "query",
                DataSourceGroup.group_id.in_(group_ids),
                or_(Query.is_draft.is_(False), Query.user_id is user_id),
                Query.is_archived.is_(False),
            )
            .group_by(Event.object_id, Query.id)
            .order_by(db.desc(db.func.count(0)))
        )

        if user_id:
            query = query.filter(Event.user_id == user_id)

        query = query.limit(limit)

        return query

    @classmethod
    def get_by_id(cls, _id):
        return cls.query.filter(cls.id == _id).one()

    @classmethod
    def all_groups_for_query_ids(cls, query_ids):
        query = """SELECT group_id, view_only
                   FROM queries
                   JOIN data_source_groups ON queries.data_source_id = data_source_groups.data_source_id
                   WHERE queries.id in :ids"""

        return db.session.execute(query, {"ids": tuple(query_ids)}).fetchall()

    def update_latest_result_by_query_hash(self):
        query_hash = self.query_hash
        data_source_id = self.data_source_id
        query_result = (
            QueryResult.query.options(load_only("id"))
            .filter(
                QueryResult.query_hash == query_hash,
                QueryResult.data_source_id == data_source_id,
            )
            .order_by(QueryResult.retrieved_at.desc())
            .first()
        )
        if query_result:
            latest_query_data_id = query_result.id
            self.latest_query_data_id = latest_query_data_id
            db.session.add(self)

    @classmethod
    def update_latest_result(cls, query_result):
        # TODO: Investigate how big an impact this select-before-update makes.
        queries = Query.query.filter(
            Query.query_hash == query_result.query_hash,
            Query.data_source == query_result.data_source,
            Query.is_archived.is_(False),
        )

        for q in queries:
            q.latest_query_data = query_result
            # don't auto-update the updated_at timestamp
            q.skip_updated_at = True
            db.session.add(q)

        query_ids = [q.id for q in queries]
        logging.info(
            "Updated %s queries with result (%s).",
            len(query_ids),
            query_result.query_hash,
        )

        return query_ids

    def fork(self, user):
        forked_list = [
            "org",
            "data_source",
            "latest_query_data",
            "description",
            "query_text",
            "query_hash",
            "options",
            "tags",
        ]
        kwargs = {a: getattr(self, a) for a in forked_list}

        # Query.create will add default TABLE visualization, so use constructor to create bare copy of query
        forked_query = Query(name="Copy of (#{}) {}".format(self.id, self.name), user=user, **kwargs)

        for v in sorted(self.visualizations, key=lambda v: v.id):
            forked_v = v.copy()
            forked_v["query_rel"] = forked_query
            fv = Visualization(**forked_v)  # it will magically add it to `forked_query.visualizations`
            db.session.add(fv)

        db.session.add(forked_query)
        return forked_query

    @property
    def runtime(self):
        return self.latest_query_data.runtime

    @property
    def retrieved_at(self):
        return self.latest_query_data.retrieved_at

    @property
    def groups(self):
        if self.data_source is None:
            return {}

        return self.data_source.groups

    @hybrid_property
    def lowercase_name(self):
        "Optional property useful for sorting purposes."
        return self.name.lower()

    @lowercase_name.expression
    def lowercase_name(cls):
        "The SQLAlchemy expression for the property above."
        return func.lower(cls.name)

    @property
    def parameters(self):
        return self.options.get("parameters", [])

    @property
    def parameterized(self):
        return ParameterizedQuery(self.query_text, self.parameters, self.org)

    @property
    def dashboard_api_keys(self):
        """Every live dashboard token that authorizes reading this query.

        has_access_to_object treats membership in this list as the whole
        authorization decision, and QueryResultResource.post runs no data
        source group check behind it, so anything listed here is executable by
        whoever holds the token. That makes the archived conditions below part
        of the access rule and not a display filter.

        A query's archive does not revoke the token of a dashboard it sits on,
        and it should not: the dashboard is still there, it is one widget on it
        that is gone. DELETE /api/queries/<id> deletes those widgets, but the
        generic update path leaves them in place, so this is the only thing
        standing between a dashboard token and a query its owner deleted.

        The dashboard's own archive is checked for the same reason
        ApiKey.resolve_share_token checks it. Archiving revokes the keys on the
        way out, which already makes them unusable, so this is what holds if
        some path ever sets the column without going through a flush.

        coalesce because is_archived is nullable and rows predating its default
        can hold NULL, which no comparison would keep.
        """
        query = """SELECT api_keys.api_key
                   FROM api_keys
                   JOIN dashboards ON object_id = dashboards.id
                   JOIN widgets ON dashboards.id = widgets.dashboard_id
                   JOIN visualizations ON widgets.visualization_id = visualizations.id
                   JOIN queries ON visualizations.query_id = queries.id
                   WHERE object_type='dashboards'
                     AND active=true
                     AND NOT coalesce(dashboards.is_archived, false)
                     AND NOT coalesce(queries.is_archived, false)
                     AND visualizations.query_id = :id"""

        api_keys = db.session.execute(query, {"id": self.id}).fetchall()
        return [api_key[0] for api_key in api_keys]

    def update_query_hash(self):
        should_apply_auto_limit = self.options.get("apply_auto_limit", False) if self.options else False
        query_runner = self.data_source.query_runner if self.data_source else BaseQueryRunner({})
        query_text = self.query_text

        parameters_dict = {p["name"]: p.get("value") for p in self.parameters} if self.options else {}
        if any(parameters_dict):
            try:
                query_text = self.parameterized.apply(parameters_dict).query
            except InvalidParameterError as e:
                logging.info(f"Unable to update hash for query {self.id} because of invalid parameters: {str(e)}")
            except QueryDetachedFromDataSourceError as e:
                logging.info(
                    f"Unable to update hash for query {self.id} because of dropdown query {e.query_id} is unattached from datasource"
                )

        self.query_hash = query_runner.gen_query_hash(query_text, should_apply_auto_limit)


@listens_for(Query, "before_insert")
@listens_for(Query, "before_update")
def receive_before_insert_update(mapper, connection, target):
    target.update_query_hash()


@listens_for(Query.user_id, "set")
def query_last_modified_by(target, val, oldval, initiator):
    target.last_modified_by_id = val


@generic_repr("id", "object_type", "object_id", "user_id", "org_id")
class Favorite(TimestampMixin, db.Model):
    id = primary_key("Favorite")
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))

    object_type = Column(db.Unicode(255))
    object_id = Column(key_type("Favorite"))
    object = generic_relationship(object_type, object_id)

    user_id = Column(key_type("User"), db.ForeignKey("users.id"))
    user = db.relationship(User, backref="favorites")

    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("object_type", "object_id", "user_id", name="unique_favorite"),)

    @classmethod
    def is_favorite(cls, user, object):
        return cls.query.filter(cls.object == object, cls.user_id == user).count() > 0

    @classmethod
    def are_favorites(cls, user, objects):
        objects = list(objects)
        if not objects:
            return []

        object_type = str(objects[0].__class__.__name__)
        return [
            fav.object_id
            for fav in cls.query.filter(
                cls.object_id.in_([o.id for o in objects]),
                cls.object_type == object_type,
                cls.user_id == user,
            )
        ]


OPERATORS = {
    ">": lambda v, t: v > t,
    ">=": lambda v, t: v >= t,
    "<": lambda v, t: v < t,
    "<=": lambda v, t: v <= t,
    "==": lambda v, t: v == t,
    "!=": lambda v, t: v != t,
    # backward compatibility
    "greater than": lambda v, t: v > t,
    "less than": lambda v, t: v < t,
    "equals": lambda v, t: v == t,
}


def next_state(op, value, threshold):
    if isinstance(value, bool):
        # If it's a boolean cast to string and lower case, because upper cased
        # boolean value is Python specific and most likely will be confusing to
        # users.
        value = str(value).lower()
        value_is_number = False
    else:
        try:
            value = float(value)
            value_is_number = True
        except ValueError:
            value_is_number = isinstance(value, numbers.Number)

        if value_is_number:
            try:
                threshold = float(threshold)
            except ValueError:
                return Alert.UNKNOWN_STATE
        else:
            value = str(value)

    if op(value, threshold):
        new_state = Alert.TRIGGERED_STATE
    elif not value_is_number and op not in [OPERATORS.get("!="), OPERATORS.get("=="), OPERATORS.get("equals")]:
        new_state = Alert.UNKNOWN_STATE
    else:
        new_state = Alert.OK_STATE

    return new_state


@generic_repr("id", "name", "query_id", "user_id", "state", "last_triggered_at", "rearm")
class Alert(TimestampMixin, BelongsToOrgMixin, db.Model):
    UNKNOWN_STATE = "unknown"
    OK_STATE = "ok"
    TRIGGERED_STATE = "triggered"
    TEST_STATE = "test"

    id = primary_key("Alert")
    name = Column(db.String(255))
    query_id = Column(key_type("Query"), db.ForeignKey("queries.id"))
    query_rel = db.relationship(Query, backref=backref("alerts", cascade="all"))
    user_id = Column(key_type("User"), db.ForeignKey("users.id"))
    user = db.relationship(User, backref="alerts")
    options = Column(MutableDict.as_mutable(JSONB), nullable=True)
    state = Column(db.String(255), default=UNKNOWN_STATE)
    subscriptions = db.relationship("AlertSubscription", cascade="all, delete-orphan")
    last_triggered_at = Column(db.DateTime(True), nullable=True)
    rearm = Column(db.Integer, nullable=True)

    __tablename__ = "alerts"

    @classmethod
    def all(cls, group_ids):
        return (
            cls.query.options(joinedload(Alert.user), joinedload(Alert.query_rel))
            .join(Query)
            .join(DataSourceGroup, DataSourceGroup.data_source_id == Query.data_source_id)
            .filter(DataSourceGroup.group_id.in_(group_ids))
        )

    @classmethod
    def get_by_id_and_org(cls, object_id, org):
        return super(Alert, cls).get_by_id_and_org(object_id, org, Query)

    def _selected_value(self, data):
        """The one number this alert's selector picks out of a result.

        None means there is nothing to compare, which every caller turns into
        UNKNOWN rather than comparing against.

        The guard is applied to the row the selector actually reads. The old
        code tested `column in rows[0]` and then let the min and max branches
        index every other row, so a column missing from a later row raised
        KeyError out of evaluate() (the surrounding try catches only
        ValueError), while a column present only in the last row read as
        UNKNOWN under a selector that never looks at the first.

        Raises ValueError or TypeError for a cell min/max cannot order: a
        non-numeric string raises the first, a JSON array or object the second.
        Callers catch both and answer UNKNOWN. The old loop let TypeError escape
        `evaluate()` entirely, because its `except ValueError` did not name it.
        """
        rows = data["rows"]
        if not rows:
            return None

        column = self.options["column"]
        selector = self.options.get("selector", "first")

        if selector in ("min", "max"):
            cells = [row[column] for row in rows if row.get(column) is not None]
            if not cells:
                return None
            # `key=float` rather than a list of floats: the cell is returned as
            # it was stored, so QUERY_RESULT_VALUE reports 3 and not 3.0 for an
            # integer column. next_state() casts to float itself, so the
            # comparison is unchanged.
            pick = min if selector == "min" else max
            return pick(cells, key=float)

        row = rows[-1] if selector == "last" else rows[0]
        return row.get(column)

    def evaluate(self):
        data = self.query_rel.latest_query_data.data if self.query_rel.latest_query_data else None
        if not data:
            return self.UNKNOWN_STATE

        try:
            value = self._selected_value(data)
        except (ValueError, TypeError):
            return self.UNKNOWN_STATE

        if value is None:
            return self.UNKNOWN_STATE

        op = OPERATORS.get(self.options["op"], lambda v, t: False)
        return next_state(op, value, self.options["value"])

    def subscribers(self):
        return User.query.join(AlertSubscription).filter(AlertSubscription.alert == self)

    def render_template(self, template):
        if template is None:
            return ""

        data = self.query_rel.latest_query_data.data
        host = base_url(self.query_rel.org)

        try:
            result_value = self._selected_value(data)
        except (ValueError, TypeError):
            # The same min/max input that makes evaluate() answer UNKNOWN: a
            # non-numeric string raises ValueError, a JSON array or object
            # TypeError. Both are caught, because rendering happens on a path
            # that never coerced the column before, so an uncaught one here
            # would fail the whole notification for a query whose result merely
            # contains a nested value. The message still goes out, with an empty
            # QUERY_RESULT_VALUE.
            result_value = None

        result_table = []  # A two-dimensional array which can rendered as a table in Mustache
        for row in data["rows"]:
            result_table.append([row[col["name"]] for col in data["columns"]])
        context = {
            "ALERT_NAME": self.name,
            "ALERT_URL": "{host}/alerts/{alert_id}".format(host=host, alert_id=self.id),
            "ALERT_STATUS": self.state.upper(),
            "ALERT_SELECTOR": self.options["selector"],
            "ALERT_CONDITION": self.options["op"],
            "ALERT_THRESHOLD": self.options["value"],
            "QUERY_NAME": self.query_rel.name,
            "QUERY_URL": "{host}/queries/{query_id}".format(host=host, query_id=self.query_rel.id),
            "QUERY_RESULT_VALUE": result_value,
            "QUERY_RESULT_ROWS": data["rows"],
            "QUERY_RESULT_COLS": data["columns"],
            "QUERY_RESULT_TABLE": result_table,
        }
        return mustache_render_escape(template, context)

    @property
    def custom_body(self):
        template = self.options.get("custom_body", self.options.get("template"))
        return self.render_template(template)

    @property
    def custom_subject(self):
        template = self.options.get("custom_subject")
        return self.render_template(template)

    @property
    def groups(self):
        return self.query_rel.groups

    @property
    def muted(self):
        return self.options.get("muted", False)


def generate_slug(ctx):
    slug = utils.slugify(ctx.current_parameters["name"])
    tries = 1
    while Dashboard.query.filter(Dashboard.slug == slug).first() is not None:
        slug = utils.slugify(ctx.current_parameters["name"]) + "_" + str(tries)
        tries += 1
    return slug


@gfk_type
@generic_repr("id", "name", "slug", "user_id", "org_id", "version", "is_archived", "is_draft")
class Dashboard(ChangeTrackingMixin, TimestampMixin, BelongsToOrgMixin, db.Model):
    id = primary_key("Dashboard")
    version = Column(db.Integer)
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))
    org = db.relationship(Organization, backref="dashboards")
    slug = Column(db.String(140), index=True, default=generate_slug)
    name = Column(db.String(100))
    user_id = Column(key_type("User"), db.ForeignKey("users.id"))
    user = db.relationship(User)
    # layout is no longer used, but kept so we know how to render old dashboards.
    layout = Column(MutableList.as_mutable(JSONB), default=[])
    dashboard_filters_enabled = Column(db.Boolean, default=False)
    is_archived = Column(db.Boolean, default=False, index=True)
    is_draft = Column(db.Boolean, default=True, index=True)
    widgets = db.relationship("Widget", backref="dashboard", lazy="dynamic")
    tags = Column("tags", MutableList.as_mutable(ARRAY(db.Unicode)), nullable=True)
    options = Column(MutableDict.as_mutable(JSONB), default={})

    __tablename__ = "dashboards"
    __mapper_args__ = {"version_id_col": version}

    def __str__(self):
        return "%s=%s" % (self.id, self.name)

    @property
    def name_as_slug(self):
        return utils.slugify(self.name)

    def share_target_is_archived(self):
        """Whether the product treats this dashboard as deleted.

        Read from the database rather than off this instance. A mint loads its
        target and only then takes the per object lock, so by the time it holds
        that lock the copy it is carrying can be older than an archive that was
        queued ahead of it, and that stale copy still says the dashboard is
        live. ApiKey.get_or_create_for_object and ApiKey.resolve_share_token
        are the two callers, and both need the current answer, not the one that
        was true when the row was loaded.
        """
        return bool(db.session.query(Dashboard.is_archived).filter(Dashboard.id == self.id).scalar())

    @classmethod
    def all(cls, org, group_ids, user_id, include_archived=False):
        # include_archived switches the listing over to archived dashboards
        # instead of widening it to both, which is what Query.all_queries does
        # with the identically named argument. Archiving is the product's
        # delete, so nothing wants a listing that mixes live dashboards with
        # deleted ones; the archive is a separate view of its own.
        query = (
            Dashboard.query.options(joinedload(Dashboard.user).load_only("id", "name", "details", "email"))
            .distinct(cls.lowercase_name, Dashboard.created_at, Dashboard.slug)
            .outerjoin(Widget)
            .outerjoin(Visualization)
            .outerjoin(Query)
            .outerjoin(DataSourceGroup, Query.data_source_id == DataSourceGroup.data_source_id)
            .filter(
                Dashboard.is_archived.is_(include_archived),
                (DataSourceGroup.group_id.in_(group_ids) | (Dashboard.user_id == user_id)),
                Dashboard.org == org,
            )
        )

        query = query.filter(or_(Dashboard.user_id == user_id, Dashboard.is_draft.is_(False)))

        return query

    @classmethod
    def search(cls, org, groups_ids, user_id, search_term, include_archived=False):
        # TODO: switch to FTS
        return cls.all(org, groups_ids, user_id, include_archived=include_archived).filter(
            cls.name.ilike("%{}%".format(search_term))
        )

    @classmethod
    def search_by_user(cls, term, user, limit=None):
        return cls.by_user(user).filter(cls.name.ilike("%{}%".format(term))).limit(limit)

    @classmethod
    def all_tags(cls, org, user):
        dashboards = cls.all(org, user.group_ids, user.id)

        tag_column = func.unnest(cls.tags).label("tag")
        usage_count = func.count(1).label("usage_count")

        query = (
            db.session.query(tag_column, usage_count)
            .group_by(tag_column)
            .filter(Dashboard.id.in_(dashboards.options(load_only("id"))))
            .order_by(tag_column)
        )
        return query

    @classmethod
    def favorites(cls, user, base_query=None):
        if base_query is None:
            base_query = cls.all(user.org, user.group_ids, user.id)
        return (
            base_query.distinct(cls.lowercase_name, Dashboard.created_at, Dashboard.slug, Favorite.created_at)
            .join(
                (
                    Favorite,
                    and_(
                        Favorite.object_type == "Dashboard",
                        Favorite.object_id == Dashboard.id,
                    ),
                )
            )
            .filter(Favorite.user_id == user.id)
        )

    @classmethod
    def by_user(cls, user):
        return cls.all(user.org, user.group_ids, user.id).filter(Dashboard.user == user)

    @classmethod
    def get_by_slug_and_org(cls, slug, org):
        return cls.query.filter(cls.slug == slug, cls.org == org).one()

    def fork(self, user):
        forked_list = ["org", "layout", "dashboard_filters_enabled", "tags"]

        kwargs = {a: getattr(self, a) for a in forked_list}
        forked_dashboard = Dashboard(name="Copy of (#{}) {}".format(self.id, self.name), user=user, **kwargs)

        for w in self.widgets:
            forked_w = w.copy(forked_dashboard.id)
            fw = Widget(**forked_w)
            db.session.add(fw)

        forked_dashboard.slug = forked_dashboard.id
        db.session.add(forked_dashboard)
        return forked_dashboard

    @hybrid_property
    def lowercase_name(self):
        "Optional property useful for sorting purposes."
        return self.name.lower()

    @lowercase_name.expression
    def lowercase_name(cls):
        "The SQLAlchemy expression for the property above."
        return func.lower(cls.name)


@generic_repr("id", "name", "type", "query_id")
@gfk_type
class Visualization(TimestampMixin, BelongsToOrgMixin, db.Model):
    id = primary_key("Visualization")
    type = Column(db.String(100))
    query_id = Column(key_type("Query"), db.ForeignKey("queries.id"))
    # query_rel and not query, because db.Model already has query defined.
    query_rel = db.relationship(Query, back_populates="visualizations")
    name = Column(db.String(255))
    description = Column(db.String(4096), nullable=True)
    options = Column(MutableDict.as_mutable(JSONB), nullable=True)

    __tablename__ = "visualizations"

    def __str__(self):
        return "%s %s" % (self.id, self.type)

    @classmethod
    def get_by_id_and_org(cls, object_id, org):
        return super(Visualization, cls).get_by_id_and_org(object_id, org, Query)

    def share_target_is_archived(self):
        """Whether the product treats this visualization as deleted.

        A visualization carries no archive flag of its own: archiving its query
        is what takes it out of the product, and this row survives that
        untouched. See Dashboard.share_target_is_archived for why the answer is
        read from the database rather than off the instance in hand.
        """
        return bool(db.session.query(Query.is_archived).filter(Query.id == self.query_id).scalar())

    def copy(self):
        return {
            "type": self.type,
            "name": self.name,
            "description": self.description,
            "options": self.options,
        }


@generic_repr("id", "visualization_id", "dashboard_id")
class Widget(TimestampMixin, BelongsToOrgMixin, db.Model):
    id = primary_key("Widget")
    visualization_id = Column(key_type("Visualization"), db.ForeignKey("visualizations.id"), nullable=True)
    visualization = db.relationship(Visualization, backref=backref("widgets", cascade="delete"))
    text = Column(db.Text, nullable=True)
    width = Column(db.Integer)
    options = Column(MutableDict.as_mutable(JSONB), default={})
    dashboard_id = Column(key_type("Dashboard"), db.ForeignKey("dashboards.id"), index=True)

    __tablename__ = "widgets"

    def __str__(self):
        return "%s" % self.id

    @classmethod
    def get_by_id_and_org(cls, object_id, org):
        return super(Widget, cls).get_by_id_and_org(object_id, org, Dashboard)

    def copy(self, dashboard_id):
        return {
            "options": self.options,
            "width": self.width,
            "text": self.text,
            "visualization_id": self.visualization_id,
            "dashboard_id": dashboard_id,
        }


# Provenance of an event row, carried inside additional_properties and read
# back by handlers.events.serialize_event. Three states, not two:
#
#   True    the row arrived through POST /api/events, so its contents are
#           whatever a browser said they were
#   False   the server recorded it itself (handlers.base.record_event stamps
#           every writer that goes through it, authentication.log_user_logged_in
#           stamps itself)
#   absent  unknown, and it stays unknown
#
# The third state is the point. Every row written before this key existed
# carries no marker, so reading a missing marker as "the server wrote this"
# would extend the server's credibility to the whole historical table:
# ordinary client page views, which is exactly what the key separates out, and
# any forged privilege action already sitting there. What is guaranteed is
# narrower than it looks. Rows written from here on can be told apart, and a
# row carrying no marker is never reported as the server's own. Nothing can be
# guaranteed about the contents of a legacy row, because everything a browser
# posted to the events route before this landed in additional_properties
# verbatim, this key included.
#
# It lives here rather than in a handler because two importers need it and
# redash.handlers.base and redash.authentication already import each other.
CLIENT_SUBMITTED_KEY = "client_submitted"


@generic_repr("id", "object_type", "object_id", "action", "user_id", "org_id", "created_at")
class Event(db.Model):
    id = primary_key("Event")
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))
    org = db.relationship(Organization, back_populates="events")
    user_id = Column(key_type("User"), db.ForeignKey("users.id"), nullable=True)
    user = db.relationship(User, backref="events")
    action = Column(db.String(255))
    object_type = Column(db.String(255))
    object_id = Column(db.String(255), nullable=True)
    additional_properties = Column(MutableDict.as_mutable(JSONB), nullable=True, default={})
    created_at = Column(db.DateTime(True), default=db.func.now())

    __tablename__ = "events"

    def __str__(self):
        return "%s,%s,%s,%s" % (
            self.user_id,
            self.action,
            self.object_type,
            self.object_id,
        )

    def to_dict(self):
        return {
            "org_id": self.org_id,
            "user_id": self.user_id,
            "action": self.action,
            "object_type": self.object_type,
            "object_id": self.object_id,
            "additional_properties": self.additional_properties,
            "created_at": self.created_at.isoformat(),
        }

    @classmethod
    def record(cls, event):
        org_id = event.pop("org_id")
        user_id = event.pop("user_id", None)
        action = event.pop("action")
        object_type = event.pop("object_type")
        object_id = event.pop("object_id", None)

        created_at = datetime.datetime.utcfromtimestamp(event.pop("timestamp"))

        event = cls(
            org_id=org_id,
            user_id=user_id,
            action=action,
            object_type=object_type,
            object_id=object_id,
            additional_properties=event,
            created_at=created_at,
        )
        db.session.add(event)
        return event


@generic_repr("id", "created_by_id", "org_id", "active")
class ApiKey(TimestampMixin, GFKBase, db.Model):
    id = primary_key("ApiKey")
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))
    org = db.relationship(Organization)
    api_key = Column(db.String(255), index=True, default=lambda: generate_token(40))
    active = Column(db.Boolean, default=True)
    expires_at = Column(db.DateTime(True), nullable=True)
    # 'object' provided by GFKBase
    object_id = Column(key_type("ApiKey"))
    created_by_id = Column(key_type("User"), db.ForeignKey("users.id"), nullable=True)
    created_by = db.relationship(User)

    __tablename__ = "api_keys"
    __table_args__ = (
        db.Index("api_keys_object_type_object_id", "object_type", "object_id"),
        # One live credential per object, enforced by the database rather than
        # by the read-then-insert in get_or_create_for_object. Two concurrent
        # share requests otherwise both find nothing and both insert, and the
        # loser of that race is a live external link revocation cannot reach.
        # Partial, so revoked keys accumulate harmlessly.
        db.Index(
            "api_keys_one_active_key_per_object",
            "object_type",
            "object_id",
            unique=True,
            postgresql_where=text("active"),
        ),
    )

    @classmethod
    def _lock_object(cls, object):
        """Serialize minting and revoking for one object against each other.

        Transaction scoped, so it is released on commit or rollback and there
        is no unlock to forget. Without it the two are idempotent only when
        they run one after the other: two mints both read nothing and both
        insert, and a revoke that reads before a concurrent insert commits
        leaves that key live with nothing in the product able to withdraw it.

        The lock covers the object, not the table, so sharing two dashboards at
        once does not queue. hashtext gives the object type a stable int4 to sit
        in the first half of the advisory lock key.
        """
        db.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:object_type), :object_id)"),
            {"object_type": object.__class__.__tablename__, "object_id": object.id},
        )

    @classmethod
    def get_by_api_key(cls, api_key):
        return cls.query.filter(
            cls.api_key == api_key,
            cls.active.is_(True),
            or_(cls.expires_at.is_(None), cls.expires_at > utils.utcnow()),
        ).one()

    @classmethod
    def resolve_share_token(cls, api_key, object_cls, org):
        """Resolve a share token to (key, object, outcome), saying why it failed.

        Outcome is one of "ok", "not_found", "revoked", "expired". It is meant
        for the event log only: callers must answer the same status for every
        outcome that is not "ok", because a status that distinguishes "expired"
        from "unknown" confirms the token existed, which is a probing oracle.

        A token is a credential for one object of one type in one organization,
        so all three are part of resolving it. The org matters because it comes
        from the slug in the route: resolve on the token alone and a link minted
        where public URLs are disabled can be redeemed under an org where they
        are not, and the read is recorded against the wrong tenant.

        The object is loaded here rather than through the generic foreign key,
        which has no cascade and so survives its target. A key pointing at a
        deleted row resolves to not_found instead of handing the caller a None
        to dereference, which would answer 500 where every other refusal
        answers 404 and would say the token was real.

        The key comes back even when nothing else does, so the refusal can be
        recorded against the tenant that owns it rather than the one named in
        the URL.

        object_cls has to implement share_target_is_archived. Only Dashboard
        and Visualization are shareable, and both do.
        """
        key = cls.query.filter(cls.api_key == api_key).first()

        if key is None:
            return None, None, "not_found"

        if key.object_type != object_cls.__tablename__ or key.org_id != org.id:
            return key, None, "not_found"

        try:
            object = object_cls.get_by_id_and_org(key.object_id, org)
        except NoResultFound:
            return key, None, "not_found"

        if object.share_target_is_archived():
            # Archiving is what the product's delete button does, and it leaves
            # the row in place, so a token that outlived one keeps serving
            # something its owner believes is gone. Refused here as well as at
            # the mint, because the two are not the same guarantee: minting
            # cannot see an archive that happens after it, and a revoke racing
            # a mint can miss a key that did not exist when it read the list.
            # This is the boundary that holds whatever the write paths did.
            #
            # Reported as not_found, not revoked: what disappeared is the
            # object, not the credential. Every outcome answers the same 404,
            # so the distinction only ever reaches the event log.
            return key, object, "not_found"

        if not key.active:
            return key, object, "revoked"
        if key.expires_at is not None and key.expires_at <= utils.utcnow():
            return key, object, "expired"

        return key, object, "ok"

    @classmethod
    def all_active_for_object(cls, object):
        """Every live share token for one object, oldest first."""
        return cls.query.filter(
            cls.object_type == object.__class__.__tablename__,
            cls.object_id == object.id,
            cls.active.is_(True),
        ).order_by(cls.id)

    @classmethod
    def get_by_object(cls, object):
        return cls.all_active_for_object(object).first()

    @classmethod
    def create_for_object(cls, object, user):
        k = cls(org=user.org, object=object, created_by=user)
        db.session.add(k)
        return k

    class TargetArchived(Exception):
        """Raised when a share token is asked for something already deleted.

        Deleted in either sense. Archiving is the product's delete for a
        dashboard or a query, and a visualization is deleted outright, row and
        all. Publishing either one is publishing something that is not there,
        and handlers answer 404 for both.
        """

    @classmethod
    def _target_has_left_the_org(cls, object, org):
        """Whether the object is no longer a live row in that organization.

        Read from the database and under the per object lock, for the reason
        share_target_is_archived is: the ordering that has to be survived is
        the one where a delete took the lock first, so the copy this caller
        loaded still says the row is there when it is not.

        Checked as well as the archive, not instead of it, because the two are
        different disappearances. A visualization has no archive flag and its
        delete leaves the parent query alone, so an archive check alone sees a
        live parent and lets the mint through. What it inserts is an active key
        for a row that is gone: a token that 404s on first use, and an orphan
        the share dialog can no longer load in order to revoke.

        get_by_id_and_org is what the handlers loaded the object with in the
        first place, so this asks the same question again rather than a
        narrower one, and it covers the organization as well as the row.
        """
        try:
            object.__class__.get_by_id_and_org(object.id, org)
        except NoResultFound:
            return True

        return False

    @classmethod
    def get_or_create_for_object(cls, object, user):
        """Return the object's live share token, minting one only if none exists.

        Minting has to be idempotent, because get_by_object answers with a
        single key: a bare create_for_object on a second share leaves two active
        rows, revocation reaches one of them, and the other is a working
        external link the product can no longer withdraw. Sharing twice
        therefore hands back the same token.

        Re-sharing is how the terms of that one link change, not how a rival to
        it gets issued. The caller assigns expires_at to the key returned here,
        so a second share carrying an expiry sets one on the token already in
        the wild, and a second share carrying none clears it. The token itself
        is stable either way, so no copy anyone was handed stops matching.

        Idempotent under concurrency and not only in sequence: callers queue on
        the object, and the partial unique index catches anything that inserts
        without taking that lock. On a conflict the row that landed is the one
        every caller has to agree on, so it is re-read rather than raised.

        Raises TargetArchived if the object has been archived or deleted. Both
        checks are under the lock and against the database, not against the
        caller's copy, because the ordering they have to survive is the one
        where the archive or the delete got the lock first: this caller loaded
        a live object, waited, and would otherwise mint a link to something
        that is now gone, with that writer's own revoke already run and unable
        to reach a key that did not exist when it read the list.
        """
        cls._lock_object(object)

        if cls._target_has_left_the_org(object, user.org):
            raise cls.TargetArchived(
                "cannot share {} {}, it is no longer there".format(type(object).__name__, object.id)
            )

        if object.share_target_is_archived():
            raise cls.TargetArchived("cannot share {}, it is archived".format(object))

        existing = cls.get_by_object(object)

        if existing is not None:
            return existing

        try:
            with db.session.begin_nested():
                key = cls.create_for_object(object, user)
        except IntegrityError:
            return cls.get_by_object(object)

        return key

    @classmethod
    def deactivate_for_object(cls, object):
        """Revoke every live share token for an object, and return them.

        All of them, not the first: an object can already carry more than one
        active key from before minting became idempotent, and get_by_object
        hides all but one. Revoking one at a time would leave a live link with
        nothing in the product able to reach it, which is the state this
        classmethod exists to clean up as well as to avoid.

        Takes the same per-object lock minting takes, so a share that is in
        flight cannot land behind this read and survive the revoke.
        """
        cls._lock_object(object)

        keys = cls.all_active_for_object(object).all()

        for key in keys:
            key.active = False
            db.session.add(key)

        return keys


@listens_for(db.session, "before_flush")
def revoke_share_tokens_when_target_is_archived(session, flush_context, instances):
    """Withdraw external links the moment the thing they point at is archived.

    Here rather than in the handlers that archive, because is_archived is an
    ordinary column and both Dashboard and Query are written through a generic
    setattr loop over request fields (update_model in handlers/base.py). Any
    request carrying the field archives, whether or not it went through
    DashboardResource.delete or Query.archive, so a revoke that lives in those
    two places is a revoke every other path walks straight past. This one
    cannot be walked past: nothing reaches the api_keys table without a flush.

    Only the false to true edge, read off the attribute history, so re-saving
    something that was already archived does not queue on the per object lock
    again for nothing. When the previous value was never loaded the history
    cannot say, and the edge is assumed, because revoking twice costs a lock
    and not revoking costs a live link.

    Pairs with ApiKey.get_or_create_for_object. Both take the same per object
    lock, so a share request in flight either lands first and is revoked here,
    or waits and then finds its target archived and refuses. Neither half is
    sufficient alone, and ApiKey.resolve_share_token is what holds if some
    third path ever archives without going through a flush at all.
    """
    for object in session.dirty:
        if not isinstance(object, (Dashboard, Query)):
            continue

        history = db.inspect(object).attrs.is_archived.history

        # Untouched by this flush, or set to something that is not archived.
        if not history.added or object.is_archived is not True:
            continue

        # Already archived on the way in: this save changed something else.
        if history.deleted and history.deleted[0] is True:
            continue

        if isinstance(object, Dashboard):
            ApiKey.deactivate_for_object(object)
        else:
            # A query is not shared itself. Its visualizations are, and they
            # survive its archive with no flag of their own to go by.
            for visualization in object.visualizations:
                ApiKey.deactivate_for_object(visualization)


@generic_repr("id", "name", "type", "user_id", "org_id", "created_at")
class NotificationDestination(BelongsToOrgMixin, db.Model):
    id = primary_key("NotificationDestination")
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))
    org = db.relationship(Organization, backref="notification_destinations")
    user_id = Column(key_type("User"), db.ForeignKey("users.id"))
    user = db.relationship(User, backref="notification_destinations")
    name = Column(db.String(255))
    type = Column(db.String(255))
    options = Column(
        "encrypted_options",
        ConfigurationContainer.as_mutable(
            EncryptedConfiguration(db.Text, settings.DATASOURCE_SECRET_KEY, FernetEngine)
        ),
    )
    created_at = Column(db.DateTime(True), default=db.func.now())

    __tablename__ = "notification_destinations"
    __table_args__ = (db.Index("notification_destinations_org_id_name", "org_id", "name", unique=True),)

    def __str__(self):
        return str(self.name)

    def to_dict(self, all=False):
        d = {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "icon": self.destination.icon(),
        }

        if all:
            schema = get_configuration_schema_for_destination_type(self.type)
            self.options.set_schema(schema)
            d["options"] = self.options.to_dict(mask_secrets=True)

        return d

    @property
    def destination(self):
        return get_destination(self.type, self.options)

    @classmethod
    def all(cls, org):
        notification_destinations = cls.query.filter(cls.org == org).order_by(cls.id.asc())

        return notification_destinations

    def notify(self, alert, query, user, new_state, app, host, metadata):
        schema = get_configuration_schema_for_destination_type(self.type)
        self.options.set_schema(schema)
        return self.destination.notify(alert, query, user, new_state, app, host, metadata, self.options)


@generic_repr("id", "user_id", "destination_id", "alert_id")
class AlertSubscription(TimestampMixin, db.Model):
    id = primary_key("AlertSubscription")
    user_id = Column(key_type("User"), db.ForeignKey("users.id"))
    user = db.relationship(User)
    destination_id = Column(
        key_type("NotificationDestination"), db.ForeignKey("notification_destinations.id"), nullable=True
    )
    destination = db.relationship(NotificationDestination)
    alert_id = Column(key_type("Alert"), db.ForeignKey("alerts.id"))
    alert = db.relationship(Alert, back_populates="subscriptions")

    __tablename__ = "alert_subscriptions"
    __table_args__ = (
        db.Index(
            "alert_subscriptions_destination_id_alert_id",
            "destination_id",
            "alert_id",
            unique=True,
        ),
    )

    def to_dict(self):
        d = {"id": self.id, "user": self.user.to_dict(), "alert_id": self.alert_id}

        if self.destination:
            d["destination"] = self.destination.to_dict()

        return d

    @classmethod
    def all(cls, alert_id):
        return AlertSubscription.query.join(User).filter(AlertSubscription.alert_id == alert_id)

    def notify(self, alert, query, user, new_state, app, host, metadata):
        if self.destination:
            return self.destination.notify(alert, query, user, new_state, app, host, metadata)
        else:
            # User email subscription, so create an email destination object
            config = {"addresses": self.user.email}
            schema = get_configuration_schema_for_destination_type("email")
            options = ConfigurationContainer(config, schema)
            destination = get_destination("email", options)
            return destination.notify(alert, query, user, new_state, app, host, metadata, options)


@generic_repr("id", "trigger", "user_id", "org_id")
class QuerySnippet(TimestampMixin, db.Model, BelongsToOrgMixin):
    id = primary_key("QuerySnippet")
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))
    org = db.relationship(Organization, backref="query_snippets")
    trigger = Column(db.String(255), unique=True)
    description = Column(db.Text)
    user_id = Column(key_type("User"), db.ForeignKey("users.id"))
    user = db.relationship(User, backref="query_snippets")
    snippet = Column(db.Text)

    __tablename__ = "query_snippets"

    @classmethod
    def all(cls, org):
        return cls.query.filter(cls.org == org)

    def to_dict(self):
        d = {
            "id": self.id,
            "trigger": self.trigger,
            "description": self.description,
            "snippet": self.snippet,
            "user": self.user.to_dict(),
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }

        return d


def init_db():
    default_org = Organization(name="Default", slug="default", settings={})
    admin_group = Group(
        name="admin",
        permissions=Group.ADMIN_PERMISSIONS,
        org=default_org,
        type=Group.BUILTIN_GROUP,
    )
    default_group = Group(
        name="default",
        permissions=Group.DEFAULT_PERMISSIONS,
        org=default_org,
        type=Group.BUILTIN_GROUP,
    )

    db.session.add_all([default_org, admin_group, default_group])
    # XXX remove after fixing User.group_ids
    db.session.commit()
    return default_org, admin_group, default_group
