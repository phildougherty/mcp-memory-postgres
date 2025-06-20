FROM node:22.12-alpine AS builder

# Install PostgreSQL client for health checks
RUN apk add --no-cache postgresql-client

COPY package.json package-lock.json tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

RUN npm ci
RUN npm run build

FROM node:22-alpine AS release

# Install PostgreSQL client
RUN apk add --no-cache postgresql-client

COPY --from=builder /dist /app/dist
COPY --from=builder /package.json /app/package.json
COPY --from=builder /package-lock.json /app/package-lock.json
COPY --from=builder /migrations /app/migrations

ENV NODE_ENV=production
WORKDIR /app

RUN npm ci --ignore-scripts --omit-dev

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD pg_isready -h ${POSTGRES_HOST:-localhost} -p ${POSTGRES_PORT:-5432} || exit 1

ENTRYPOINT ["node", "dist/index.js"]
