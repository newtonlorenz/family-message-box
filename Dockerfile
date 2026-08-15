FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/device-core/package.json packages/device-core/package.json
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ARG GIT_REVISION=unknown
LABEL org.opencontainers.image.revision=$GIT_REVISION
RUN apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates \
  && sed -i "s|http://deb.debian.org|https://deb.debian.org|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
    curl \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/admin/dist ./apps/admin/dist
COPY --from=build /app/packages/contracts ./packages/contracts
EXPOSE 8787
CMD ["npm", "start"]
