#!/bin/sh
# Render tests for the veodyn-api chart's guards.
#
# A `helm template` that succeeds proves a chart parses. What this checks is the
# opposite half: that each refusal fires on the values it is written to refuse,
# and does not fire on the values it is written to allow. Every guard in this
# chart was added without one of these, and every one of them turned out to be
# checking something other than what its message claimed.
#
# Run it from the repository root:
#
#     scripts/check-helm-render.sh
#
# It needs `helm` and nothing else. ci/helm-render-test.yaml runs it.

set -eu

CHART="helm/charts/veodyn-api"
MODULE="veodyn_enterprise.registration"
FAILURES=0
CHECKS=0

if [ ! -f "$CHART/Chart.yaml" ]; then
	echo "run this from the repository root: $CHART/Chart.yaml not found" >&2
	exit 2
fi

# `helm template` with a throwaway release name and appName=app, which is what
# every release of this chart is installed with. Output goes to a file so a
# passing case can be grepped afterwards.
render() {
	helm template render "$CHART" --set appName=app "$@" >/tmp/helm-render.out 2>/tmp/helm-render.err
}

pass() {
	CHECKS=$((CHECKS + 1))
	printf 'ok   %s\n' "$1"
}

fail() {
	CHECKS=$((CHECKS + 1))
	FAILURES=$((FAILURES + 1))
	printf 'FAIL %s\n' "$1"
	sed 's/^/       /' /tmp/helm-render.err
}

# renders <description> <helm args...>
renders() {
	description="$1"
	shift
	if render "$@"; then
		pass "renders: $description"
	else
		fail "renders: $description"
	fi
}

# refuses <description> <expected substring of the message> <helm args...>
refuses() {
	description="$1"
	expected="$2"
	shift 2
	if render "$@"; then
		CHECKS=$((CHECKS + 1))
		FAILURES=$((FAILURES + 1))
		printf 'FAIL refuses: %s -- it rendered instead\n' "$description"
	elif grep -qF "$expected" /tmp/helm-render.err; then
		pass "refuses: $description"
	else
		fail "refuses: $description -- refused, but not with the expected message"
	fi
}

# contains <description> <expected substring of the rendered manifest> <helm args...>
contains() {
	description="$1"
	expected="$2"
	shift 2
	if ! render "$@"; then
		fail "contains: $description -- it did not render at all"
	elif grep -qF "$expected" /tmp/helm-render.out; then
		pass "contains: $description"
	else
		CHECKS=$((CHECKS + 1))
		FAILURES=$((FAILURES + 1))
		printf 'FAIL contains: %s -- %s is not in the rendered manifest\n' "$description" "$expected"
	fi
}

# --- the pairing guard on the migrating release -----------------------------
#
# Both probes from the review are in here as the first two cases: the module in
# baseEnv was refused, and an empty string was accepted.

EE="--set app.runMigrations=true --set app.runEnterpriseMigrations=true"

# shellcheck disable=SC2086
renders "the module in app.env" $EE --set app.env.VEODYN_EXTRA_MODULES="$MODULE"

# shellcheck disable=SC2086
renders "the module in app.baseEnv, which the pod gets too" $EE \
	--set app.baseEnv.VEODYN_EXTRA_MODULES="$MODULE"

# shellcheck disable=SC2086
renders "the module among others in a comma-separated list" $EE \
	--set "app.env.VEODYN_EXTRA_MODULES=some.other.pack\\,$MODULE"

# shellcheck disable=SC2086
renders "the module in app.baseEnv with an unrelated app.env present" $EE \
	--set app.baseEnv.VEODYN_EXTRA_MODULES="$MODULE" --set app.env.LOGGING_LEVEL=DEBUG

# shellcheck disable=SC2086
refuses "an empty VEODYN_EXTRA_MODULES" 'the effective value is ""' $EE \
	--set app.env.VEODYN_EXTRA_MODULES=""

# shellcheck disable=SC2086
refuses "a VEODYN_EXTRA_MODULES naming some other pack" "some.other.pack" $EE \
	--set app.env.VEODYN_EXTRA_MODULES="some.other.pack"

# A prefix of the module name is not the module name. This is the case a
# substring check passes and a membership check does not.
# shellcheck disable=SC2086
refuses "a module name the real one is a prefix of" "does not name" $EE \
	--set app.env.VEODYN_EXTRA_MODULES="${MODULE}_disabled"

# shellcheck disable=SC2086
refuses "no VEODYN_EXTRA_MODULES anywhere" "neither app.env nor app.baseEnv sets it" $EE

refuses "the module without runEnterpriseMigrations" "runEnterpriseMigrations is false" \
	--set app.runMigrations=true --set app.env.VEODYN_EXTRA_MODULES="$MODULE"

# The guard must not fire on a release that is not the migrating one. An
# enterprise deployment has several of those and every one of them carries the
# module and no migration keys.
renders "the module on a non-migrating release" --set app.env.VEODYN_EXTRA_MODULES="$MODULE"

renders "a community migrating release" --set app.runMigrations=true

# --- what the migrate hook actually runs ------------------------------------

contains "the community hook runs one chain" 'command: ["uv", "run", "--no-dev", "alembic", "upgrade", "head"]' \
	--set app.runMigrations=true

# shellcheck disable=SC2086
contains "the enterprise hook runs the preflight before either chain" \
	"veodyn_enterprise.migrate preflight && uv run --no-dev alembic upgrade head" $EE \
	--set app.env.VEODYN_EXTRA_MODULES="$MODULE"

# --- baseEnv reaches the pod ------------------------------------------------
#
# The half that made accepting baseEnv safe. Gated on `env` alone, a release
# with an empty env rendered no env block at all, so a guard that read baseEnv
# would have been approving a pod that never saw the variable.

contains "baseEnv reaches the Deployment with no app.env at all" "VEODYN_EXTRA_MODULES" \
	--set app.baseEnv.VEODYN_EXTRA_MODULES="$MODULE"

# --- the shipped example values still render --------------------------------

renders "the example values files, as their header documents" \
	-f "$CHART/values.example.yaml" -f "$CHART/values.example-api.yaml"

# --- the validator chart ----------------------------------------------------
#
# One invariant here matters more than the rest, and it is why this section
# exists rather than trusting `helm template` to exit 0: the validator must
# never be reachable from outside the cluster. It authenticates nobody, and one
# request makes it download a URL of the caller's choosing and spend about 48
# seconds and several gigabytes on it. Adding an Ingress later would be a
# one-line change with nothing failing anywhere, which is the shape of every
# mistake the rest of this file was written for.

VALIDATOR_CHART="helm/charts/veodyn-validator"

validator_render() {
	helm template render "$VALIDATOR_CHART" --set appName=app \
		-f "$VALIDATOR_CHART/values.example.yaml" \
		>/tmp/helm-render.out 2>/tmp/helm-render.err
}

# validator_lacks <description> <substring that must NOT appear>
validator_lacks() {
	description="$1"
	forbidden="$2"
	if ! validator_render; then
		fail "validator: $description -- it did not render at all"
	elif grep -qF "$forbidden" /tmp/helm-render.out; then
		CHECKS=$((CHECKS + 1))
		FAILURES=$((FAILURES + 1))
		printf 'FAIL validator: %s -- %s is in the rendered manifest\n' "$description" "$forbidden"
	else
		pass "validator: $description"
	fi
}

# validator_contains <description> <substring that must appear>
validator_contains() {
	description="$1"
	expected="$2"
	if ! validator_render; then
		fail "validator: $description -- it did not render at all"
	elif grep -qF "$expected" /tmp/helm-render.out; then
		pass "validator: $description"
	else
		CHECKS=$((CHECKS + 1))
		FAILURES=$((FAILURES + 1))
		printf 'FAIL validator: %s -- %s is not in the rendered manifest\n' "$description" "$expected"
	fi
}

validator_lacks "renders no Ingress, so nothing outside the cluster can reach it" "kind: Ingress"
validator_contains "renders its Service as ClusterIP" "type: ClusterIP"
validator_contains "renders one replica, because each holds its own prepared archive" "replicas: 1"
validator_lacks "renders no migrate Job, having no database" "kind: Job"
validator_contains "binds the port its readiness probe checks" "containerPort: 8000"
# Empty here renders no imagePullSecrets at all, every node fails the pull with
# "no basic auth credentials", and the deploy job still reports success because
# helm --wait times out on readiness rather than on the pull. That is what the
# first deploy of this chart did.
validator_contains "carries an imagePullSecrets block at all" "imagePullSecrets"

# --- the API actually points at the validator -------------------------------
#
# `VEODYN_FEED_VALIDATOR_URL` is a STRING, and nothing else in either repository
# compares it to the Service the validator chart creates. Get it wrong and the
# deploy is green, the pod is healthy, and every publish attempt records
# `failed` with an unreachable validator, which is indistinguishable at a glance
# from a validator that is simply down. This renders both and checks that the
# host in one is the Service name of the other.
#
# Skipped where helm/envs is absent, which is the community tree: the
# per-environment values are deployment-specific and do not travel there, so
# this check has nothing to compare and says so rather than failing.

ENVS="helm/envs"
if [ ! -d "$ENVS" ]; then
	printf 'skip validator: no %s in this tree, so the API-to-validator link is not checkable here\n' "$ENVS"
elif [ ! -f "$ENVS/veodyn-api-dev/values.yaml" ] || [ ! -f "$ENVS/veodyn-validator-dev/values.yaml" ]; then
	printf 'skip validator: the dev values for one side are missing, so the link is not checkable\n'
else
	VALIDATOR_RELEASE="veodyn-validator-dev-app"
	if helm template "$VALIDATOR_RELEASE" "$VALIDATOR_CHART" --set appName=app \
		--set image=render --set imageTag=check \
		-f "$ENVS/values-base.yaml" -f "$ENVS/values-dev.yaml" \
		-f "$ENVS/veodyn-validator-dev/values.yaml" \
		-f "$ENVS/veodyn-validator-dev/veodyn-validator-app.yaml" \
		>/tmp/helm-render.out 2>/tmp/helm-render.err; then
		# The Service the validator release actually creates, and the port on it.
		if grep -qF "name: $VALIDATOR_RELEASE" /tmp/helm-render.out &&
			grep -qF "port: 8000" /tmp/helm-render.out &&
			grep -qF "http://$VALIDATOR_RELEASE:8000" "$ENVS/veodyn-api-dev/values.yaml"; then
			pass "validator: the dev API's VEODYN_FEED_VALIDATOR_URL names the Service and port the chart creates"
		else
			CHECKS=$((CHECKS + 1))
			FAILURES=$((FAILURES + 1))
			printf 'FAIL validator: the dev API points at a validator Service or port that is not what the chart renders\n'
		fi
	else
		fail "validator: the dev values do not render at all"
	fi
fi

echo
if [ "$FAILURES" -ne 0 ]; then
	echo "$FAILURES of $CHECKS render checks failed"
	exit 1
fi
echo "all $CHECKS render checks passed"
