# Rockslink

Landing page for Rockslink, a logistics company in Alexandria, Egypt. A
static site: plain HTML, CSS and JavaScript (GSAP, ScrollTrigger and Lenis
from CDNs), no build step.

## Pages

- `index.html`: the landing page (film, Services, FAQ map, contact, quote)
- `privacy.html`, `terms.html`: legal pages (draft, to be reviewed)
- `404.html`: the page shown for missing addresses

## Run locally

```bash
python tools/serve.py
```

Then open http://127.0.0.1:5173. The server also serves `404.html` for
missing pages, as the hosting does.

## Hosting

Upload the folder as it is. `.htaccess` sets the 404 page, compression and
caching on Apache hosting; Netlify, Vercel and GitHub Pages use `404.html`
on their own. The site's address (`https://rockslink.com`) is set in
`robots.txt`, `sitemap.xml`, the canonical links and `tools/build-pages.py`.

## Quote form

The form posts to `api/enquiry.js`, a Vercel function that emails the
enquiry to sales@rockslink.com through [Resend](https://resend.com). Set
these in the Vercel project (Settings, Environment Variables), then
redeploy:

- `RESEND_API_KEY`: the Resend API key
- `ENQUIRY_FROM`: the sender, on a domain verified in Resend, for example
  `Rockslink website <website@rockslink.com>`
- `ENQUIRY_TO` (optional): where enquiries go, sales@rockslink.com if unset

Until the key is set, the function answers "not configured" and the form
sends through FormSubmit instead (`data-fallback` on the form).

## Tools

- `tools/build-pages.py`: writes the shared footer into `index.html` and
  builds the legal pages and the 404 page; edit links or legal text there
- `tools/make-icons.py`: the favicon set from the Rockslink mark
- `tools/bake-dotmask.py`: the dot mask for the Services map light
- the other scripts prepared the FAQ map images

Fonts: DM Sans, hosted in `assets/fonts` (SIL Open Font License, see
`assets/fonts/OFL.txt`).
