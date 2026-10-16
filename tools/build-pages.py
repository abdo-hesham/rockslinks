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
PHONE, PHONE_HREF = "+20 100 000 0000", "tel:+201000000000"
EMAIL = "info@rockslink.com"
WA = "https://wa.me/201000000000"

MARK = '<svg class="logo-mark" viewBox="0 0 40 24" aria-hidden="true"><use href="#mark" /></svg>'
SPRITE = '''<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <symbol id="mark" viewBox="0 0 40 24">
      <rect x="1.5" y="4.5" width="22" height="15" rx="7.5" fill="none" stroke="currentColor" stroke-width="3" />
      <rect x="16.5" y="4.5" width="22" height="15" rx="7.5" fill="none" stroke="currentColor" stroke-width="3" />
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
  <link rel="stylesheet" href="{root}styles.css?v=20261016-20" />
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
            "The fonts and images are served from this website itself. To show the page, your browser also downloads code libraries from cdnjs (Cloudflare) and jsDelivr. Like any request on the web, these two services receive your IP address and basic browser details.",
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
