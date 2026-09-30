# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV HOST=127.0.0.1
ENV PORT=5173
# wrangler dev --local passes a client-supplied CF-Connecting-IP through, so no
# header is trusted by default. Behind a proxy that overwrites one, set it
# (e.g. TRUSTED_IP_HEADER=x-real-ip); see README "Client IP and rate limits".
ENV TRUSTED_IP_HEADER=none
# The image carries no .env; without this Miniflare ignores the container env.
ENV CLOUDFLARE_INCLUDE_PROCESS_ENV=true
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
  && mkdir -p /data .wrangler .sites-runtime \
  && chown -R node:node /data .wrangler .sites-runtime dist
# Run as the unprivileged image user; only state dirs are writable.
USER node
EXPOSE 5173
VOLUME ["/data"]
# Inside the container bind 0.0.0.0 (127.0.0.1 is unreachable through the port map);
# docker-compose publishes it on the host's 127.0.0.1 only.
CMD ["sh", "-c", "node scripts/db-migrate.mjs && node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .wrangler/state --ip 0.0.0.0 --port 5173 --inspector-port 0"]
