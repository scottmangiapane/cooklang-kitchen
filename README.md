<p align="center">
  <img src="static/logo.svg" width="140" alt="Cooklang Kitchen">
</p>

<p align="center">A lightweight, self-hosted browser for Cooklang recipes.</p>

## Screenshots

![demo](/screenshots/main-page.png)
![demo](/screenshots/recipe-page.png)

## Run it

1. Put recipe files in `./recipes`. Files ending in `.cook`, `.txt`, and `.cook.txt` are supported.
2. Start the app:

   ```sh
   docker compose up -d --build
   ```

3. Open <http://127.0.0.1:8080>.

The app listens on port `8080` inside the container. Compose publishes it on the host's loopback interface by default. Recipes are mounted read-only.

## Configure deployment

Keep machine-specific changes in `compose.override.yaml`; Docker Compose merges it automatically, and Git ignores it. Copy the example to get started:

```sh
cp compose.override.yaml.example compose.override.yaml
```

The example publishes on <http://127.0.0.1:3000>. You can also change the recipe mount, image-cache and recipe-cache mounts, or container user in the override. The `!override` port syntax requires Docker Compose v2.24.4 or later.

Useful commands:

```sh
docker compose logs -f
docker compose down
```

## Recipes and photos

The backend runs entirely on Node.js. Recipe syntax is parsed by the official [`@cooklang/cooklang`](https://www.npmjs.com/package/@cooklang/cooklang) package, which uses the Rust parser from [`cooklang-rs`](https://github.com/cooklang/cooklang-rs). YAML front matter is handled by `js-yaml`; parsed recipe data is cached on disk in the `recipe-cache` Docker volume and reused until a source file changes. Ordinary home-page loads scan recipe file metadata without reparsing unchanged recipes. A malformed recipe does not prevent other recipes from loading.

Cooklang front matter and the app's Markdown blockquote notes are handled around the official parser. Photos are optional: put an image beside a recipe with the same base name, or set `photo:`/`image:` to a relative path in front matter. JPG, PNG, WebP, AVIF, and GIF are supported. Sharp generates cached WebP thumbnails for recipe cards and detail pages in the `image-cache` Docker volume; originals remain unchanged, and thumbnails are refreshed when source images change. GIF thumbnails use the first frame. Parsed recipe data lives separately from image thumbnails, so the caches can be managed independently.

On a recipe page, use the serving controls to scale ingredient quantities in the list and in each instruction step. Press `/` to focus search, or `Escape` to clear it.
