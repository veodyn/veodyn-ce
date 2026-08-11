#!/bin/sh
# First-boot secret generation for the local stack.
#
# Redash refuses to start without REDASH_COOKIE_SECRET, and the value has to be
# the same in the server, the scheduler and the workers, and the same across
# restarts, or every existing session and every stored data-source credential
# stops decrypting. That rules out generating it per container.
#
# It is generated here, into a named volume, rather than written into
# compose.yaml, because this repository is public: a committed default cookie
# secret is a signing key every reader already has. node/Makefile does the same
# thing for the fork's own dev stack (`pwgen -1s 32` into node/.env); this is
# that idea moved inside the stack so no host-side step is needed first.
#
# Idempotent on purpose: a second `docker compose up` must not rotate the keys
# out from under a database that was encrypted with the first ones.
set -eu

DIR="${VEODYN_SECRETS_DIR:-/run/veodyn}"
# One directory per consumer, each a separate volume mounted only into the containers
# that need it (see the volumes section of compose.yaml). This container is one of the
# two that hold all three, because it is the one that creates them.
REDASH_DIR="$DIR/redash"
FRONTEND_DIR="$DIR/frontend"
SERVICE_DIR="$DIR/service"
# uid 1000 is the `redash` user in node/Dockerfile, which is what the seed step
# runs as and needs to be able to write here. Docker creates a fresh volume's mount
# point owned by root, so without this chown the seed cannot write its two key files.
OWNER_UID=1000

random_token() {
	od -An -tx1 -N 24 /dev/urandom | tr -d ' \n'
}

mkdir -p "$REDASH_DIR" "$FRONTEND_DIR" "$SERVICE_DIR"

if [ -f "$REDASH_DIR/redash-secrets.env" ]; then
	echo "init-secrets: redash-secrets.env already present, leaving it alone"
else
	umask 077
	{
		printf 'REDASH_COOKIE_SECRET=%s\n' "$(random_token)"
		printf 'REDASH_SECRET_KEY=%s\n' "$(random_token)"
	} >"$REDASH_DIR/redash-secrets.env"
	echo "init-secrets: generated a cookie secret and a data-source secret key"
fi

for dir in "$REDASH_DIR" "$FRONTEND_DIR" "$SERVICE_DIR"; do
	chown -R "$OWNER_UID" "$dir"
	chmod 700 "$dir"
	# The glob is unquoted so it expands, and guarded because two of the three are
	# still empty at this point: the seed step writes those.
	for env_file in "$dir"/*.env; do
		if [ -f "$env_file" ]; then
			chmod 600 "$env_file"
		fi
	done
done
echo "init-secrets: done"
