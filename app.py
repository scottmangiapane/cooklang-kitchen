#!/usr/bin/env python3
"""Small, read-only Cooklang recipe browser. Standard-library HTTP server."""
from __future__ import annotations
import json
import os
import re
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

try:
    import yaml
except ImportError:
    yaml = None

ROOT = Path(os.environ.get("RECIPES_DIR", "/recipes")).resolve()
WEB = Path(__file__).parent / "static"
PORT = int(os.environ.get("PORT", "8080"))
IMAGE_MIMES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif",
}


def safe_metadata(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [safe_metadata(v) for v in value]
    if isinstance(value, dict):
        return {str(k): safe_metadata(v) for k, v in value.items()}
    return str(value)


def split_front_matter(text):
    """Return (metadata, body, nonfatal warning). Accept only a leading YAML block."""
    m = re.match(r"\A\ufeff?---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", text, re.S)
    if not m:
        if text.startswith("---"):
            return {}, text, "Front matter starts with '---' but its closing delimiter was not found."
        return {}, text, None
    raw, body = m.group(1), text[m.end():]
    if yaml:
        try:
            parsed = yaml.safe_load(raw)
            if parsed is None:
                parsed = {}
            if not isinstance(parsed, dict):
                return {}, body, "Front matter must be a YAML mapping; metadata was ignored."
            return safe_metadata(parsed), body, None
        except Exception as exc:
            return {}, body, f"Could not parse YAML metadata ({exc.__class__.__name__}); recipe text was still loaded."
    # Useful fallback for simple key: value metadata if PyYAML is unavailable.
    meta = {}
    for line in raw.splitlines():
        mm = re.match(r"^([\w-]+)\s*:\s*(.*)$", line)
        if mm:
            v = mm.group(2).strip().strip('"\'')
            if v.startswith("[") and v.endswith("]"):
                meta[mm.group(1)] = [x.strip().strip('"\'') for x in v[1:-1].split(",") if x.strip()]
            else:
                meta[mm.group(1)] = v
    return meta, body, "PyYAML is unavailable; metadata was parsed with a basic fallback."


def remove_comments(body):
    # Block comments can span lines. Keep newlines so step separation remains stable.
    body = re.sub(r"\[-.*?-\]", lambda m: "\n" * m.group(0).count("\n") + " ", body, flags=re.S)
    # Per the spec, -- begins a line comment through end-of-line.
    return re.sub(r"--[^\r\n]*", "", body)


def parse_quantity(raw):
    raw = (raw or "").strip()
    if "%" in raw:
        quantity, unit = raw.split("%", 1)
        return quantity.strip(), unit.strip()
    return raw, ""


def inline_tokens(text):
    """Tokenize Cooklang inline markup without treating malformed syntax as fatal."""
    parts, i = [], 0
    n = len(text)
    while i < n:
        if text[i] not in "@#~":
            j = i + 1
            while j < n and text[j] not in "@#~":
                j += 1
            parts.append({"type": "text", "text": text[i:j]})
            i = j
            continue
        start = i
        sigil = text[i]
        i += 1
        optional = False
        if i < n and text[i] == "?" and sigil in "@#":
            optional = True
            i += 1
        name = ""
        raw_amount = ""
        prep = ""
        # A brace explicitly terminates a (possibly multi-word) name. Without braces,
        # Cooklang's shorthand name is a single token.
        if i < n and text[i] == "{":
            pass
        else:
            brace = text.find("{", i)
            next_component = re.search(r"[@#~]", text[i:])
            next_component_at = i + next_component.start() if next_component else n
            if brace >= 0 and brace < next_component_at:
                candidate = text[i:brace]
                # Only consume spaces into the name when a brace disambiguates it
                # before the next component marker. This keeps "@salt and @water{...}"
                # from swallowing the second ingredient.
                name = candidate.strip()
                i = brace
            else:
                m = re.match(r"[^\s{}()\[\],;!?]+", text[i:])
                if not m:
                    parts.append({"type": "text", "text": text[start:start+1]})
                    i = start + 1
                    continue
                name = m.group(0)
                i += len(m.group(0))
                # Sentence-ending punctuation is not part of an unbraced name.
                trailing = ""
                while name and name[-1] in ".:":
                    trailing = name[-1] + trailing
                    name = name[:-1]
                    i -= 1
                if not name:
                    parts.append({"type": "text", "text": text[start:i+len(trailing)]})
                    i += len(trailing)
                    continue
        if i < n and text[i] == "{":
            end = text.find("}", i + 1)
            if end < 0:
                # Malformed component: preserve its source as ordinary text.
                parts.append({"type": "text", "text": text[start:]})
                break
            raw_amount = text[i+1:end]
            i = end + 1
        if i < n and text[i] == "(" and sigil == "@":
            end = text.find(")", i + 1)
            if end >= 0:
                prep = text[i+1:end].strip()
                i = end + 1
        # Trim punctuation accidentally included in a brace-terminated name only if no braces? handled above.
        if sigil == "~":
            kind = "timer"
        elif sigil == "#":
            kind = "cookware"
        else:
            kind = "ingredient"
        quantity, unit = parse_quantity(raw_amount)
        # In case we couldn't determine a name or amount, still display a valid token card.
        if kind == "timer" and not name and not raw_amount:
            parts.append({"type": "text", "text": text[start:i]})
            continue
        parts.append({"type": kind, "name": name or ("Timer" if kind == "timer" else "Unnamed item"),
                      "optional": optional, "quantity": quantity, "unit": unit,
                      "preparation": prep, "raw_amount": raw_amount})
    return parts


def recipe_photo_path(recipe_path, metadata=None):
    """Find an optional local photo without allowing paths outside the recipe root.

    Preferred convention: a sibling image with the same stem as the .cook file.
    A front-matter `photo:` or `image:` value can override that with a relative path.
    Only common raster image formats are served.
    """
    metadata = metadata if isinstance(metadata, dict) else {}

    def safe_image(candidate):
        try:
            resolved = candidate.resolve()
            resolved.relative_to(ROOT)
        except (OSError, ValueError):
            return None
        if resolved.suffix.lower() not in IMAGE_MIMES or not resolved.is_file():
            return None
        return resolved

    for key in ("photo", "image", "photo_file", "image_file"):
        value = metadata.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        raw = Path(value.strip())
        if raw.is_absolute():
            continue
        found = safe_image(recipe_path.parent / raw)
        if found:
            return found

    for suffix in IMAGE_MIMES:
        found = safe_image(recipe_path.with_suffix(suffix))
        if found:
            return found
    return None


def normal_name(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def display_quantity(token):
    bits = [token.get("quantity", ""), token.get("unit", "")]
    return " ".join(x for x in bits if x).strip()


def parse_recipe(path):
    relative = path.relative_to(ROOT).as_posix()
    source = path.read_text(encoding="utf-8", errors="replace")
    meta, body, warning = split_front_matter(source)
    body = remove_comments(body)
    steps, notes, sections = [], [], []
    section_name = ""
    # Keep paragraphs as steps. A trailing backslash joins adjacent lines in a step.
    normalized = re.sub(r"\\[ \t]*\r?\n", "\n", body)
    blocks = re.split(r"\n\s*\n+", normalized)
    for block in blocks:
        lines = [ln.rstrip() for ln in block.splitlines()]
        lines = [ln for ln in lines if ln.strip()]
        if not lines:
            continue
        if len(lines) == 1 and re.match(r"^\s*=+\s*.*?\s*=*\s*$", lines[0]):
            section_name = re.sub(r"^\s*=+\s*|\s*=+\s*$", "", lines[0]).strip()
            if section_name:
                sections.append(section_name)
            continue
        if all(re.match(r"^\s*>", ln) for ln in lines):
            note = "\n".join(re.sub(r"^\s*>\s?", "", ln) for ln in lines).strip()
            if note:
                notes.append({"text": note, "parts": inline_tokens(note)})
            continue
        # Treat each leading single line beginning with > as a note too.
        if lines[0].lstrip().startswith(">"):
            note_lines, other_lines = [], []
            for ln in lines:
                (note_lines if ln.lstrip().startswith(">") else other_lines).append(ln)
            note = "\n".join(re.sub(r"^\s*>\s?", "", ln) for ln in note_lines).strip()
            if note:
                notes.append({"text": note, "parts": inline_tokens(note)})
            lines = other_lines
            if not lines:
                continue
        content = "\n".join(lines).strip()
        if not content:
            continue
        parsed_parts = inline_tokens(content)
        step = {"text": content, "parts": parsed_parts, "section": section_name}
        steps.append(step)

    # Aggregate components from steps by occurrence, retaining optionality and prep.
    ingredients, cookware, timers = [], [], []
    seen = set()
    for step in steps:
        for part in step["parts"]:
            if part["type"] not in ("ingredient", "cookware", "timer"):
                continue
            target = ingredients if part["type"] == "ingredient" else cookware if part["type"] == "cookware" else timers
            key = (part["type"], normal_name(part.get("name")).casefold(), part.get("quantity"), part.get("unit"), part.get("optional"), part.get("preparation"))
            # Component summary is unique for repeated identical tokens, detail instructions remain untouched.
            if key in seen:
                continue
            seen.add(key)
            item = {"name": normal_name(part.get("name")), "quantity": part.get("quantity", ""),
                    "unit": part.get("unit", ""), "optional": part.get("optional", False),
                    "preparation": part.get("preparation", ""), "display_quantity": display_quantity(part)}
            target.append(item)

    filename_title = path.stem.replace("_", " ").replace("-", " ").strip()
    title = normal_name(meta.get("title") or filename_title) or "Untitled recipe"
    tags = meta.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in re.split(r"[,;]", tags) if t.strip()]
    elif not isinstance(tags, list):
        tags = [str(tags)] if tags else []
    tags = [normal_name(t) for t in tags if normal_name(t)]
    return {"id": relative, "title": title, "tags": tags, "metadata": meta,
            "ingredients": ingredients, "cookware": cookware, "timers": timers,
            "steps": steps, "notes": notes, "sections": sections, "warning": warning,
            "photo_available": recipe_photo_path(path, meta) is not None,
            "source_name": path.name, "source": source}


def list_recipes():
    recipes = []
    if not ROOT.exists() or not ROOT.is_dir():
        return recipes
    for path in sorted(ROOT.rglob("*.cook"), key=lambda p: str(p.relative_to(ROOT)).casefold()):
        try:
            recipe = parse_recipe(path)
            recipes.append({"id": recipe["id"], "title": recipe["title"], "tags": recipe["tags"],
                            "ingredient_count": len(recipe["ingredients"]), "step_count": len(recipe["steps"]),
                            "photo_available": recipe["photo_available"]})
        except Exception as exc:
            # A single unreadable/malformed file should never prevent the rest of the library loading.
            recipes.append({"id": path.relative_to(ROOT).as_posix(),
                            "title": path.stem.replace("_", " ").replace("-", " "), "tags": [],
                            "ingredient_count": 0, "step_count": 0, "photo_available": False,
                            "warning": f"Could not parse this file ({exc.__class__.__name__})."})
    return recipes


class Handler(BaseHTTPRequestHandler):
    server_version = "CooklangKitchen/1.0"
    def send_bytes(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)
    def send_json(self, value, status=200):
        self.send_bytes(json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", status)
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/recipes":
            self.send_json({"recipes": list_recipes(), "directory_ok": ROOT.is_dir()})
            return
        if path.startswith("/api/photos/"):
            rid = path[len("/api/photos/"):]
            if not rid or not rid.endswith(".cook") or "\x00" in rid:
                self.send_bytes(b"Photo not found", "text/plain; charset=utf-8", 404); return
            recipe_path = (ROOT / rid).resolve()
            try:
                recipe_path.relative_to(ROOT)
            except ValueError:
                self.send_bytes(b"Photo not found", "text/plain; charset=utf-8", 404); return
            if not recipe_path.is_file() or recipe_path.suffix.lower() != ".cook":
                self.send_bytes(b"Photo not found", "text/plain; charset=utf-8", 404); return
            try:
                source = recipe_path.read_text(encoding="utf-8", errors="replace")
                metadata, _, _ = split_front_matter(source)
                photo = recipe_photo_path(recipe_path, metadata)
                if photo is None:
                    self.send_bytes(b"Photo not found", "text/plain; charset=utf-8", 404); return
                self.send_bytes(photo.read_bytes(), IMAGE_MIMES[photo.suffix.lower()])
            except Exception:
                self.send_bytes(b"Photo not found", "text/plain; charset=utf-8", 404)
            return
        if path.startswith("/api/recipes/"):
            rid = path[len("/api/recipes/"):]
            if not rid or not rid.endswith(".cook") or "\x00" in rid:
                self.send_json({"error": "Recipe not found."}, 404); return
            candidate = (ROOT / rid).resolve()
            try:
                candidate.relative_to(ROOT)
            except ValueError:
                self.send_json({"error": "Recipe not found."}, 404); return
            if not candidate.is_file() or candidate.suffix.lower() != ".cook":
                self.send_json({"error": "Recipe not found."}, 404); return
            try:
                self.send_json(parse_recipe(candidate))
            except Exception as exc:
                # Even unreadable input returns a useful page instead of crashing the server.
                try:
                    label = candidate.name
                    body = candidate.read_text(encoding="utf-8", errors="replace")
                except Exception:
                    body, label = "", candidate.name
                self.send_json({"id": rid, "title": Path(label).stem, "tags": [], "metadata": {},
                                "ingredients": [], "cookware": [], "timers": [], "steps": [], "notes": [],
                                "sections": [], "warning": f"Could not parse this file ({exc.__class__.__name__}).",
                                "photo_available": False, "source": body}, 200)
            return
        if path in ("/", "/index.html"):
            try:
                self.send_bytes((WEB / "index.html").read_bytes(), "text/html; charset=utf-8")
            except OSError:
                self.send_bytes(b"Frontend file missing.", "text/plain", 500)
            return
        if path.startswith("/static/"):
            name = path[len("/static/"):]
            candidate = (WEB / name).resolve()
            try:
                candidate.relative_to(WEB.resolve())
            except ValueError:
                self.send_bytes(b"Not found", "text/plain", 404); return
            if not candidate.is_file():
                self.send_bytes(b"Not found", "text/plain", 404); return
            ctype = "text/css; charset=utf-8" if candidate.suffix == ".css" else "application/javascript; charset=utf-8"
            self.send_bytes(candidate.read_bytes(), ctype); return
        self.send_bytes(b"Not found", "text/plain", 404)
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

if __name__ == "__main__":
    print(f"Cooklang Kitchen serving {ROOT} on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
