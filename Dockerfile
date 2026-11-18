# Analyzer: Bun server plus the built Svelte client.
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun x vite build

FROM oven/bun:1.4.4-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3210 DATA_DIR=/state BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist dist
COPY server server
USER bun
EXPOSE 3210
CMD ["bun", "server/index.ts"]
