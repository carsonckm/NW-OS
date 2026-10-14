# NW OS application image (Cloud Run, or any container host). See docs/staging.md.
#   docker build -t nwos .
# The same image runs the web server (default command) and, as a separate job, the release
# step: node dist/tools/db-migrate.cjs (with DATABASE_MIGRATION_URL, never given to the server).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/db ./db
USER node
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
