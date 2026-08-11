FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars are inlined at build time. This one is only a truthy
# flag switching the client off mock data (traffic goes through the
# same-origin /api/redash proxy; the actual backend URL is runtime
# REDASH_URL). Default on, so a stock image is a real-backend image; override
# with --build-arg to build a mock image.
#
# It now also decides which fixture pack is bundled: on means none at all, via
# the resolveAlias in next.config.ts. That is why the default matters for size
# and not only for behaviour.
ARG NEXT_PUBLIC_REDASH_URL=1
ENV NEXT_PUBLIC_REDASH_URL=$NEXT_PUBLIC_REDASH_URL
# Selects which mock fixture pack is bundled, and only has an effect on a mock
# image: with NEXT_PUBLIC_REDASH_URL set, neither pack ships. See the
# activePack() selector in next.config.ts and src/lib/mock-data/packs/.
# Default is the neutral pack. NEXT_PUBLIC_DEMO_PACK=la selects the private
# tenant pack, which is not in this repo: only a private tenant overlay build
# (build-overlay.sh, which copies packs/la back onto disk first) can set this,
# and activePack() throws a build error if that pack is missing.
ARG NEXT_PUBLIC_DEMO_PACK=neutral
ENV NEXT_PUBLIC_DEMO_PACK=$NEXT_PUBLIC_DEMO_PACK
# Which visualization plugin packages this image installs, comma-separated
# (see src/plugins/index.ts). Empty by default, which is the stock OSS product:
# the core visualization types and nothing tenant-specific. Build-time and not
# runtime because the bundler has to see the import, so an image built without
# this cannot be given plugins by a pod env var. Admin > Plugins reports what
# actually registered.
ARG NEXT_PUBLIC_VEODYN_PLUGINS=
ENV NEXT_PUBLIC_VEODYN_PLUGINS=$NEXT_PUBLIC_VEODYN_PLUGINS
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
