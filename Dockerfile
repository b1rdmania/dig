# Shared monorepo Dockerfile for dig-api and dig-mcp.
# Usage:
#   fly deploy --config fly.api.toml
#   fly deploy --config fly.mcp.toml

FROM node:20-slim AS base

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

WORKDIR /app

# --- Install dependencies (cached layer) ---
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./

# Copy only package.json files for each workspace package
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/mcp/package.json apps/mcp/

# Install all deps (need devDeps for tsx + typescript)
RUN pnpm install --frozen-lockfile

# --- Copy source ---
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/mcp/ apps/mcp/

# Default: API server. Override CMD in fly.toml for MCP.
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["pnpm", "--filter", "@dig/api", "dev"]
