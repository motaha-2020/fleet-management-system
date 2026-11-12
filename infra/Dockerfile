# One image per deployable, built from the monorepo (Architecture §3, §11).
#   docker build -f infra/Dockerfile --target api    -t fleet-api .
#   docker build -f infra/Dockerfile --target worker -t fleet-worker .
#   docker build -f infra/Dockerfile --target web    -t fleet-web .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@fleet/api --filter=@fleet/worker --filter=@fleet/web
RUN pnpm --filter=@fleet/api deploy --prod --legacy /out/api \
 && pnpm --filter=@fleet/worker deploy --prod --legacy /out/worker

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api .
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]

FROM node:22-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/worker .
USER node
CMD ["node", "dist/main.js"]

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
