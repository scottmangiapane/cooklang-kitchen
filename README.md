# Cooklang Kitchen

A small, read-only Cooklang recipe browser for a folder of `.cook` files. A lightweight Python server parses the files and serves a static HTML/CSS/JavaScript frontend. There is no database, account, write access to recipes, frontend build step, or icon CDN.

## Start

Place recipe files in `./recipes`, then run:

```sh
docker compose up -d --build
```

Open <http://127.0.0.1:8080>.

The default Compose setup binds only to loopback, mounts `./recipes` read-only at `/recipes`, and stores generated thumbnails in the persistent `image-cache` named volume. The container always listens on port `8080`; change the published port in Compose rather than setting a `PORT` environment variable.

```sh
docker compose logs -f
docker compose down
```

## Deployment-specific overrides

Keep local deployment customizations in `compose.override.yaml`; Docker Compose automatically merges it after `compose.yaml`. This file is ignored by Git so local port, volume, and user changes won't conflict with updates to the base configuration. A blank local override is included in this archive; edit it directly. On a fresh checkout where it does not exist, start from `compose.override.yaml.example`.

For example, to publish port `3000` on loopback, add this to `compose.override.yaml` and keep the `!override` tag so it replaces (rather than appends to) the base published port:

```yaml
services:
  cooklang-kitchen:
    ports: !override
      - "127.0.0.1:3000:8080"
```

The example file also shows how to replace the recipes bind mount, put the image cache in a host directory, and set `user: "1000:1000"`. The `!override` YAML tag for ports requires Docker Compose v2.24.4 or newer. If you bind-mount a host cache directory, make it writable by the configured container UID/GID. The container image's default cache directory is writable when using the named volume.

## Cooklang support

The parser handles leading YAML front matter (including list-valued tags), ingredient references (`@`), quantities/units (`{amount%unit}`), optional ingredients (`@?`), preparation text (`(...)`), cookware (`#`), timers (`~`), blank-line-delimited steps, section headings (`= Section` / `== Section ==`), notes (`>`), line comments (`--`) and block comments (`[- ... -]`). It tolerates invalid YAML, malformed token markup, unreadable files, and per-file parse failures without taking down the library. It is a focused recipe browser, not a complete replacement for Cooklang's reference tooling; obscure or future syntax may be shown as ordinary text.

## Recipe photos and performance

Photos are optional. Place a photo next to a recipe using the same base filename, for example `Chicken Piccata.cook` and `Chicken Piccata.jpg`, or specify a relative `photo:`/`image:` path in YAML front matter:

```yaml
photo: photos/chicken-piccata.webp
```

JPG/JPEG, PNG, WebP, AVIF, and GIF are recognized. Pillow generates WebP variants the first time each photo is requested: smaller thumbnails for recipe cards (up to 640 × 440) and larger images for recipe pages (up to 1440 × 1200). Variants are saved in the `image-cache` volume, so repeat visits don't repeatedly decode or resize large originals. The originals remain untouched, and the recipes mount remains read-only. GIFs are represented by their first frame.

The cache checks the source file's modification timestamp and size. If either changes, the cached variant is regenerated. Image URLs include the same source signature so browsers don't keep showing an older cached version after a refresh. If an image format cannot be decoded by Pillow or an image is corrupt, the app falls back to serving the original file instead of breaking the recipe page.

If recipes or images are removed, their cached thumbnails may remain in the cache volume until it is manually cleared. Removing the volume with `docker compose down -v` clears the entire thumbnail cache as well as other project volumes; ordinary `docker compose down` preserves it.

## Recipe scaling and keyboard shortcut

Use the plus/minus serving control on a recipe page to scale ingredient quantities in both the ingredient list and each step's ingredient chips. Common integers, decimals, fractions, mixed fractions, and numeric ranges are scaled; descriptive quantities such as `as needed` are left unchanged. If the source doesn't specify a yield, the control uses a two-serving starting baseline and labels that the original yield wasn't specified.

Press `/` while not focused on a text field to move focus to recipe search. Press `Escape` while search is focused to clear it.

The interface uses locally embedded Lucide icons under the ISC license and works without an icon CDN. The page uses Google Fonts when internet access is available, with system-font fallbacks otherwise.
