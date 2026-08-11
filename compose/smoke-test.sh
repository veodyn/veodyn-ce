#!/usr/bin/env bash
# Destroy every container and volume this stack owns, build it again, and prove it
# came up. This is the check that matters for compose.yaml: a stack that only works
# because a volume already had data in it looks identical to a working one until
# someone clones the repository.
#
#     ./compose/smoke-test.sh
#
# What "from nothing" means here, precisely, because the honest version is narrower
# than it sounds: every container, every named volume and every database is deleted
# and recreated, and every secret and seeded account is generated again. Docker's
# image layers and build cache are NOT cleared, and the build does not `--pull`, so
# base images stay at whatever tag digest is already local. A first boot on a clean
# machine still exercises paths this does not: a changed upstream base image, and a
# Dockerfile step whose cached layer is stale. Run `docker compose build --no-cache
# --pull` first if that is what you need to test.
#
# It runs `docker compose down -v`, so it DELETES the project's databases. Which
# project is printed before anything is removed, because the name is shared across
# checkouts by default: two clones or worktrees both answer to `veodyn` unless one
# of them sets VEODYN_PROJECT_NAME (or COMPOSE_PROJECT_NAME, or passes -p), and
# running this in one of them would otherwise silently destroy the other's data.
#
# Host ports come from the same variables compose.yaml reads, so
# `VEODYN_REDASH_PORT=5011 ./compose/smoke-test.sh` tests a stack moved out of
# the way of something already listening.
set -euo pipefail

cd "$(dirname "$0")/.."

ADMIN_EMAIL="${VEODYN_ADMIN_EMAIL:-admin@example.com}"
APP_PORT="${VEODYN_APP_PORT:-3000}"
API_PORT="${VEODYN_API_PORT:-8090}"
REDASH_PORT="${VEODYN_REDASH_PORT:-5001}"
CLICKHOUSE_PORT="${VEODYN_CLICKHOUSE_PORT:-8123}"
HEALTH_TIMEOUT="${VEODYN_HEALTH_TIMEOUT:-600}"

SETTLE="${VEODYN_SETTLE:-20}"

# Services that declare a healthcheck, in the order they are expected to go
# green. The one-shot bootstrap services are not here: compose already refuses
# to start their dependents unless they exited 0.
HEALTHCHECKED=(postgres redis clickhouse email server api app)

# Background consumers. They have no healthcheck to wait on because they serve
# no port, so nothing above covers them, and `restart: unless-stopped` means a
# crash loop looks like a container that exists. Every healthchecked service
# still goes green while both restart forever, which is a stack where queries
# never run and schedules never fire, reporting itself as Passed. Asserted below
# instead.
#
# api-worker was the third of these until the KPI job moved to the enterprise
# pack. A community stack has no worker to watch; an enterprise one composes the
# service back in and this list is the place to add it.
BACKGROUND=(scheduler worker)

compose() { docker compose "$@"; }

step() { printf '\n=== %s\n' "$1"; }

fail() {
	printf '\nSMOKE TEST FAILED: %s\n' "$1" >&2
	printf '\n--- docker compose ps ---\n' >&2
	compose ps --all >&2 || true
	exit 1
}

wait_healthy() {
	local service=$1 deadline=$((SECONDS + HEALTH_TIMEOUT)) cid status
	while ((SECONDS < deadline)); do
		cid=$(compose ps -q "$service" 2>/dev/null || true)
		if [[ -n $cid ]]; then
			status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")
			case $status in
			healthy)
				printf '  %-12s healthy after %ss\n' "$service" "$SECONDS"
				return 0
				;;
			exited | dead)
				compose logs --tail 40 "$service" >&2 || true
				fail "$service exited before becoming healthy"
				;;
			esac
		fi
		sleep 3
	done
	compose logs --tail 40 "$service" >&2 || true
	fail "$service never became healthy within ${HEALTH_TIMEOUT}s"
}

background_state() {
	# RestartCount is top level, not under .State, where it looks like it belongs. Ask
	# for the wrong one and `docker inspect` fails the whole template with "map has no
	# entry for key", which is at least loud.
	docker inspect -f '{{.State.Running}} {{.State.Restarting}} {{.RestartCount}}' "$1"
}

# Two samples, $SETTLE apart. One sample cannot tell a healthy consumer from a
# container caught mid-restart, and RestartCount alone cannot tell a loop that
# started before the sample from one that never happened, so the check is: it
# is running now, it is not restarting now, and nothing about it moved while we
# watched.
assert_stays_up() {
	local service=$1 before=$2 cid after running restarting restarts
	cid=$3
	after=$(background_state "$cid")
	read -r running restarting restarts <<<"$after"
	if [[ $running != true || $restarting == true ]]; then
		compose logs --tail 40 "$service" >&2 || true
		fail "$service is not running (running=$running restarting=$restarting restarts=$restarts)"
	fi
	if [[ $after != "$before" ]]; then
		compose logs --tail 40 "$service" >&2 || true
		fail "$service restarted during the ${SETTLE}s window: '$before' became '$after'"
	fi
	if ((restarts > 0)); then
		compose logs --tail 40 "$service" >&2 || true
		fail "$service has restarted $restarts time(s), so it is not staying up"
	fi
	printf '  %-12s running, 0 restarts, steady over %ss\n' "$service" "$SETTLE"
}

assert_http() {
	local label=$1 url=$2 expect=$3 body
	body=$(curl -fsS --max-time 20 "$url") || fail "$label did not answer at $url"
	if [[ $body != *"$expect"* ]]; then
		fail "$label answered at $url but the body did not contain '$expect'"
	fi
	printf '  %-28s %s\n' "$label" "OK"
}

step "About to destroy this project, and only this project"
# Asked of compose rather than reconstructed here, so it reflects whichever of
# -p, COMPOSE_PROJECT_NAME and VEODYN_PROJECT_NAME actually won. The canonical
# config always opens with an unindented top-level `name:`.
project=$(compose config | awk '/^name:/ {print $2; exit}')
printf '  project    %s\n' "${project:-unknown}"
printf '  containers %s\n' "$(compose ps -aq | wc -l | tr -d ' ')"
printf '  volumes    %s\n' "$(docker volume ls -q --filter "label=com.docker.compose.project=${project}" | tr '\n' ' ')"
cat <<WARNING
  Every database above is deleted. If another checkout of this repository uses
  the same project name, that is its data too: set VEODYN_PROJECT_NAME there.
WARNING
if [[ -t 0 && -z ${VEODYN_SMOKE_YES:-} ]]; then
	read -rp "  Continue? [y/N] " answer
	[[ $answer == [yY]* ]] || fail "cancelled before anything was destroyed"
fi

step "Destroying the existing stack and its volumes"
compose down -v --remove-orphans

step "Confirming nothing survived"
if [[ -n $(compose ps -aq) ]]; then
	fail "containers still exist after 'down -v'"
fi
printf '  no containers, no volumes\n'

step "Building and starting from nothing"
compose up -d --build

step "Waiting for health"
for service in "${HEALTHCHECKED[@]}"; do
	wait_healthy "$service"
done

step "Asserting the bootstrap ran"
compose ps --all --format '{{.Service}}\t{{.Status}}' | sort

for one_shot in init-secrets redash-bootstrap api-migrate; do
	code=$(docker inspect -f '{{.State.ExitCode}}' "$(compose ps -aq "$one_shot")")
	[[ $code == 0 ]] || fail "$one_shot exited $code"
	printf '  %-18s exited 0\n' "$one_shot"
done

step "Asserting the background services are up and staying up"
background_cids=()
background_before=()
for service in "${BACKGROUND[@]}"; do
	cid=$(compose ps -aq "$service" 2>/dev/null || true)
	[[ -n $cid ]] || fail "$service has no container, so it never started"
	background_cids+=("$cid")
	background_before+=("$(background_state "$cid")")
done
printf '  watching %s for %ss\n' "${BACKGROUND[*]}" "$SETTLE"
sleep "$SETTLE"
for i in "${!BACKGROUND[@]}"; do
	assert_stays_up "${BACKGROUND[$i]}" "${background_before[$i]}" "${background_cids[$i]}"
done

step "Asserting the services answer"
assert_http "frontend /api/health_check" "http://localhost:${APP_PORT}/api/health_check" '"status":"ok"'
assert_http "frontend /login" "http://localhost:${APP_PORT}/login" "<html"
assert_http "veodyn-api /health" "http://localhost:${API_PORT}/health" "ok"
assert_http "redash /ping" "http://localhost:${REDASH_PORT}/ping" "PONG"
# From the host, on purpose. Every other check on ClickHouse in this stack runs
# inside its container, and the one failure this catches is invisible from
# there: the image restricts the `default` user to ::1 and 127.0.0.1 unless the
# user setup is skipped, so a container-local probe connects from an allowlisted
# address and passes while every client on the compose network gets a 401. That
# state is a green stack with no historical capture and an empty Data Catalog.
assert_http "clickhouse over the network" "http://localhost:${CLICKHOUSE_PORT}/?query=SELECT+1" "1"

step "Asserting veodyn-api's Alembic schema is at head"
compose exec -T api uv run --no-dev alembic current 2>/dev/null | grep -q "(head)" ||
	fail "veodyn-api's database is not at the head revision"
printf '  alembic current is at head\n'

step "Asserting the seeded accounts and API keys work"
# Its own container, not `exec api`: the api container mounts only the service
# account's key, and this has to read both.
compose run --rm --no-deps verify-seed || fail "the seeded API keys did not verify"

step "Asserting the seeded admin can sign in through the frontend"
# The whole chain in one request: the frontend's login route fetches a CSRF
# token from Redash, posts the form, and reads the session back. A stack that
# answers /api/health_check but cannot sign anyone in is not a working stack.
# The password is recovered from the bootstrap container's log and is never
# printed here.
admin_password=$(compose logs redash-bootstrap 2>/dev/null | sed -n 's/.*password: *//p' | tail -1 | tr -d '\r ')
if [[ -z $admin_password ]]; then
	printf '  skipped: VEODYN_ADMIN_PASSWORD was supplied, so none was printed to recover\n'
else
	login_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 \
		-X POST "http://localhost:${APP_PORT}/api/auth/login" \
		-H 'Content-Type: application/json' \
		--data "$(printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$admin_password")")
	[[ $login_code == 200 ]] || fail "signing in as the seeded admin returned HTTP $login_code"
	printf '  the frontend signed %s in\n' "$ADMIN_EMAIL"
fi

step "Passed"
cat <<SUMMARY
  frontend    http://localhost:${APP_PORT}
  redash      http://localhost:${REDASH_PORT}
  veodyn-api  http://localhost:${API_PORT}

  The generated admin sign-in was printed once, on first boot:
    docker compose logs redash-bootstrap
SUMMARY
