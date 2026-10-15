# Cooklang Kitchen

A small, read-only recipe browser for a directory of `.cook` files. It uses a lightweight Python HTTP server for file discovery and parsing, with a static HTML/CSS/JavaScript frontend. No database, account, write access, or frontend build step is required. The interface uses locally embedded Lucide icons and works without an icon CDN.

## Start

The provided `compose.yaml` mounts the recipe directory read-only and publishes the app only on loopback at `127.0.0.1:8080`.

```sh
docker compose up -d --build
```

Open <http://127.0.0.1:8080>.

To inspect logs or stop the app:

```sh
docker compose logs -f
docker compose down
```

## Cooklang support

The parser handles leading YAML front matter (including list-valued tags), ingredient references (`@`), quantities/units (`{amount%unit}`), optional ingredients (`@?`), preparation text (`(...)`), cookware (`#`), timers (`~`), blank-line-delimited steps, section headings (`= Section` / `== Section ==`), notes (`>`), line comments (`--`) and block comments (`[- ... -]`). It tolerates invalid YAML, malformed token markup, unreadable files, and per-file parse failures without taking down the library. It is intentionally a focused recipe browser, not a complete replacement for Cooklang's reference tooling; obscure or future syntax may be shown as ordinary text.

## Configuration

Edit the host path on the left side of the bind mount in `compose.yaml` if your Recipes directory moves. The container path should remain `/recipes`. The source mount is `:ro` so the app cannot change recipe files. The app recursively finds `.cook` files, even though a flat folder works too.

## Recipe photos

Photos are optional. The easiest convention is to place a photo next to a recipe using the same base filename, for example `Chicken Piccata.cook` and `Chicken Piccata.jpg`. Supported formats are JPG/JPEG, PNG, WebP, AVIF, and GIF. Alternatively, a recipe's YAML front matter may include a relative `photo:` or `image:` path, for example:

```yaml
photo: photos/chicken-piccata.webp
```

Paths are resolved inside the mounted recipe directory; files outside that directory are not served. The app does not write to the directory. Add or remove photos on the host, then refresh the app.

## Recipe scaling

Use the plus/minus serving control on a recipe page to scale ingredient quantities in both the ingredient list and each step's ingredient chips. Common integers, decimals, fractions, mixed fractions, and numeric ranges are scaled; descriptive quantities such as `as needed` are left unchanged. If the source doesn't specify a yield, the control uses a two-serving starting baseline and labels that the original yield wasn't specified.

Press `/` while not focused on a text field to move focus to recipe search. Press `Escape` while search is focused to clear it.

The page uses Google Fonts when internet access is available, with serif/sans-serif system fallbacks otherwise. Icons are embedded locally from Lucide, so no icon CDN is required.
