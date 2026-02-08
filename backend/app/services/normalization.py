from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

TRACKING_PARAM_NAMES = {"ref", "fbclid", "gclid", "yclid", "mc_cid", "mc_eid"}
TRACKING_PARAM_PREFIXES = ("utm_",)


def normalize_url(raw_url: str) -> str:
    parsed = urlparse(raw_url.strip())
    if not parsed.netloc:
        raise ValueError("invalid URL")

    hostname = parsed.hostname or ""
    if hostname.startswith("www."):
        hostname = hostname[4:]

    scheme = "https"

    params = parse_qsl(parsed.query, keep_blank_values=True)
    kept = []
    for key, value in params:
        lower = key.lower()
        if lower in TRACKING_PARAM_NAMES or any(lower.startswith(p) for p in TRACKING_PARAM_PREFIXES):
            continue
        kept.append((key, value))

    kept.sort(key=lambda x: (x[0], x[1]))
    query = urlencode(kept, doseq=True)

    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/")
        if not path:
            path = "/"

    normalized = urlunparse((scheme, hostname, path, "", query, ""))
    return normalized


def normalize_thread_key(thread_key: str) -> str:
    if not thread_key.startswith("url:"):
        raise ValueError("thread_key must start with 'url:'")
    raw_url = thread_key[4:]
    normalized = normalize_url(raw_url)
    return f"url:{normalized}"
