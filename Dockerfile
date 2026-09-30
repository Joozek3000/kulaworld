# Flipside game server + client (phase 19, docs/HOSTING.md). One image: the server serves the built client and the rooms.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY tools/bots/package.json tools/bots/
RUN npm ci
COPY . .
RUN npm run build -w packages/client

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY tools/bots/package.json tools/bots/
# Only the server's runtime dependencies (tsx runs the TypeScript sources; no bundler).
RUN npm ci --omit=dev -w packages/server && npm cache clean --force
COPY levels levels
COPY packages/shared/src packages/shared/src
COPY tools/bots/src tools/bots/src
COPY packages/server/src packages/server/src
COPY --from=build /app/packages/client/dist packages/client/dist
USER node
EXPOSE 2567
# The same command as `npm run start:prod`, without npm in between (so SIGTERM reaches the server).
CMD ["node", "--import", "tsx", "packages/server/src/index.ts", "--prod"]
