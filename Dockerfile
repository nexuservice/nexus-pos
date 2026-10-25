# Nexus: una sola imagen con la API y la app web. Sirve igual en Fly.io, Render, Railway o un servidor propio.
FROM node:22-alpine

WORKDIR /app

# 1) Dependencias primero (se reutiliza la capa si solo cambia el código)
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --include=dev

# 2) Código, compilación de la app web y limpieza de lo que solo sirve para compilar
COPY tsconfig.base.json ./
COPY core core
COPY backend backend
COPY frontend frontend
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production \
    PORT=8080 \
    NEXUS_DATA=/data

# Los datos viven en /data: monta ahí un disco persistente (volumen). Sin él, se pierden al reiniciar.
VOLUME ["/data"]
EXPOSE 8080

# Corre como root a propósito: los volúmenes de Fly y Railway se montan con dueño root y un usuario normal no podría escribir.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["npm", "start"]
