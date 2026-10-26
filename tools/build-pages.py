"""Build the footer into index.html and write the standalone pages
(privacy.html, terms.html, 404.html) around one shared footer, so the links,
logo and contact details stay identical everywhere.

usage: python -I build-pages.py   (run from the project root)

The footer in index.html is replaced between its <footer> tags. The legal
pages are written whole; edit their text in LEGAL below and run again.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPDATED = "16 October 2026"
SITE = "https://rockslink.com"  # the live address: also in index.html, robots.txt and sitemap.xml
PHONE, PHONE_HREF = "+20 12 00029811", "tel:+201200029811"
EMAIL = "omarkhaled7296@gmail.com"
WA = "https://wa.me/201200029811"

MARK = '<svg class="logo-mark" viewBox="47 39 148 148" aria-hidden="true"><use href="#mark" /></svg>'
SPRITE = '''<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <symbol id="mark" viewBox="47 39 148 148">
      <path style="fill: var(--mark-a, #0d2b50); stroke: var(--mark-a, #0d2b50)" stroke-width="0.25" stroke-linejoin="round" d="M139 112.5C136.87 112.27 134.92 108.92 132.17 108.54C124.87 107.53 116.84 108.46 109.48 108.5C99.88 108.56 90.04 107.79 80.48 108.5C80.54 108.79 80.6 109.08 80.67 109.37C79.43 111.04 80.27 122.05 80.27 124.83C80.26 136.61 80.25 148.39 80.25 160.17C80.25 165.68 81.03 171.62 76.5 175.67C72.26 179.45 66.8 178.87 61.5 178.87C58.25 178.87 52.8 179.91 49.89 178.5C49.89 133.06 49.9 87.61 49.9 42.17C52.31 41 56.5 41.78 59.17 41.78C66.28 41.8 73.39 41.8 80.5 41.79C92.39 41.78 104.28 41.79 116.17 41.8C135.75 41.82 150.14 41.14 164.71 56.13C180.12 72 180.27 97.05 166.27 113.76C162.83 117.86 156.92 123.83 151.5 124.95C149.46 122.26 148.9 117.29 147.79 114.07C143.18 100.72 140.87 85.11 127.56 77.27C118.76 72.09 108.1 72.17 98.17 71.29C95.19 71.03 91.41 71.52 88.57 70.56C86.64 69.9 86.09 64.91 84.67 63.17C79.16 56.42 68.56 56.2 63.29 63.46C57.19 71.87 63.04 84.08 73.34 84.83C76.53 85.06 80.12 83.73 82.58 81.74C83.8 80.76 84.93 78.18 86.5 78.01C90.35 77.61 94.63 78.8 98.5 79.01C105.5 79.38 114.18 79.24 120.63 82.2C130.68 86.82 134.48 96.36 137.15 106.38C137.7 108.42 138.76 110.39 139 112.5Z" />
      <path style="fill: var(--mark-b, #3169a8); stroke: var(--mark-b, #3169a8)" stroke-width="0.25" stroke-linejoin="round" d="M73.6 64.16C81.51 63.48 84.45 76.06 76.49 77.99C65.59 80.64 63.6 65.03 73.6 64.16ZM139 112.5C140.62 115 141.25 118.75 142.19 121.63C145.52 131.77 147.01 142.5 150.82 152.5C149.62 155.64 146.62 157.5 146.1 161.18C144.84 170.01 152.99 179.83 162.57 176.77C171.45 173.93 175.68 163.07 169.84 155.32C166.81 151.3 162.58 151.03 158.17 149.88C156.43 146.77 152.96 135.83 153.48 132.5C166.6 149.64 179.72 166.79 192.83 183.93C191.15 185.17 187.61 184.48 185.5 184.48C179.28 184.49 173.06 184.51 166.83 184.53C159.51 184.55 147.12 186.08 140.62 182.86C133.93 179.54 127.27 168.48 122.7 162.47C112.95 149.62 102.67 137.13 92.8 124.37C90.68 121.63 81.45 111.24 80.67 109.37C80.6 109.08 80.54 108.79 80.48 108.5C90.04 107.79 99.88 108.56 109.48 108.5C116.84 108.46 124.87 107.53 132.17 108.54C134.92 108.92 136.87 112.27 139 112.5ZM159.26 156.49C168.6 156.25 168.44 170.93 159.17 170.91C150.04 170.89 149.96 156.74 159.26 156.49Z" />
    </symbol>
  </svg>'''


def footer(home):
    """home: '' on the landing page (in-page anchors), './' elsewhere"""
    top = "#top" if not home else "./"
    pages = [("Home", top), ("About", f"{home}#about"), ("Services", f"{home}#services"), ("FAQ", f"{home}#faq"), ("Contact", f"{home}#contact")]
    li = lambda items: "".join(f'<li><a href="{h}">{t}</a></li>' for t, h in items)
    return f'''<footer class="footer">
    <div class="footer__top">
      <div class="footer__brand">
        <a href="{top}" class="nav__brand" aria-label="Rockslink home">
          {MARK}
          <span class="nav__word">rockslink</span>
        </a>
        <p class="footer__copy">&copy; <span id="year">2026</span> Rockslink. All rights reserved.</p>
      </div>
      <nav class="footer__cols" aria-label="Footer">
        <div>
          <p class="footer__label">Pages</p>
          <ul>{li(pages)}</ul>
        </div>
        <div>
          <p class="footer__label">Contact</p>
          <ul><li><a href="{PHONE_HREF}">{PHONE}</a></li><li><a href="mailto:{EMAIL}">{EMAIL}</a></li><li><a href="{WA}" target="_blank" rel="noopener">WhatsApp</a></li><li><span>Alexandria, Egypt</span></li></ul>
        </div>
        <div>
          <p class="footer__label">Socials</p>
          <ul><li><a href="#" target="_blank" rel="noopener">LinkedIn</a></li><li><a href="#" target="_blank" rel="noopener">Facebook</a></li><li><a href="#" target="_blank" rel="noopener">Instagram</a></li></ul>
        </div>
        <div>
          <p class="footer__label">Legal</p>
          <ul><li><a href="privacy.html">Privacy Policy</a></li><li><a href="terms.html">Terms of Service</a></li></ul>
        </div>
      </nav>
    </div>
    <div class="footer__word" aria-hidden="true"><span>rockslink</span></div>
  </footer>'''


HEAD = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content="{desc}" />
  {robots}<link rel="icon" href="{root}favicon.ico" sizes="48x48" />
  <link rel="icon" type="image/svg+xml" href="{root}assets/favicon.svg" />
  <link rel="apple-touch-icon" href="{root}assets/apple-touch-icon.png" />
  <link rel="manifest" href="{root}site.webmanifest" />
  <meta name="theme-color" content="#101a25" />
  <link rel="preload" href="{root}assets/fonts/dm-sans-400-latin.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="{root}assets/fonts/dm-sans-500-latin.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="{root}styles.css?v=20261026-1" />
</head>'''

YEAR = '''<button type="button" class="to-top" id="toTop" aria-label="Back to top"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" /></svg></button>
  <script>
    document.getElementById("year").textContent = new Date().getFullYear();
    const toTop = document.getElementById("toTop");
    const show = () => toTop.classList.toggle("is-on", window.scrollY > window.innerHeight * 0.8);
    window.addEventListener("scroll", show, { passive: true });
    show();
    toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  </script>'''

# ---------------------------------------------------------------- legal text
# Each section: (id, heading, [paragraphs or ("ul", [items])])
PRIVACY = {
    "file": "privacy.html",
    "title": "Privacy Policy | Rockslink",
    "desc": "How Rockslink handles the information you send through this website: what we collect, how your enquiry reaches us, and your choices. This site uses no cookies.",
    "h1": "Privacy Policy",
    "lede": "This policy explains what information Rockslink receives through this website, how we use it, and the choices you have.",
    "sections": [
        ("who", "Who we are", [
            f'Rockslink is a logistics company based in Alexandria, Egypt. For any question about your information, email <a href="mailto:{EMAIL}">{EMAIL}</a> or call <a href="{PHONE_HREF}">{PHONE}</a>.',
        ]),
        ("collect", "What we collect", [
            "Only what you choose to send us. The quote form asks for:",
            ("ul", ["your name and company", "your email address and phone number", "the service you need, the origin and the destination", "the type of cargo and a short description"]),
            "You can also write to us directly by email or WhatsApp. This website never asks for payment details, ID numbers or passwords.",
        ]),
        ("enquiry", "How your enquiry reaches us", [
            "The form does not store anything on this website. When you press send, it opens your own email app, or WhatsApp if you choose it, with your enquiry written out. Nothing reaches us until you press send there.",
            "Your message is then carried by your email provider or by WhatsApp, under their own privacy policies.",
        ]),
        ("use", "How we use it", [
            "We use your information to answer your enquiry, prepare a quote, arrange and follow a shipment you book with us, and keep the records the law requires.",
            "We do not sell your information, and we do not use it for advertising.",
        ]),
        ("share", "Who we share it with", [
            "Only the people who need it to move your cargo, such as carriers, customs brokers and customs authorities, warehouses, and insurers you ask us to arrange. We also share information when the law requires it.",
        ]),
        ("cookies", "Cookies and tracking", [
            "This website does not use cookies. It has no analytics and no advertising trackers, and it does not store anything in your browser.",
        ]),
        ("services", "Services this website loads", [
            "Everything this website shows, including its fonts and code libraries, is served from the website itself. It loads nothing from other companies' servers.",
            "The server that hosts this website may record standard request details, such as your IP address, the time and the page requested, to keep the site running and secure.",
        ]),
        ("keep", "How long we keep it", [
            "We keep enquiries and shipment records only as long as we need them for the purposes above, including any period that Egyptian commercial and tax law requires.",
        ]),
        ("choices", "Your choices", [
            f'You can ask to see, correct or delete the information we hold about you by emailing <a href="mailto:{EMAIL}">{EMAIL}</a>. We may need to keep records that the law requires us to keep.',
        ]),
        ("changes", "Changes to this policy", [
            "If we change this policy, we will update it on this page and change the date at the top.",
        ]),
    ],
}

TERMS = {
    "file": "terms.html",
    "title": "Terms of Service | Rockslink",
    "desc": "The terms for using the Rockslink website: the information on it, quote requests and bookings, your responsibilities, and the law that applies.",
    "h1": "Terms of Service",
    "lede": "These terms apply when you use this website. By using it, you agree to them.",
    "sections": [
        ("about", "About us", [
            f'This website is run by Rockslink, a logistics company based in Alexandria, Egypt. You can reach us at <a href="mailto:{EMAIL}">{EMAIL}</a> or <a href="{PHONE_HREF}">{PHONE}</a>.',
        ]),
        ("info", "Information on this website", [
            "This website gives general information about our services. Transit times, document lists and other details, including those in our FAQ, are typical examples and not a promise for a particular shipment. The information may change without notice.",
        ]),
        ("quotes", "Quote requests and bookings", [
            "Sending a quote request through this website does not create a contract. A price and a transit time apply only once we confirm them to you in writing.",
            "Every shipment is carried under the booking confirmation we agree with you and the terms of the carriers involved. If those documents differ from this website, the documents apply.",
        ]),
        ("you", "Your responsibilities", [
            "When you contact us, give accurate information about your cargo, its value and its documents. Do not use this website for anything unlawful, do not ask us to ship goods that are prohibited, and do not try to disrupt or gain unauthorised access to the website.",
        ]),
        ("ip", "Our content", [
            "The text, photos, film, maps and the Rockslink name and logo on this website belong to Rockslink or the people who licensed them to us. Do not copy them for commercial use without our written permission.",
        ]),
        ("links", "Other services", [
            "Links to WhatsApp, email apps and social networks take you to services that we do not control. Their own terms and privacy policies apply.",
        ]),
        ("liability", "Liability", [
            "This website is provided as it is. To the extent the law allows, Rockslink is not liable for any loss that results from using the website or from relying on its general information. Liability for a shipment is set by the booking confirmation, the carriers' terms and any cargo insurance arranged for it.",
        ]),
        ("law", "Applicable law", [
            "These terms are governed by the laws of the Arab Republic of Egypt, and the courts of Alexandria have jurisdiction over any dispute about them.",
        ]),
        ("changes", "Changes to these terms", [
            "If we change these terms, we will update them on this page and change the date at the top.",
        ]),
    ],
}


def body_html(blocks):
    out = []
    for b in blocks:
        if isinstance(b, tuple):
            out.append("<ul>" + "".join(f"<li>{i}</li>" for i in b[1]) + "</ul>")
        else:
            out.append(f"<p>{b}</p>")
    return "\n          ".join(out)


def legal_page(doc, other):
    toc = "".join(f'<li><a href="#{sid}">{h}</a></li>' for sid, h, _ in doc["sections"])
    secs = "\n".join(f'''        <section id="{sid}" aria-labelledby="{sid}-h">
          <h2 id="{sid}-h">{h}</h2>
          {body_html(blocks)}
        </section>''' for sid, h, blocks in doc["sections"])
    canonical = f'<link rel="canonical" href="{SITE}/{doc["file"]}" />\n  '
    return f'''{HEAD.format(title=doc["title"], desc=doc["desc"], robots=canonical, root="")}
<body class="page page--legal">
  {SPRITE}

  <header class="page-nav">
    <a href="./" class="nav__brand" aria-label="Rockslink home">
      {MARK}
      <span class="nav__word">rockslink</span>
    </a>
    <a href="./" class="text-link">Back to home</a>
  </header>

  <main class="legal" id="top">
    <header class="legal__head">
      <p class="legal__kicker">Legal</p>
      <h1 class="legal__title">{doc["h1"]}</h1>
      <p class="legal__lede">{doc["lede"]}</p>
      <p class="legal__date">Last updated {UPDATED}</p>
    </header>
    <div class="legal__body">
      <nav class="legal__toc" aria-label="On this page">
        <p class="legal__toc-title">On this page</p>
        <ol>{toc}</ol>
        <a class="legal__other" href="{other["file"]}">{other["h1"]}</a>
      </nav>
      <div class="legal__text">
{secs}
      </div>
    </div>
  </main>

  {footer("./")}
  {YEAR}
</body>
</html>
'''


NOT_FOUND = f'''{HEAD.format(title="Page not found | Rockslink", desc="This page could not be found. Go back to the Rockslink home page or request a quote.", robots='<meta name="robots" content="noindex" />\n  ', root="/")}
<body class="page page--404">
  {SPRITE}

  <header class="page-nav page-nav--clear">
    <a href="/" class="nav__brand" aria-label="Rockslink home">
      {MARK}
      <span class="nav__word">rockslink</span>
    </a>
  </header>

  <main class="nf">
    <p class="nf__code">404</p>
    <h1 class="nf__title">This page is off the route.</h1>
    <p class="nf__text">The link may be old, or the page has moved. Everything else is where you left it.</p>
    <div class="nf__actions">
      <a href="/" class="btn">Back to home <i><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg></i></a>
      <a href="/#contact" class="btn btn--ghost">Get a quote</a>
    </div>
  </main>
</body>
</html>
'''


def main():
    index = ROOT / "index.html"
    s = index.read_text(encoding="utf-8")
    s, n = re.subn(r"<footer class=\"footer\">.*?</footer>", lambda m: footer(""), s, flags=re.S)
    assert n == 1
    index.write_text(s, encoding="utf-8")
    (ROOT / PRIVACY["file"]).write_text(legal_page(PRIVACY, TERMS), encoding="utf-8")
    (ROOT / TERMS["file"]).write_text(legal_page(TERMS, PRIVACY), encoding="utf-8")
    (ROOT / "404.html").write_text(NOT_FOUND, encoding="utf-8")
    print("built footer, privacy.html, terms.html, 404.html")


if __name__ == "__main__":
    main()
