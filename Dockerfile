# minecraft-rcon-mcp у контейнері: MCP-сервер по stdio (docker run -i). Потрібен
# каталогам MCP (m8ven, Glama тощо), які збирають образ і перевіряють,
# що сервер стартує й віддає список інструментів.
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

ENTRYPOINT ["node", "src/server.js"]
