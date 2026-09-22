FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend

COPY frontend/package.json ./
RUN npm install

COPY frontend ./
RUN npm run build

FROM node:22-alpine AS server-build
WORKDIR /app/server

COPY server/package.json ./
RUN npm install

COPY server/prisma ./prisma
COPY server/prisma.config.ts ./
COPY server/tsconfig.json ./
COPY server/src ./src

ENV DATABASE_URL=postgresql://data_agent:build@127.0.0.1:5432/data_agent
ENV SESSION_SECRET=build-only-session-secret-32-characters-long
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=3000
ENV SERVE_STATIC=true
ENV STATIC_ROOT=./public

COPY server/package.json ./
COPY server/prisma ./prisma
COPY server/prisma.config.ts ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=server-build /app/server/dist ./dist
COPY --from=frontend-build /app/frontend/out ./public

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
