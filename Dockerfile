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
RUN npm run build -w packages/client && npm run build -w packages/server

# The runtime needs no node_modules: the server is one esbuild bundle (phase 19b), next to the levels and the client.
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY levels levels
COPY packages/server/package.json packages/server/
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
USER node
EXPOSE 2567
# The same as `npm run start:prod`, without npm in between (so SIGTERM reaches the server).
CMD ["node", "packages/server/dist/server.js", "--prod"]
