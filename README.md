<p align="center">
  <img src="static/logo.svg" width="140" alt="Cooklang Kitchen">
</p>

<p align="center">A lightweight, self-hosted browser for Cooklang recipes.</p>

## Features

- Browse and search a personal recipe collection, with optional recipe photos and tags.
- Read Cooklang instructions with linked ingredients, cookware, and timers.
- View official Cooklang notes, sections, and recipe front matter.
- Scale ingredient quantities with the serving controls, including the instruction-step ingredient tags and consolidated sidebar list.
- Cache recipe data and optimized photos for faster browsing.

## Parsing and rendering

Cooklang syntax is parsed by the official `@cooklang/cooklang` WASM bindings to `cooklang-rs`. The viewer uses the full parsed recipe returned by `Parser.parse()` for sections, components, quantities, metadata, and scaling. It also asks `Parser.parse_ast()` for the official source-structure AST because the full recipe model intentionally represents both plain text and note blocks as text content. The AST is used only to preserve the parser's `TextBlock` distinction for note styling; there is no second Cooklang parser in the application.

Standard metadata is read from the parser's `raw_metadata` map and interpreted metadata fields, so custom keys and standard fields such as `source`, `prep time`, `cook time`, and `servings` can all reach the UI. The displayed metadata table omits values already surfaced elsewhere on the page.

## Screenshots

![Recipe collection](/screenshots/main-page.png)
![Recipe detail](/screenshots/recipe-page.png)

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

The app supports Cooklang recipes with YAML front matter, sections, notes, ingredients, cookware, and timers. Photos are optional: put an image beside a recipe with the same base name, or set `photo:`/`image:` to a relative path in front matter. JPG, PNG, WebP, AVIF, and GIF are supported.

On a recipe page, use the serving controls to scale ingredient quantities. Press `/` to focus search, or `Escape` to clear it.
