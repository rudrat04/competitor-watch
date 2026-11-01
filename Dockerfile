# Outflank — run the CLI against a mounted folder holding competitors.yaml and data/.
#
#   docker build -t outflank .
#   docker run --rm --env-file .env -v "$PWD:/work" outflank run
#
# Playwright (for pages with `render: true`) is not included by default, to keep the image
# small. To include it:
#   docker build --build-arg INSTALL_PLAYWRIGHT=true -t outflank .

# ---- build: compile TypeScript, then drop dev dependencies ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# ---- runtime ----
FROM node:20-slim
ARG INSTALL_PLAYWRIGHT=false
ENV NODE_ENV=production
# Shared browser location, so a --user run still finds Chromium.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prompts ./prompts
COPY LICENSE README.md ./
RUN if [ "$INSTALL_PLAYWRIGHT" = "true" ]; then \
      npm install --no-save --ignore-scripts playwright \
      && npx --no-install playwright install --with-deps chromium \
      && rm -rf /root/.npm /var/lib/apt/lists/*; \
    fi
# The working directory is the mounted project folder: competitors.yaml in, data/ out.
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["--help"]
