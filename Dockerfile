FROM node:22-alpine

ENV RECIPES_DIR=/recipes \
    IMAGE_CACHE_DIR=/image-cache \
    RECIPE_CACHE_DIR=/recipe-cache

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && mkdir -p /image-cache /recipe-cache \
    && chown -R node:node /app /image-cache /recipe-cache

COPY server.mjs parse_recipes.mjs ./
COPY static ./static

EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
