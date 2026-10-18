"""Keep call tokens out of the logs.

A call token is the only credential a patient ever has: with it you can read their
script, post measurements as them, and read their summary. It travels in the URL path,
and uvicorn's access logger writes the whole path, so by default every request a patient
makes writes their credential into the log in clear text.

This installs a filter on the logger that rewrites those paths to keep only the last six
characters, which is enough to match a session up with a stored row when debugging and
useless to anyone who finds the log.
"""

import logging
import re

# /api/call/<token>/... and /call/<token>, with the token being urlsafe base64.
TOKEN_PATH = re.compile(r"(/(?:api/)?call/)([A-Za-z0-9_\-]{16,})")
KEEP = 6


def mask(text: str) -> str:
    """Replace any call token in a string with its last few characters."""
    def swap(hit: re.Match) -> str:
        token = hit.group(2)
        return f"{hit.group(1)}token-{token[-KEEP:]}"

    return TOKEN_PATH.sub(swap, text)


class MaskTokens(logging.Filter):
    """Rewrites every record so no call token is written out in full."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Mask the message and its arguments, then let the record through."""
        if isinstance(record.msg, str) and "call/" in record.msg:
            record.msg = mask(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {k: mask(v) if isinstance(v, str) else v
                               for k, v in record.args.items()}
            elif isinstance(record.args, tuple):
                record.args = tuple(mask(a) if isinstance(a, str) else a
                                    for a in record.args)
        return True


_DONE = False


def install() -> None:
    """Add the filter to the access logger and the root handlers, once."""
    global _DONE
    if _DONE:
        return
    _DONE = True
    flt = MaskTokens()
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn", "gunicorn.access"):
        logging.getLogger(name).addFilter(flt)
    root = logging.getLogger()
    root.addFilter(flt)
    for handler in root.handlers:
        handler.addFilter(flt)
