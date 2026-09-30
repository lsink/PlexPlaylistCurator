# -------------------------------------------------------------
# Stage 1: Build Application
# -------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++ gcc

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# -------------------------------------------------------------
# Stage 2: Production Image
# -------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=32500
ENV DATA_DIR=/data

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ gcc

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built distribution files
COPY --from=builder /app/dist ./dist

# Create persistent data volume directory
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 32500

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:32500/health || exit 1

CMD ["node", "dist/server/index.js"]
