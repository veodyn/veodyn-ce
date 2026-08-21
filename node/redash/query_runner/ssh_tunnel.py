from contextlib import ExitStack
from functools import wraps

from sshtunnel import open_tunnel

from redash import settings


def with_ssh_tunnel(query_runner, details):
    def tunnel(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            try:
                remote_host, remote_port = query_runner.host, query_runner.port
            except NotImplementedError:
                raise NotImplementedError("SSH tunneling is not implemented for this query runner yet.")

            stack = ExitStack()
            try:
                bastion_address = (details["ssh_host"], details.get("ssh_port", 22))
                remote_address = (remote_host, remote_port)
                auth = {
                    "ssh_username": details["ssh_username"],
                    **settings.dynamic_settings.ssh_tunnel_auth(),
                }
                server = stack.enter_context(open_tunnel(bastion_address, remote_bind_address=remote_address, **auth))
            except Exception as error:
                raise type(error)("SSH tunnel: {}".format(str(error)))

            with stack:
                try:
                    query_runner.host, query_runner.port = server.local_bind_address
                    result = f(*args, **kwargs)
                finally:
                    query_runner.host, query_runner.port = remote_host, remote_port

                return result

        return wrapper

    query_runner.run_query = tunnel(query_runner.run_query)

    return query_runner
