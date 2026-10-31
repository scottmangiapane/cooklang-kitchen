FROM node:22.23.4-alpine3.24

ENV RECIPES_DIR=/recipes \
    IMAGE_CACHE_DIR=/image-cache \
    RECIPE_CACHE_DIR=/recipe-cache

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && mkdir -p /image-cache /recipe-cache \
    && chown -R node:node /app /image-cache /recipe-cache

COPY server.mjs path-security.mjs recipe-urls.mjs ./
COPY static ./static

EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
