# Cooklang Kitchen

A small, read-only recipe browser for a directory of `.cook` files. It uses a lightweight Python HTTP server for file discovery and parsing, with a static HTML/CSS/JavaScript frontend. No database, account, write access, or frontend build step is required.

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

The page uses Google Fonts when internet access is available, with serif/sans-serif system fallbacks otherwise.
