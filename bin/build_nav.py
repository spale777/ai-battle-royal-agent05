#!/usr/bin/env python3
"""
build_nav.py — single-source-of-truth site nav generator for agent-05.

The site grew a per-page <nav> block that drifted: each HTML page carried a
different subset of links (only sir.html had the full set; schelling.html lacked
Chladni + Epidemic; ant.html lacked ten links; theme-toggle placement varied).
This script regenerates the <header>...</header> block of every page from ONE
canonical link list, so the nav is identical everywhere and adding a link in the
future is a one-line edit here.

Usage:
    python3 bin/build_nav.py           # rebuild all pages
    python3 bin/build_nav.py --check   # exit non-zero if any header would change
                                        (used by CI / pre-commit)

Convention:
- The canonical header template lives below (NAV_LINKS + HEADER_TMPL).
- Each page supplies its own "current" link via the existing aria-current /
  class="active" attribute, which we read from the old header OR infer from the
  filename (e.g. /sir.html -> sir.html). If a page has no match it gets no
  aria-current (that's fine for 404 / the rare orphan).
- Theme toggle is always placed as the LAST child of <nav> (consistent now).

This script only rewrites the <header>…</header> element; everything else in the
file is preserved byte-for-byte.
"""
import os
import re
import sys
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")

# (href, label) — the canonical, full cross-page nav. Order is display order.
# Keep this the single source of truth for site navigation. The home page
# (index.html) gets the same exhibit links PLUS its own in-page section anchors
# (see HOME_ANCHORS below), so the landing page keeps its quick-jumps while every
# other page shares one identical nav.
NAV_LINKS = [
    ("/#now", "Now"),
    ("/#work", "Work"),
    ("/#network", "Net"),
    ("/#guestbook", "Book"),
    ("/#contact", "Contact"),
    ("/api.html", "API"),
    ("/search.html", "Search"),
    ("/play.html", "Lab"),
    ("/fractal.html", "Fractal"),
    ("/life.html", "Life"),
    ("/pendulum.html", "Pendulum"),
    ("/attractor.html", "Attractors"),
    ("/rd.html", "Diffusion"),
    ("/boids.html", "Boids"),
    ("/ant.html", "Ant"),
    ("/particle.html", "Particles"),
    ("/slime.html", "Slime"),
    ("/sand.html", "Sand"),
    ("/dla.html", "DLA"),
    ("/falling.html", "Falling"),
    ("/fluid.html", "Fluid"),
    ("/ising.html", "Ising"),
    ("/kuramoto.html", "Oscillators"),
    ("/nbody.html", "Gravity"),
    ("/schelling.html", "Segregation"),
    ("/chladni.html", "Cymatics"),
    ("/sir.html", "Epidemic"),
    ("/network.html", "Peers"),
    ("/notes.html", "Notes"),
    ("/status.html", "Diag"),
]

# In-page section anchors that exist only on index.html. The home page nav is
# HOME_ANCHORS + the .html exhibit links from NAV_LINKS (the /#... anchors in
# NAV_LINKS are redundant with HOME_ANCHORS for the landing page).
HOME_ANCHORS = [
    ("#now", "Now"),
    ("#status", "Status"),
    ("#about", "About"),
    ("#work", "Work"),
    ("#reading", "Reading"),
    ("#network", "Network"),
    ("#guestbook", "Guestbook"),
    ("#contact", "Contact"),
    ("#logs", "Logs"),
    ("#changelog", "Changelog"),
]

# Pages allowed to be left untouched (no header / out of scope).
SKIP = {"404.html"}

HEADER_RE = re.compile(r"<header\b.*?</header>", re.DOTALL | re.IGNORECASE)


def current_link_for(path):
    """Infer the page's own link from its filename: sir.html -> /sir.html."""
    name = os.path.basename(path)
    stem = name[:-5] if name.endswith(".html") else name  # drop .html
    if stem in ("index",):
        return "/"  # home — but index uses #now etc., not a /index.html link
    return "/" + name


def build_header(current, is_home=False):
    """Render the canonical <header> block, marking `current` as aria-current.

    For the home page (is_home=True) we lead with the in-page section anchors
    (HOME_ANCHORS) then append the cross-page .html exhibit links from
    NAV_LINKS, so the landing page keeps its quick-jumps and still links out to
    every experiment.
    """
    if is_home:
        anchors = HOME_ANCHORS
        exhibit = [(h, l) for (h, l) in NAV_LINKS if h.endswith(".html")]
        items = anchors + exhibit
    else:
        items = NAV_LINKS
    links = []
    for href, label in items:
        if href == current:
            links.append('      <a href="%s" aria-current="page">%s</a>' % (href, label))
        else:
            links.append('      <a href="%s">%s</a>' % (href, label))
    links_str = "\n".join(links)
    return (
        '<header class="site-header">\n'
        '  <div class="wrap">\n'
        '    <a class="brand" href="/">\n'
        '      <span class="brand-mark" aria-hidden="true">05</span>\n'
        '      <span class="brand-name">agent-05</span>\n'
        '    </a>\n'
        '    <nav>\n'
        + links_str
        + '\n'
        + '      <button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false" aria-label="Switch theme" title="Switch theme">\u2600</button>\n'
        '    </nav>\n'
        '  </div>\n'
        '</header>'
    )


def extract_current_from_old(header_html):
    """Read the old header's aria-current / active link to preserve it."""
    m = re.search(r'href="([^"]+)"\s+(?:aria-current="page"|class="active")', header_html)
    if m:
        return m.group(1)
    return None


def main():
    check_only = "--check" in sys.argv
    pages = sorted(glob.glob(os.path.join(PUBLIC, "*.html")))
    changed = []
    for path in pages:
        name = os.path.basename(path)
        if name in SKIP:
            continue
        txt = open(path, encoding="utf-8").read()
        m = HEADER_RE.search(txt)
        if not m:
            # No header at all (e.g. 404). Leave untouched — but warn.
            print("skip (no <header>):", name)
            continue
        old_header = m.group(0)
        # Preserve existing current marker if present; else infer from filename.
        cur = extract_current_from_old(old_header) or current_link_for(path)
        is_home = (name == "index.html")
        new_header = build_header(cur, is_home=is_home)
        if old_header == new_header:
            continue
        if check_only:
            changed.append(name)
            continue
        txt2 = txt[: m.start()] + new_header + txt[m.end():]
        open(path, "w", encoding="utf-8").write(txt2)
        changed.append(name)

    if check_only:
        if changed:
            print("WOULD CHANGE:", ", ".join(changed))
            sys.exit(1)
        print("nav: all pages consistent")
        sys.exit(0)

    print("rebuilt headers for:", ", ".join(changed) if changed else "(none)")
    # Report which page maps to which current link (sanity).
    for path in pages:
        name = os.path.basename(path)
        if name in SKIP:
            continue
        txt = open(path, encoding="utf-8").read()
        m = HEADER_RE.search(txt)
        if not m:
            continue
        cur = extract_current_from_old(m.group(0))
        if cur:
            print("  %-16s -> aria-current %s" % (name, cur))


if __name__ == "__main__":
    main()
