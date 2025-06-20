FROM node:22.12-alpine AS builder
WORKDIR /app

# Install git and PostgreSQL client
RUN apk add --no-cache git postgresql-client

# Copy all source files
COPY . /app

# Install dependencies
RUN --mount=type=cache,target=/root/.npm npm install --ignore-scripts

# Build the project
RUN npm run build

# Make the output executable
RUN chmod +x dist/*.js

FROM node:22-alpine AS release
WORKDIR /app

# Install PostgreSQL client for runtime
RUN apk add --no-cache postgresql-client

# Copy built files and dependencies
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json
COPY --from=builder /app/migrations /app/migrations

ENV NODE_ENV=production

# Install only production dependencies
RUN npm ci --only=production --ignore-scripts

# Expose port for SSE transport
EXPOSE 3001

ENTRYPOINT ["node", "/app/dist/index.js"]