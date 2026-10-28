(async () => {
  "use strict";

  gsap.registerPlugin(ScrollTrigger);
  // re-measuring is driven from here (resize, load, fonts), once each
  ScrollTrigger.config({ autoRefreshEvents: "visibilitychange" });

  // Start-up runs in steps: the film and the hero first, then each section
  // below them in its own task, handing the browser a turn in between, so
  // the page answers at once instead of after one long block of work.
  // set something up only once the page has scrolled near it (WebGL decks
  // and the map light cost nothing until then)
  const whenNear = (el, fn) => {
    if (!("IntersectionObserver" in window)) return fn();
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fn();
    }, { rootMargin: "150% 0px 150% 0px" });
    io.observe(el);
  };
  const yieldToMain = () => new Promise((resolve) => {
    if (window.scheduler && scheduler.yield) scheduler.yield().then(resolve);
    else setTimeout(resolve, 0);
  });

  /* ------------------------------------------------------------------
   * Config
   * ---------------------------------------------------------------- */
  const FRAME_COUNT = 192;
  const isSmall = Math.min(window.innerWidth, window.innerHeight) < 600 && window.innerWidth < 900;
  const saveData = navigator.connection && navigator.connection.saveData;
  const slowNet = navigator.connection && /^(slow-2g|2g|3g)$/.test(navigator.connection.effectiveType || "");
  const lightFilm = isSmall || saveData || slowNet; // 1280 px frames, every other one
  const FRAME_DIR = lightFilm ? "frames-m" : "frames";
  const frameSrc = (i) => `${FRAME_DIR}/f_${String(i + 1).padStart(3, "0")}.webp`;

  // Timeline is measured in "units" of scroll. The drone shot plays linearly
  // between FILM_KEYS ([unit, frame] pairs; the last pair is where the settle
  // begins), then settles on a clean ocean frame (before the haze rolls in).
  // From CARGO_IN the container appears and the cloud deck rolls in; at
  // TOTAL the film lets go and climbs away through the clouds.
  const FILM_KEYS = [[0, 0], [19, 48], [79.6, 140]];
  const OCEAN_SETTLE = 140;
  const OCEAN_LAST = 148;  // frames/f_149.webp
  const TOTAL = 100;
  const CARGO_IN = 91;
  // Where each chapter sits on the timeline (used by dots + next button).
  const CHAPTERS = [0, 33, 74];

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
   * Elements
   * ---------------------------------------------------------------- */
  const $ = (s) => document.querySelector(s);
  const canvas = $("#filmCanvas");
  const ctx = canvas.getContext("2d");
  const film = $("#film");
  const sticky = film.querySelector(".film__sticky");
  const nav = $("#nav");
  const railFill = $("#railFill");
  const dots = [...document.querySelectorAll("#dots span")];
  const footer = document.querySelector(".footer");
  const ch3 = document.getElementById("ch3");
  const faqSection = document.getElementById("faq");
  const contactSection = document.getElementById("contact");
  const svcEl = document.getElementById("services");
  const spyLinks = [...document.querySelectorAll("[data-spy]")];
  const bridge = document.getElementById("bridge");
  const quoteEl = document.getElementById("quote");
  const quoteLogo = document.getElementById("quoteLogo");
  let filmProgress = 0;

  // Page positions of the sections, measured once per layout (load, refresh,
  // real resizes). Scroll code works them out from scrollY instead of asking
  // the browser for element positions every frame, which forced a fresh
  // style and layout pass after each write (dozens a frame on a phone).
  const pageTop = (el) => el.getBoundingClientRect().top + window.scrollY;
  const geo = { filmBottom: 0, svcTop: 0, svcBottom: 0, bridgeTop: 0, faqTop: 0, contactTop: 0, quoteTop: 0, footerTop: 0 };
  function measureGeo() {
    geo.filmBottom = pageTop(film) + film.offsetHeight;
    geo.bridgeTop = pageTop(bridge);
    geo.svcTop = pageTop(svcEl);
    geo.svcBottom = geo.svcTop + svcEl.offsetHeight;
    geo.faqTop = pageTop(faqSection);
    // the contact block is sticky: its place in the page is just above the
    // dwell spacer that follows it
    geo.contactTop = pageTop(document.querySelector(".atlas__dwell")) - contactSection.offsetHeight;
    geo.quoteTop = pageTop(quoteEl);
    geo.footerTop = pageTop(footer);
  }
  let atlasEntry = null; // set by the atlas: Rotterdam's screen point as the map takes over

  document.getElementById("year").textContent = new Date().getFullYear();

  /* ------------------------------------------------------------------
   * Smooth scroll (Lenis) wired into GSAP's ticker
   * ---------------------------------------------------------------- */
  let lenis = null;
  if (!reduceMotion && window.Lenis) {
    lenis = new Lenis({ duration: 1.25, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }

  const scrollTo = (target, opts = {}) => {
    if (lenis) lenis.scrollTo(target, { duration: 1.8, ...opts });
    else window.scrollTo({ top: typeof target === "number" ? target : target.getBoundingClientRect().top + window.scrollY, behavior: reduceMotion ? "auto" : "smooth" });
  };

  /* ------------------------------------------------------------------
   * Frame loading — coarse-to-fine so scrubbing works before 100%
   * ---------------------------------------------------------------- */
  const images = new Array(FRAME_COUNT);
  const loaded = new Uint8Array(FRAME_COUNT);
  let loadedCount = 0;

  const order = [];
  const seen = new Set();
  // phones and data saver: every other frame is plenty for the scrub
  (lightFilm ? [16, 8, 4, 2] : [16, 8, 4, 2, 1]).forEach((step) => {
    for (let i = 0; i < FRAME_COUNT; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
  });
  if (!seen.has(FRAME_COUNT - 1)) order.splice(1, 0, FRAME_COUNT - 1);

  const loadFrame = (i) => useBitmaps ? loadFrameData(i) :
    new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        images[i] = img;
        loaded[i] = 1;
        loadedCount++;
        onProgress();
        if (i === currentFrame || nearestLoaded(currentFrame) === i) render(true);
        resolve();
      };
      img.onerror = () => { loadedCount++; onProgress(); resolve(); };
      img.src = frameSrc(i);
    });

  // phones keep each frame as its file data: the bitmap made from it is
  // decoded on a background thread (an <img> would be decoded on the main
  // thread, mid-scroll)
  const loadFrameData = (i) =>
    fetch(frameSrc(i))
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => {
        images[i] = blob;
        loaded[i] = 1;
      })
      .catch(() => {})
      .then(() => {
        loadedCount++;
        onProgress();
        if (loaded[i] && (i === currentFrame || nearestLoaded(currentFrame) === i)) render(true);
      });

  // once the coarse pass is in, the finer frames only load while the film
  // is on screen or close to it: a visitor who has skipped past it does not
  // download the rest (they resume if they scroll back up)
  const COARSE = Math.ceil(FRAME_COUNT / 16) + 1;
  const nearFilm = () => geo.filmBottom - window.scrollY > -window.innerHeight * 1.5;
  const until = (ok) => new Promise((resolve) => {
    const check = () => (ok() ? resolve() : setTimeout(check, 400));
    check();
  });
  const runQueue = async (concurrency = 6) => {
    let next = 0;
    const worker = async () => {
      while (next < order.length) {
        if (next >= COARSE && !nearFilm()) await until(nearFilm);
        const i = order[next++];
        if (i !== undefined && !loaded[i]) await loadFrame(i);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  };

  const startedAt = performance.now();
  let siteShown = false;
  function onProgress() {
    const p = Math.min(1, loadedCount / order.length);
    // Reveal once the coarse pass (every 16th frame, enough to scrub the
    // whole film) is in and the loader has had a moment; the rest fills in
    // behind, coarse to fine.
    const coarseReady = loadedCount >= COARSE;
    if (!siteShown && (p >= 1 || (coarseReady && performance.now() - startedAt > 1200))) showSite();
  }

  /* ------------------------------------------------------------------
   * Canvas rendering (cover-fit, DPR aware, focal point per frame)
   * ---------------------------------------------------------------- */
  let currentFrame = 0;
  let drawnFrame = -1;
  let cw = 0, ch = 0;

  function resize() {
    const w = sticky.clientWidth, h = sticky.clientHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    // phones: the 1280 x 720 frames are cropped to a slice of the film, which
    // has no more detail than the frame's own pixels. The canvas is held to
    // that size (on a tall phone, about 330 x 720 instead of 620 x 1370) and
    // the screen scales it up, as it would a video: the same picture, with a
    // quarter of the pixels to decode, copy and send to the screen each frame
    if (lightFilm) dpr = Math.min(dpr, 1.5, 1280 / w, 720 / h);
    cw = Math.round(w * dpr);
    ch = Math.round(h * dpr);
    canvas.width = cw;
    canvas.height = ch;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    dropBitmaps();
    render(true);
  }

  // Phones: a frame is decoded the moment it is drawn, on the main thread,
  // which stalls the scroll. So the frames around the playhead are decoded
  // ahead, off the main thread (createImageBitmap), already cropped and
  // scaled to the canvas; drawing one is then a plain copy. Only a small
  // window is kept, so memory stays low.
  const useBitmaps = lightFilm && "createImageBitmap" in window;
  // frames either side of the playhead kept decoded (the phone frames are
  // every other one, so this is about 12 pictures each way: a fast swipe
  // still lands on decoded frames)
  const BM_SPAN = 24;
  const bitmaps = new Map(); // frame -> ImageBitmap, or "pending"
  let bmGen = 0;
  function dropBitmaps() {
    bmGen++;
    bitmaps.forEach((b) => b && b.close && b.close());
    bitmaps.clear();
  }
  function cropOf(idx, img) {
    // file data (phones) carries no size: the phone frames are 1280 x 720
    const iw = img.naturalWidth || 1280, ih = img.naturalHeight || 720;
    const s = Math.max(cw / iw, ch / ih);
    const dw = iw * s, dh = ih * s;
    const dx = Math.min(0, Math.max(cw - dw, cw / 2 - dw * focusX(idx)));
    return { s, dx, dy: (ch - dh) / 2, dw, dh };
  }
  let bmLast = 0, bmDir = 1;
  function primeBitmaps(c) {
    if (!useBitmaps || !cw) return;
    if (c !== bmLast) { bmDir = c > bmLast ? 1 : -1; bmLast = c; }
    let pending = 0;
    bitmaps.forEach((b, i) => {
      if (Math.abs(i - c) > BM_SPAN * 1.5) { if (b && b.close) b.close(); bitmaps.delete(i); }
      else if (b === "pending") pending++;
    });
    const gen = bmGen;
    // nearest first, the way the film is going before the way back, and only
    // a few at a time: on a fast swipe the decoder works on the frames about
    // to be shown, not on ones the playhead has already left
    for (let d = 0; d <= BM_SPAN * 2 && pending < 4; d++) {
      const i = c + (d % 2 ? 1 : -1) * Math.ceil(d / 2) * bmDir;
      if (i < 0 || i >= FRAME_COUNT || !loaded[i] || bitmaps.has(i)) continue;
      pending++;
      const img = images[i];
      const { s, dx, dy } = cropOf(i, img);
      bitmaps.set(i, "pending");
      createImageBitmap(img, -dx / s, -dy / s, cw / s, ch / s, { resizeWidth: cw, resizeHeight: ch, resizeQuality: "medium" })
        .then((bm) => {
          if (gen !== bmGen || bitmaps.get(i) !== "pending") { bm.close(); return; }
          bitmaps.set(i, bm);
          if (i === nearestLoaded(currentFrame) && drawnFrame !== -2 - i) render(true);
        })
        .catch(() => bitmaps.delete(i));
    }
  }

  function nearestLoaded(i) {
    if (loaded[i]) return i;
    for (let d = 1; d < FRAME_COUNT; d++) {
      if (i - d >= 0 && loaded[i - d]) return i - d;
      if (i + d < FRAME_COUNT && loaded[i + d]) return i + d;
    }
    return -1;
  }

  // On tall/narrow screens the 16:9 film is cropped to a narrow slice;
  // steer the slice onto the subject. The port is centred; from the moment
  // the ship appears the slice follows the ship's centre frame by frame
  // (measured on the frames), so the ship stays put on a phone instead of
  // drifting across it.
  const SHIP_TRACK = [[0, 0.5], [88, 0.5], [92, 0.48], [100, 0.42], [110, 0.41], [120, 0.4], [130, 0.385], [140, 0.375], [149, 0.36], [160, 0.345], [175, 0.31], [191, 0.27]];
  function focusX(i) {
    for (let k = 1; k < SHIP_TRACK.length; k++) {
      const [i1, x1] = SHIP_TRACK[k];
      if (i <= i1) {
        const [i0, x0] = SHIP_TRACK[k - 1];
        return x0 + (x1 - x0) * ((i - i0) / (i1 - i0));
      }
    }
    return SHIP_TRACK[SHIP_TRACK.length - 1][1];
  }

  function render(force) {
    const idx = nearestLoaded(currentFrame);
    if (idx < 0) return;
    primeBitmaps(idx);
    let bm = bitmaps.get(idx);
    let ready = bm && bm !== "pending";
    if (useBitmaps && !ready) {
      // not decoded yet: show the nearest frame that is, until it is
      for (let d = 1; d <= BM_SPAN && !ready; d++) {
        for (const j of [idx - d, idx + d]) {
          const b = bitmaps.get(j);
          if (b && b !== "pending") { bm = b; ready = true; break; }
        }
      }
      if (!ready) return;
      if (bm !== bitmaps.get(idx)) { ctx.drawImage(bm, 0, 0); drawnFrame = -1; return; }
    }
    // drawnFrame is -2 - idx while the plain image stands in for a bitmap
    if (!force && (idx === drawnFrame || (!ready && drawnFrame === -2 - idx))) return;
    if (ready) {
      ctx.drawImage(bm, 0, 0);
      drawnFrame = idx;
      return;
    }
    // cover framing with the focal point
    const img = images[idx];
    const { dx, dy, dw, dh } = cropOf(idx, img);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
    drawnFrame = useBitmaps ? -2 - idx : idx;
  }

  /* ------------------------------------------------------------------
   * Text prep
   * ---------------------------------------------------------------- */
  const statement = $("#statement");
  statement.innerHTML = statement.textContent
    .trim()
    .split(/\s+/)
    .map((w) => `<span class="w">${w}</span>`)
    .join(" ");
  const words = statement.querySelectorAll(".w");

  /* ------------------------------------------------------------------
   * Master scroll timeline
   * ---------------------------------------------------------------- */
  const playhead = { frame: 0 };

  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: film,
      start: "top top",
      end: "bottom bottom",
      scrub: 0.6,
      onUpdate: (self) => onFilmUpdate(self.progress),
    },
  });

  // film playhead: linear between FILM_KEYS, then the ocean eases to a stop
  // on a clean frame and holds there until the film lets go.
  const renderPlayhead = () => {
    currentFrame = Math.round(playhead.frame);
    render(false);
  };
  for (let k = 1; k < FILM_KEYS.length; k++) {
    const [u0] = FILM_KEYS[k - 1];
    const [u1, f1] = FILM_KEYS[k];
    tl.to(playhead, { frame: f1, duration: u1 - u0, onUpdate: renderPlayhead }, u0);
  }
  const settleAt = FILM_KEYS[FILM_KEYS.length - 1][0];
  tl.to(playhead, {
    frame: OCEAN_LAST,
    duration: 12.6,
    ease: "power2.out",
    onUpdate: renderPlayhead,
  }, settleAt);
  tl.set({}, {}, TOTAL);

  // chapter 1 — hero dissolves into the clouds
  tl.to("#topShade", { opacity: 0, duration: 4 }, 16)
    .to("#topShade", { opacity: 1, duration: 4 }, 45)
    .to("#topShade", { opacity: 0, duration: 4 }, 90);

  // phones leave the blur out: a blur that changes is painted again every
  // frame, which a phone cannot keep up with over a moving film
  const exitBlur = lightFilm ? {} : { filter: "blur(6px)" };
  tl.to("#ch1", { opacity: 0, y: -60, ...exitBlur, duration: 8, ease: "power1.in" }, 7)
    .to("#filmShade", { opacity: 0, duration: 14 }, 6);

  // chapter 2 — statement, words fill in as you scroll
  tl.fromTo("#ch2", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 5, ease: "power2.out" }, 23)
    .to(words, { opacity: 1, duration: 1.2, stagger: 10 / words.length }, 26)
    .to("#ch2", { opacity: 0, y: -40, ...exitBlur, duration: 5, ease: "power1.in" }, 41);

  // chapter 3 — ship; its headline leaves through its line masks while the
  // ocean settles, so the frame is clean before it travels into Services
  tl.to("#shipShade", { opacity: 1, duration: 8 }, 58)
    .fromTo("#ch3", { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 6, ease: "power2.out" }, 62)
    .to(["#ch3 .ship__meta", "#ch3 .pill"], { opacity: 0, y: -24, duration: 4, ease: "power1.in" }, 85)
    .to("#ch3 .ship__title .line > span", { yPercent: -110, duration: 4, stagger: 0.8, ease: "power2.in" }, 86)
    .to("#shipShade", { opacity: 0, duration: 6 }, 88);

  /* ------------------------------------------------------------------
   * Nav / UI theme, rail, dots
   * ---------------------------------------------------------------- */
  const unitToScroll = (u) => {
    const st = tl.scrollTrigger;
    return st.start + (u / TOTAL) * (st.end - st.start);
  };

  function themeForUnit(u) {
    // light film behind = dark ink, dark film behind = white ink
    return u > 19 && u < 46 ? "dark" : "light";
  }

  function onFilmUpdate(p) {
    filmProgress = p;
    railFill.style.transform = `scaleY(${p})`;
    const u = p * TOTAL;
    const active = CHAPTERS.reduce((acc, c, i) => (u >= c - 6 ? i : acc), 0);
    dots.forEach((d, i) => d.classList.toggle("is-active", i === active));
    // written only on a change: each write restyles the film, every frame
    const theme = themeForUnit(u);
    if (sticky.dataset.theme !== theme) sticky.dataset.theme = theme;
    // the ship chapter's button is only reachable by Tab while it shows
    const away = u < 62 || u > 89;
    if (ch3.inert !== away) ch3.inert = away;
    updateNavTheme();
  }

  function updateNavTheme() {
    if (document.body.classList.contains("menu-open")) return;
    let theme, solid = false;
    const sy = window.scrollY;
    const svc = { top: geo.svcTop - sy };
    const q = { top: geo.quoteTop - sy };
    const navLine = 40;
    if (geo.footerTop - sy < 60) {
      theme = "light";
    } else if (q.top + window.innerHeight * 0.26 < navLine) {
      // the closing quote has darkened to night: white links on it
      theme = "light";
    } else if (svc.top + window.innerHeight * 0.22 < navLine) {
      // light Services, the map, questions and form until the quote
      theme = "dark";
      solid = true;
    } else if (svc.top < navLine || geo.bridgeTop - sy < window.innerHeight * 0.6) {
      // the light cloud deck (it starts 60vh above the bridge): dark links on it
      theme = "dark";
    } else {
      theme = themeForUnit(filmProgress * TOTAL);
    }
    if (nav.dataset.theme !== theme) nav.dataset.theme = theme;
    nav.classList.toggle("is-solid", solid);
    updateSpy();
  }

  // highlight the nav link of the section in view
  function updateSpy() {
    const line = window.innerHeight * 0.4 + window.scrollY;
    let current;
    if (geo.contactTop < line) current = "contact";
    else if (geo.faqTop < line) current = "faq";
    else if (geo.svcTop < line) current = "services";
    else current = filmProgress * TOTAL >= CHAPTERS[1] - 8 ? "about" : "top";
    spyLinks.forEach((l) => l.classList.toggle("is-active", l.dataset.spy === current));
  }
  // (Lenis scrolls the window itself, so one scroll listener covers both)
  window.addEventListener("scroll", updateNavTheme, { passive: true });
  ScrollTrigger.addEventListener("refresh", () => { measureGeo(); updateNavTheme(); });

  // skip intro: straight to Services; it leaves with the last chapter
  const skipBtn = $("#skipIntro");
  skipBtn.addEventListener("click", () => scrollTo(svcEl, { duration: 2.2 }));

  // floating quote: from the end of the film until the form is on screen
  const quoteFab = $("#quoteFab");
  const toTop = $("#toTop");
  toTop.addEventListener("click", () => scrollTo(0, { duration: 2.2 }));
  function updateQuoteFab() {
    const vh = window.innerHeight, sy = window.scrollY;
    const afterFilm = geo.filmBottom - sy < vh * 0.5;
    const formSoon = geo.contactTop - sy < vh * 0.9;
    quoteFab.classList.toggle("is-on", afterFilm && !formSoon);
    toTop.classList.toggle("is-on", afterFilm && formSoon);
    skipBtn.classList.toggle("is-gone", filmProgress > 0.8);
  }
  window.addEventListener("scroll", updateQuoteFab, { passive: true });

  // next button: jump to the following chapter, then into Services
  $("#nextBtn").addEventListener("click", () => {
    const u = filmProgress * TOTAL;
    const nextChapter = CHAPTERS.find((c) => c > u + 2);
    if (nextChapter !== undefined) scrollTo(unitToScroll(nextChapter + 4));
    else scrollTo(svcEl);
  });

  /* ------------------------------------------------------------------
   * Intro + section reveals
   * ---------------------------------------------------------------- */
  // (the hero rises in by CSS; no loading screen holds the page back)
  gsap.set([nav, ".film__sticky .next", ".film__sticky .dots", ".rail"], { opacity: 0 });

  function showSite() {
    siteShown = true;
    document.body.classList.remove("is-loading");
    if (lenis) lenis.start();

    gsap.timeline({ delay: 0.2, defaults: { ease: "expo.out" } })
      .to(nav, { opacity: 1, duration: 1.2 })
      .to([".film__sticky .next", ".film__sticky .skip", ".film__sticky .dots", ".rail", ".wa-fab"], { opacity: 1, duration: 1 }, "-=1");
  }

  /* ------------------------------------------------------------------
   * Menu
   * ---------------------------------------------------------------- */
  const menu = $("#menu");
  const menuBtn = $("#menuBtn");
  function setMenu(open) {
    menu.classList.toggle("is-open", open);
    menu.setAttribute("aria-hidden", String(!open));
    menu.inert = !open; // closed: its links are out of the Tab order
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.textContent = open ? "Close" : "Menu";
    document.body.classList.toggle("menu-open", open);
    if (open) nav.dataset.theme = "light";
    else updateNavTheme();
    if (lenis) open ? lenis.stop() : lenis.start();
  }
  menu.inert = true;
  menuBtn.addEventListener("click", () => setMenu(!menu.classList.contains("is-open")));
  document.addEventListener("keydown", (e) => e.key === "Escape" && setMenu(false));

  // Tab from the FAQ into the contact block: bring the form up first, so
  // focus never lands on something still below the map
  contactSection.addEventListener("focusin", (e) => {
    if (reduceMotion || contactSection.contains(e.relatedTarget)) return;
    if (contactSection.getBoundingClientRect().top > 4) scrollTo(contactSection, { immediate: true });
  });

  // anchor links through the smooth scroller
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      // "About" lives inside the film, at the start of the statement chapter
      const target = id === "#top" ? 0 : id === "#about" ? unitToScroll(CHAPTERS[1] + 4) : document.querySelector(id);
      if (target === null) return;
      if (a.dataset.service) setService(a.dataset.service);
      e.preventDefault();
      const wasOpen = menu.classList.contains("is-open");
      if (wasOpen) setMenu(false);
      setTimeout(() => scrollTo(target), wasOpen ? 450 : 0);
    });
  });

  // first paint: the film and the hero are ready; everything below the
  // film is set up in the steps that follow
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);
  resize();
  ScrollTrigger.refresh(); // the film's own measure, before the first paint
  measureGeo();
  // the first frame now; the rest once the page itself has loaded, so the
  // film never competes with the first screen for the connection
  // the rest start on the first sign of the visitor moving (scroll, touch,
  // a key) or a moment after the page has loaded, whichever comes first
  loadFrame(0).then(() => {
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      ["scroll", "wheel", "touchstart", "pointerdown", "keydown"].forEach((t) => window.removeEventListener(t, go));
      runQueue();
    };
    ["scroll", "wheel", "touchstart", "pointerdown", "keydown"].forEach((t) => window.addEventListener(t, go, { passive: true }));
    const later = () => setTimeout(go, 2500);
    if (document.readyState === "complete") later();
    else window.addEventListener("load", later, { once: true });
  });
  showSite();
  await yieldToMain();

  /* ------------------------------------------------------------------
   * Motion system
   * One vocabulary for everything after the film. Every entrance is built
   * from these presets; nothing else invents its own timing.
   *   heading   masked vertical line reveal   0.75s power3.out  0.08 stagger
   *   para      20px rise + fade              0.6s  power3.out
   *   image     vertical clip reveal          0.85s power3.out  (scale 1.03 -> 1)
   *   cards     20px rise + fade              0.65s power3.out  0.08 stagger
   * Hovers are 0.25s and the accordion 0.35s, both in CSS.
   * ---------------------------------------------------------------- */
  const M = { ease: "power3.out" };
  const HIDDEN = "inset(100% 0% 0% 0%)", SHOWN = "inset(0% 0% 0% 0%)";
  const motion = {
    heading: (tl, lines, at) => tl.fromTo(lines, { yPercent: 110 }, { yPercent: 0, duration: 0.75, stagger: 0.08, ease: M.ease }, at),
    para: (tl, els, at) => tl.fromTo(els, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.06, ease: M.ease }, at),
    image: (tl, figs, at) => {
      tl.fromTo(figs, { clipPath: HIDDEN }, { clipPath: SHOWN, duration: 0.85, stagger: 0.08, ease: M.ease }, at);
      return tl.fromTo(gsap.utils.toArray(figs).map((f) => f.querySelector("img, iframe")), { scale: 1.03 }, { scale: 1, duration: 0.85, stagger: 0.08, ease: M.ease }, at);
    },
    cards: (tl, els, at) => tl.fromTo(els, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.65, stagger: 0.08, ease: M.ease }, at),
  };

  // play a preset sequence once, when its section is established on screen
  function onView(trigger, build, start = "top 75%") {
    if (reduceMotion) return;
    const t = gsap.timeline({ paused: true });
    build(t);
    ScrollTrigger.create({ trigger, start, once: true, onEnter: () => t.play() });
  }

  await yieldToMain();

  /* ------------------------------------------------------------------
   * Services: one held screen over the dotted world map. The route, the
   * checkpoints and the cards coming up beside them are driven by the
   * shipment tracking below (updateServices). Here: the header rises in
   * once, and the light that passes over the map's dots.
   * ---------------------------------------------------------------- */
  const svcTrack = $("#svcTrack");
  const svcFrame = $("#svcFrame");
  const svcCards = [...document.querySelectorAll(".svc-card")];
  const svcNext = $("#svcNext");
  const svcHeldMQ = window.matchMedia("(min-width: 1000px) and (min-height: 640px)");
  onView(".svc-head", (t) => {
    motion.para(t, ".svc-head .label", 0);
    motion.heading(t, "#svcTitle .line > span", 0.08);
    motion.para(t, ".svc-intro", 0.3);
  }, "top 80%");

  /* The map light (WebGL, no library): a transparent layer over the map
   * image, fitted exactly as the image is (object-fit: cover), that draws
   * only on the map's dots (assets/services/map-dots.webp, baked from the
   * image by tools/bake-dotmask.py). One broad soft band crosses the map
   * diagonally, the Americas to Australia, every LIGHT_LOOP seconds: where
   * it passes the dots take on a steel blue, with a faint blue-white crest
   * and a soft spill onto the dots around. It is off the map at both ends
   * of the loop, so the restart is never seen. Its strength (uK) fades in
   * as the section arrives and out as it leaves; nothing is drawn while
   * the section is off screen. Off for reduced motion and small phones. */
  const LIGHT_LOOP = 12;
  const LIGHT_FS = `
    precision mediump float;
    uniform sampler2D uMask;
    uniform vec2 uRes;
    uniform vec4 uFit;
    uniform vec2 uTexel;
    uniform float uTime;
    uniform float uK;
    float dot8(vec2 uv, float r) {
      float v = 0.0;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853982;
        v += texture2D(uMask, uv + vec2(cos(a), sin(a)) * uTexel * r).r;
      }
      return v * 0.125;
    }
    void main() {
      vec2 c = gl_FragCoord.xy / uRes;
      c.y = 1.0 - c.y;
      vec2 uv = c * uFit.xy + uFit.zw;               // the map image's own uv
      float m = texture2D(uMask, uv).r;
      float sp = dot8(uv, 4.0);
      // the band: across the map and a little down, wide and feathered
      float ph = fract(uTime / ${LIGHT_LOOP.toFixed(1)});
      float d = uv.x + (uv.y - 0.5) * 0.32;
      float w = exp(-pow((d - mix(-0.32, 1.36, ph)) / 0.14, 2.0));
      w *= smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.9, 1.0, ph)) * uK;
      // spill on the haze between the dots, the dots in steel blue, the crest
      float a0 = sp * (1.0 - m) * w * 0.16;
      float a1 = m * w * 0.5;
      float a2 = m * pow(w, 3.0) * 0.2;
      vec3 rgb = vec3(0.62, 0.76, 0.92) * a0;
      float a = a0;
      rgb = vec3(0.475, 0.655, 0.835) * a1 + rgb * (1.0 - a1);
      a = a1 + a * (1.0 - a1);
      rgb = vec3(0.9, 0.95, 1.0) * a2 + rgb * (1.0 - a2);
      a = a2 + a * (1.0 - a2);
      gl_FragColor = vec4(rgb, a);
    }`;

  function initMapLight(cv) {
    const gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
    if (!gl) return;
    const shader = (type, src) => {
      const o = gl.createShader(type);
      gl.shaderSource(o, src);
      gl.compileShader(o);
      return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null;
    };
    const vs = shader(gl.VERTEX_SHADER, "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }");
    const fs = shader(gl.FRAGMENT_SHADER, LIGHT_FS);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n) => gl.getUniformLocation(prog, n);
    const uRes = u("uRes"), uFit = u("uFit"), uTexel = u("uTexel"), uTime = u("uTime"), uK = u("uK");
    const light = { k: 0, ready: false, drawn: false };
    const IW = 1672, IH = 941; // the map image
    const size = () => {
      const q = Math.min(window.devicePixelRatio || 1, 1.25);
      const w = cv.clientWidth, h = cv.clientHeight;
      cv.width = Math.max(1, Math.round(w * q));
      cv.height = Math.max(1, Math.round(h * q));
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(uRes, cv.width, cv.height);
      // object-fit: cover, centred: the canvas's uv in the image's uv
      const k = Math.max(w / IW, h / IH), dw = IW * k, dh = IH * k;
      gl.uniform4f(uFit, w / dw, h / dh, (dw - w) / 2 / dw, (dh - h) / 2 / dh);
      gl.uniform2f(uTexel, 1 / IW, 1 / IH);
      light.drawn = false;
    };
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, img);
      gl.uniform1i(u("uMask"), 0);
      size();
      light.ready = true;
      cv.classList.add("is-on");
    };
    img.src = "assets/services/map-dots.webp";
    window.addEventListener("resize", size);
    // strength: in as the section arrives, out as it leaves (time-based, so
    // the scroll never makes the light jump)
    ScrollTrigger.create({
      trigger: svcTrack, start: "top 85%", end: "bottom 15%",
      onToggle: (self) => gsap.to(light, { k: self.isActive ? 1 : 0, duration: self.isActive ? 1.8 : 0.9, ease: "sine.inOut", overwrite: true }),
    });
    gsap.ticker.add((time) => {
      if (!light.ready) return;
      const sy = window.scrollY;
      if (geo.svcBottom - sy < 0 || geo.svcTop - sy > window.innerHeight) return;
      if (light.k < 0.002) {
        if (!light.drawn) return;
        gl.clear(gl.COLOR_BUFFER_BIT); // let the plain map show, then rest
        light.drawn = false;
        return;
      }
      gl.uniform1f(uTime, time);
      gl.uniform1f(uK, light.k);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      light.drawn = true;
    });
  }
  if (!reduceMotion && !isSmall) whenNear(svcTrack, () => initMapLight($("#svcLight")));

  await yieldToMain();

  /* ------------------------------------------------------------------
   * Cloud deck (WebGL, no library): one full-canvas fragment shader with
   * two layers of domain-warped fbm noise. The back deck is fine and slow
   * and is solid just above the film's bottom edge, so the seam between
   * the film and the next section is always under cloud. Bigger front
   * puffs rise faster (they are closer) and cross the seam on top of it.
   * A light deck: white tops, soft blue-grey shadows, and the bottom edge
   * exactly the Services page colour (#f7f9fa), so the camera climbs out
   * of the clouds straight into Services with no seam and no dark band.
   * Drawn at half resolution and only while on screen.
   * ---------------------------------------------------------------- */
  const CLOUD_FS = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uRise;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < OCTAVES; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
      return v;
    }
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      float t = 1.0 - uv.y;                        // 0 = top of the deck, 1 = bottom
      vec2 q = vec2(uv.x * uRes.x / uRes.y, uv.y);
      vec3 hi = vec3(1.0, 1.0, 1.0);
      vec3 mid = vec3(0.66, 0.72, 0.80);           // the shaded undersides
      vec3 night = vec3(0.969, 0.976, 0.980);      // the page: --svc-bg #f7f9fa

      // back deck: billowing top edge, solid before the film's bottom (t = 0.43)
      vec2 pb = q * 2.6;
      pb.y -= uRise * 1.2;
      pb.x += uTime * 0.01;
      vec2 w = vec2(fbm(pb * 0.8 + vec2(0.0, uTime * 0.02)), fbm(pb * 0.8 + vec2(5.2, 1.3)));
      float nb = fbm(pb + w * 0.9);
      float db = max(clamp((nb - (0.86 - t * 2.0)) * 3.0, 0.0, 1.0), smoothstep(0.3, 0.4, t));
      vec3 cb = min(mix(mid, hi, smoothstep(0.3, 0.75, nb)) * (0.9 + 0.2 * nb), vec3(1.0));
      cb = mix(cb, night, smoothstep(0.5, 0.92, t + (nb - 0.5) * 0.3));

      // front puffs: larger, closer, so they rise faster across the seam
      vec2 pf = q * 1.5 + vec2(3.7, 8.1);
      pf.y -= uRise * 2.4;
      pf.x -= uTime * 0.016;
      float nf = fbm(pf + w * 0.6);
      float df = clamp((nf - (1.02 - t * 1.6)) * 2.6, 0.0, 1.0) * (1.0 - smoothstep(0.6, 0.85, t));
      vec3 cf = min(mix(mid, hi, smoothstep(0.28, 0.7, nf)) * (0.92 + 0.16 * nf), vec3(1.0));
      cf = mix(cf, night, smoothstep(0.55, 0.85, t));

      // front over back (premultiplied), then the bottom edge is the page
      vec3 col = cf * df + cb * db * (1.0 - df);
      float a = df + db * (1.0 - df);
      float e = smoothstep(0.86, 0.97, t);
      gl_FragColor = vec4(mix(col, night, e), mix(a, 1.0, e));
    }`;

  /* The same cloud deck once more, between the form and the quote: it
   * billows up over the bottom of the map (transparent above its edge), and
   * as the container sinks through it the clouds lose their light and close
   * into the night of the quote (#101a25), so the light page hands over to
   * the dark close through cloud instead of a flat band. */
  const QUOTE_CLOUD_FS = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uRise;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < OCTAVES; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
      return v;
    }
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      float t = 1.0 - uv.y;                        // 0 = top of the deck, 1 = bottom
      vec2 q = vec2(uv.x * uRes.x / uRes.y, uv.y);
      vec3 hi = vec3(1.0, 1.0, 1.0);
      vec3 mid = vec3(0.66, 0.72, 0.80);
      vec3 shade = vec3(0.30, 0.36, 0.44);         // cloud with the light gone
      vec3 night = vec3(0.063, 0.102, 0.145);      // the quote: --night #101a25
      float sink = smoothstep(0.5, 0.92, t);       // how far into the deck

      // back deck: a billowing top edge, solid from a third of the way down
      vec2 pb = q * 2.6;
      pb.y -= uRise * 1.2;
      pb.x += uTime * 0.01;
      vec2 w = vec2(fbm(pb * 0.8 + vec2(0.0, uTime * 0.02)), fbm(pb * 0.8 + vec2(5.2, 1.3)));
      float nb = fbm(pb + w * 0.9);
      float db = max(clamp((nb - (0.86 - t * 2.2)) * 3.0, 0.0, 1.0), smoothstep(0.3, 0.4, t));
      vec3 cb = min(mix(mid, hi, smoothstep(0.3, 0.75, nb)) * (0.9 + 0.2 * nb), vec3(1.0));
      cb = mix(cb, shade * (0.8 + 0.4 * nb), sink);
      cb = mix(cb, night, smoothstep(0.72, 0.97, t + (nb - 0.5) * 0.3));

      // front puffs, closer, rising faster across the deck's edge
      vec2 pf = q * 1.5 + vec2(3.7, 8.1);
      pf.y -= uRise * 2.4;
      pf.x -= uTime * 0.016;
      float nf = fbm(pf + w * 0.6);
      float df = clamp((nf - (1.02 - t * 1.7)) * 2.6, 0.0, 1.0) * (1.0 - smoothstep(0.55, 0.8, t));
      vec3 cf = min(mix(mid, hi, smoothstep(0.28, 0.7, nf)) * (0.92 + 0.16 * nf), vec3(1.0));
      cf = mix(cf, shade * (0.85 + 0.3 * nf), sink * 0.8);

      vec3 col = cf * df + cb * db * (1.0 - df);
      float a = df + db * (1.0 - df);
      float e = smoothstep(0.9, 0.99, t);          // the bottom edge is the quote
      gl_FragColor = vec4(mix(col, night, e), mix(a, 1.0, e));
    }`;

  // The shader is compiled in the background (KHR_parallel_shader_compile)
  // and only asked about once it is done: asking at once makes the page wait
  // for the compiler, a stall of a tenth of a second or more on a phone,
  // and this starts while the film is still scrolling.
  function initClouds(cv, source, onFail) {
    const gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
    if (!gl) return onFail();
    const par = gl.getExtension("KHR_parallel_shader_compile");
    const shader = (type, src) => {
      const o = gl.createShader(type);
      gl.shaderSource(o, src);
      gl.compileShader(o);
      return o;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }"));
    // phones: four noise layers instead of six, at a third of the size
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, `#define OCTAVES ${isSmall ? 4 : 6}
` + source));
    gl.linkProgram(prog);
    const done = () => !par || gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR);
    const wait = () => {
      if (!done()) return requestAnimationFrame(wait);
      // without the extension the check below waits for the compiler: it is
      // left to an idle moment
      (window.requestIdleCallback || setTimeout)(() => {
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return onFail();
        start(gl, prog, cv);
      });
    };
    wait();
  }
  function start(gl, prog, cv) {
    gl.useProgram(prog);
    // one triangle that covers the canvas
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uRise = gl.getUniformLocation(prog, "uRise");
    const q = isSmall ? 0.32 : 0.5;
    const size = () => {
      cv.width = Math.max(1, Math.round(cv.clientWidth * q));
      cv.height = Math.max(1, Math.round(cv.clientHeight * q));
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(uRes, cv.width, cv.height);
    };
    size();
    window.addEventListener("resize", size);
    const box = { top: 0, h: 1 };
    const place = () => { box.top = pageTop(cv); box.h = cv.clientHeight; };
    place();
    ScrollTrigger.addEventListener("refresh", place);
    gsap.ticker.add((time) => {
      const vh = window.innerHeight;
      const top = box.top - window.scrollY;
      if (top + box.h < 0 || top > vh) return;
      gl.uniform1f(uTime, time);
      gl.uniform1f(uRise, (vh - top) / (box.h + vh));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
  }
  if (reduceMotion) {
    bridge.classList.add("no-gl");
    quoteEl.classList.add("no-gl");
  } else {
    whenNear(bridge, () => initClouds($("#clouds"), CLOUD_FS, () => bridge.classList.add("no-gl")));
    whenNear(quoteEl, () => initClouds($("#quoteClouds"), QUOTE_CLOUD_FS, () => quoteEl.classList.add("no-gl")));
  }

  await yieldToMain();

  /* ------------------------------------------------------------------
   * Quote: the invitation rises in once, under the mark.
   * ---------------------------------------------------------------- */
  onView(".quote__copy .label", (t) => {
    motion.para(t, ".quote__copy .label", 0);
    motion.heading(t, "#quoteTitle .line > span", 0.08);
    motion.para(t, ".quote__copy .btn", 0.35);
  }, "top 85%");

  await yieldToMain();

  /* ------------------------------------------------------------------
   * The shipment marker, one design everywhere (both page routes and the
   * atlas): the container from the reference, a vivid blue 20ft box in
   * isometric view, long ribbed side to the front left, doors to the right,
   * a roof ribbed across its width, over a bright cyan ring and a pool of
   * blue light. Drawn in a 67 x 72 box shown at 64 x 68 px; its front-bottom
   * corner (ANCHOR) is the tracked point and stands on the route.
   * ---------------------------------------------------------------- */
  const containerMarkup = (id) => {
    const Lt = [1, 13], long = [43, 25], door = [22, -11], H = 33;
    const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
    const down = (p, k = H) => [p[0], p[1] + k];
    const f = (n) => +n.toFixed(2);
    const pts = (...ps) => ps.map((p) => p.map(f).join(",")).join(" ");
    const Ft = add(Lt, long), Bt = add(Lt, door), Rt = add(Ft, door);
    const Lb = down(Lt), Fb = down(Ft), Rb = down(Rt);
    const line = (a, b) => `M${a.map(f)}L${b.map(f)}`;
    let roofDark = "", roofLight = "", sideDark = "", sideLight = "";
    for (let k = 1; k <= 17; k++) { // roof: ribs across the width
      const a = k / 18;
      roofDark += line(add(add(Lt, long, a), door, 0.06), add(add(Lt, long, a), door, 0.94));
      roofLight += line(add(add(Lt, long, a + 0.018), door, 0.06), add(add(Lt, long, a + 0.018), door, 0.94));
    }
    for (let k = 1; k <= 17; k++) { // long side: upright ribs
      const a = k / 18;
      sideDark += line(down(add(Lt, long, a), 2.2), down(add(Lt, long, a), H - 2.2));
      sideLight += line(down(add(Lt, long, a + 0.016), 2.2), down(add(Lt, long, a + 0.016), H - 2.2));
    }
    const d0 = 0.08, d1 = 0.92;
    const doorFrame = pts(down(add(Ft, door, d0), 2.6), down(add(Ft, door, d1), 2.6), down(add(Ft, door, d1), H - 2.6), down(add(Ft, door, d0), H - 2.6));
    const seam = line(down(add(Ft, door, 0.5), 2.6), down(add(Ft, door, 0.5), H - 2.6));
    const bars = [0.22, 0.36, 0.64, 0.78].map((s) => line(down(add(Ft, door, s), 4.5), down(add(Ft, door, s), H - 4))).join("");
    const lugs = [0.29, 0.71].flatMap((s) => [0.32, 0.68].map((h) => line(down(add(Ft, door, s - 0.05), H * h), down(add(Ft, door, s + 0.05), H * h)))).join("");
    const svg = `<svg class="marker__box" viewBox="0 0 67 72" aria-hidden="true">
      <defs>
        <linearGradient id="boxSide-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d8ae6" /><stop offset="1" stop-color="#1f63c4" /></linearGradient>
        <linearGradient id="boxRoof-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fc9ff" /><stop offset="1" stop-color="#5ea4f3" /></linearGradient>
        <linearGradient id="boxDoor-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d72d2" /><stop offset="1" stop-color="#1a54ac" /></linearGradient>
      </defs>
      <polygon fill="url(#boxSide-${id})" points="${pts(Lt, Ft, Fb, Lb)}" />
      <path stroke="#1a56b0" stroke-opacity="0.75" stroke-width="0.8" d="${sideDark}" />
      <path stroke="#7fbcff" stroke-opacity="0.7" stroke-width="0.55" d="${sideLight}" />
      <polygon fill="url(#boxDoor-${id})" points="${pts(Ft, Rt, Rb, Fb)}" />
      <polygon fill="none" stroke="#3b7fd8" stroke-width="0.6" points="${doorFrame}" />
      <path stroke="#123f86" stroke-width="0.8" d="${seam}" />
      <path stroke="#5b9ce9" stroke-width="0.9" stroke-linecap="round" d="${bars}" />
      <path stroke="#7fb6f2" stroke-width="0.8" stroke-linecap="round" d="${lugs}" />
      <polygon fill="url(#boxRoof-${id})" points="${pts(Lt, Bt, Rt, Ft)}" />
      <path stroke="#3f88e0" stroke-opacity="0.8" stroke-width="0.7" stroke-linecap="round" d="${roofDark}" />
      <path stroke="#b9defe" stroke-opacity="0.85" stroke-width="0.6" stroke-linecap="round" d="${roofLight}" />
      <path stroke="#a6d4ff" stroke-width="0.8" stroke-linecap="round" d="${line(Lt, Ft)}${line(Ft, Rt)}" /><path stroke="#5d9fe8" stroke-width="0.7" d="${line(Ft, Fb)}" />
      <path stroke="#123f86" stroke-width="1.1" d="${line(Lb, Fb)}${line(Fb, Rb)}" />
      <polygon fill="none" stroke="#164a99" stroke-width="0.6" stroke-linejoin="round" points="${pts(Lt, Bt, Rt, Rb, Fb, Lb)}" />
    </svg>`;
    return `<span class="marker__bloom"></span><span class="marker__pad"></span>${svg}`;
  };
  const BOX_SCALE = 0.95;                      // 67 x 72 -> 64 x 68 px, as in the reference
  const ANCHOR = [44 * BOX_SCALE, 71 * BOX_SCALE]; // the front-bottom corner, on the route

  await yieldToMain();

  /* ------------------------------------------------------------------
   * Shipment tracking: the container marker rides two routes. Everything is a pure function of the scroll
   * position, so it runs the same forwards and backwards.
   *
   *   Route 1 starts on the Rockslink container on the ship (measured
   *   through the film's cover-fit). While the film is held, the route is
   *   held with it, so its origin stays on the container; when the film
   *   lets go, film and route leave together through the clouds. The pin
   *   arrives at the top of Services, where the Services route carries on.
   *   Services has its own route inside the held screen (updateServices):
   *   the container comes in from the top, passes the six checkpoints and
   *   stops above "Next section".
   *   Route 3 picks the container up again at the end of Services and
   *   brings it down onto the map as the map comes up out of the page: it
   *   ends exactly where Rotterdam is on screen when the atlas pins, and
   *   the atlas's own marker (the same design) takes over there.
   *   Route 2 runs from the bottom of the form down to the Rockslink mark in
   *   the closing quote; the pin docks into it and the mark lights up.
   *
   * The container's front-bottom corner is the tracked point. It sits on a "cursor line" on the
   * screen; the route under that line gives its x, and the way travelled
   * is drawn up to it.
   * ---------------------------------------------------------------- */
  const cargo = $("#cargo");
  cargo.innerHTML = containerMarkup("route");
  const mainEl = document.querySelector("main");
  const SHIP = [0.388, 0.727];  // the Rockslink container's face on the settled frame, 0..1
  const TIP = ANCHOR;           // the tracked point, in marker px
  const PAD = 40, SAMPLES = 400;
  const makeRoute = (id, kind) => {
    const el = document.getElementById(id);
    return {
      el, kind,
      ahead: el.querySelector(".route__ahead"),
      done: el.querySelector(".route__done"),
      under: el.querySelector(".route__under"),
      from: el.querySelector(".route__node--from"),
      to: el.querySelector(".route__node--to"),
      top: 0, H: 0, L: 0, holdUntil: -Infinity, appearAt: 0, originY: 0,
      xs: new Float32Array(SAMPLES + 1), ys: new Float32Array(SAMPLES + 1), ls: new Float32Array(SAMPLES + 1),
    };
  };
  const routes = [makeRoute("route1", "film"), makeRoute("route2", "quote"), makeRoute("route3", "map")];
  const docTop = (el) => el.getBoundingClientRect().top + window.scrollY;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeInOut = gsap.parseEase("sine.inOut");

  // waypoints joined by S-curves with vertical tangents: the route leaves
  // straight down, only ever moves down the page, and every height has
  // exactly one point. Routes are kept as cubic segments [p0, c1, c2, p1].
  function sCurve(pts) {
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const h = (y1 - y0) / 2;
      segs.push([[x0, y0], [x0, y0 + h], [x1, y1 - h], [x1, y1]]);
    }
    return segs;
  }
  const segsD = (segs) => `M${segs[0][0].map(f1)}` + segs.map(([, a, b, c]) => `C${a.map(f1)} ${b.map(f1)} ${c.map(f1)}`).join("");

  // sample a chain of cubics evenly by length into o.xs / o.ys / o.ls,
  // in plain arithmetic (getPointAtLength costs about a millisecond a call,
  // and this runs on every layout). Lengths are scaled to the browser's own
  // total (Lref), so the drawn dash meets the marker exactly. Returns the
  // length at each segment's end, from 0.
  function sampleSegs(segs, o, Lref, N = SAMPLES) {
    const K = 40;
    const px = [segs[0][0][0]], py = [segs[0][0][1]], pl = [0], ends = [0];
    for (const [p0, c1, c2, p1] of segs) {
      for (let k = 1; k <= K; k++) {
        const t = k / K, u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        const x = a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0];
        const y = a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1];
        pl.push(pl[pl.length - 1] + Math.hypot(x - px[px.length - 1], y - py[py.length - 1]));
        px.push(x); py.push(y);
      }
      ends.push(pl[pl.length - 1]);
    }
    const total = pl[pl.length - 1] || 1;
    const k = (Lref || total) / total;
    let j = 0;
    for (let i = 0; i <= N; i++) {
      const l = (i / N) * total;
      while (j < pl.length - 2 && pl[j + 1] < l) j++;
      const f = (l - pl[j]) / ((pl[j + 1] - pl[j]) || 1);
      o.xs[i] = px[j] + (px[j + 1] - px[j]) * f;
      o.ys[i] = py[j] + (py[j + 1] - py[j]) * f;
      o.ls[i] = l * k;
    }
    return ends.map((e) => e * k);
  }

  // top / end are page Y; waypoints are [x px, 0..1 down the route]
  function layRoute(r, top, end, waypoints) {
    const W = document.documentElement.clientWidth;
    const H = Math.max(1, end - top);
    r.top = top;
    r.H = H;
    // placed by transform (in updateCargo), not by top: moving it then is
    // not a layout shift
    r.ty = top - docTop(mainEl) - PAD;
    r.el.setAttribute("width", W);
    r.el.setAttribute("height", H + PAD * 2);
    r.el.setAttribute("viewBox", `0 ${-PAD} ${W} ${H + PAD * 2}`);
    const segs = sCurve(waypoints.map(([x, k]) => [x, k * H]));
    const d = segsD(segs);
    r.ahead.setAttribute("d", d);
    r.done.setAttribute("d", d);
    r.under.setAttribute("d", d);
    r.L = r.ahead.getTotalLength();
    r.done.style.strokeDasharray = r.under.style.strokeDasharray = `${r.L} ${r.L + 1}`;
    sampleSegs(segs, r, r.L);
    if (r.from) { r.from.setAttribute("cx", r.xs[0]); r.from.setAttribute("cy", 0); }
    if (r.to) { r.to.setAttribute("cx", r.xs[SAMPLES]); r.to.setAttribute("cy", H); }
  }

  /* The Services route, in the frame's own px. Held (wide screens): from
   * the top edge to the container's place under the header (S), then the
   * six checkpoints, each beside its card, then the end above "Next
   * section" (E). Narrow screens: straight down the rail beside the cards.
   * Tangents are vertical at both ends, so it meets route 1 above and
   * route 3 below without a kink. */
  const svcRoute = $("#svcRoute");
  const svc = {
    ahead: svcRoute.querySelector(".route__ahead"),
    under: svcRoute.querySelector(".route__under"),
    done: svcRoute.querySelector(".route__done"),
    links: svcRoute.querySelector(".svc-route__links"),
    nodesG: svcRoute.querySelector(".svc-route__nodes"),
    nodes: [], linkEls: [], knots: [], held: false,
    L: 0, top: 0, run: 0, step: 1, line: 0, x0: 0, endX: 0, endY: 0,
    xs: new Float32Array(SAMPLES + 1), ys: new Float32Array(SAMPLES + 1), ls: new Float32Array(SAMPLES + 1),
  };
  const SVC_SEGS = 7; // S to the first checkpoint, five between them, the last to E
  const svcSvg = (tag, attrs) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };
  const f1 = (n) => n.toFixed(1);

  function layoutServices() {
    const W = svcFrame.clientWidth, H = svcFrame.offsetHeight;
    const vh = window.innerHeight;
    svc.held = svcHeldMQ.matches; // the one-screen composition (held unless reduced motion)
    svc.top = docTop(svcTrack);
    svc.run = Math.max(0, svcTrack.offsetHeight - H);
    svc.step = svc.run / SVC_SEGS; // reaches the end exactly as the hold lets go
    // cards in frame px (offsets, so the reveal transforms do not count)
    const list = svcCards[0].offsetParent;
    const box = (el) => ({ l: list.offsetLeft + el.offsetLeft, t: list.offsetTop + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    const cards = svcCards.map(box);
    let pts, nodes, links = [];
    if (svc.held) {
      const gapR = W * 0.021, gapL = W * 0.018;
      nodes = cards.map((c, i) => {
        const right = svcCards[i].classList.contains("svc-card--r");
        const x = right ? c.l - gapR : c.l + c.w + gapL;
        const y = c.t + c.h * 0.34;
        // to the card's edge, and a short drop under the checkpoint
        const edge = right ? c.l - 3 : c.l + c.w + 3;
        links.push(`M${f1(x + (right ? 11 : -11))},${f1(y)}L${f1(edge)},${f1(y)}M${f1(x)},${f1(y + 10)}L${f1(x)},${f1(y + H * 0.06)}`);
        return [x, y];
      });
      const S = [W * 0.508, H * 0.197];
      const E = [W * 0.4994, H * 0.898];
      pts = [[W * 0.413, 0], S, ...nodes, E];
      svc.line = S[1];
    } else {
      const x = list.offsetLeft + 32; // the container's box clears the screen edge
      nodes = cards.map((c) => [x, c.t + 28]);
      links = cards.map((c, i) => `M${f1(x + 11)},${f1(nodes[i][1])}L${f1(c.l - 3)},${f1(nodes[i][1])}`);
      const last = cards[cards.length - 1];
      pts = [[x, 0], ...nodes, [x, last.t + last.h + 28]];
      svc.line = vh * 0.5;
    }
    // Catmull-Rom through the points, vertical at both ends
    const n = pts.length - 1;
    const tan = pts.map((p, i) => {
      if (i === 0) return [0, pts[1][1] - p[1]];
      if (i === n) return [0, p[1] - pts[n - 1][1]];
      return [(pts[i + 1][0] - pts[i - 1][0]) / 2, (pts[i + 1][1] - pts[i - 1][1]) / 2];
    });
    const segs = [];
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      segs.push([[x0, y0], [x0 + tan[i][0] / 3, y0 + tan[i][1] / 3], [x1 - tan[i + 1][0] / 3, y1 - tan[i + 1][1] / 3], [x1, y1]]);
    }
    const d = segsD(segs);
    [svc.ahead, svc.under, svc.done].forEach((el) => el.setAttribute("d", d));
    svcRoute.setAttribute("width", W);
    svcRoute.setAttribute("height", H);
    svcRoute.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svc.L = svc.ahead.getTotalLength();
    svc.done.style.strokeDasharray = svc.under.style.strokeDasharray = `${svc.L} ${svc.L + 1}`;
    // the length at each point: S (or the top), the checkpoints, the end
    const at = sampleSegs(segs, svc, svc.L);
    svc.knots = svc.held ? at.slice(1) : at;
    svc.x0 = pts[0][0];
    [svc.endX, svc.endY] = pts[n];
    // checkpoints and their dotted links
    svc.nodesG.textContent = "";
    svc.links.textContent = "";
    svc.nodes = nodes.map(([x, y]) => {
      const g = svcSvg("g", { class: "svc-node", transform: `translate(${f1(x)} ${f1(y)})` });
      g.append(svcSvg("ellipse", { class: "svc-node__glow", rx: 17, ry: 10.5 }), svcSvg("ellipse", { class: "svc-node__disc", rx: 9.5, ry: 6 }));
      svc.nodesG.append(g);
      return g;
    });
    svc.linkEls = links.map((dl) => {
      const el = svcSvg("path", { class: "svc-route__link", d: dl });
      svc.links.append(el);
      return el;
    });
    if (reduceMotion) {
      svc.done.style.strokeDashoffset = svc.under.style.strokeDashoffset = 0;
      svc.nodes.forEach((g) => g.classList.add("is-lit"));
    }
  }

  // a point of the Services route by length, and the length at a height
  // (the lead-in and the rail only ever go down the frame)
  function svcPointAtLen(l) {
    let lo = 0, hi = SAMPLES;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (svc.ls[m] <= l) lo = m; else hi = m;
    }
    const k = clamp01((l - svc.ls[lo]) / (svc.ls[hi] - svc.ls[lo] || 1));
    return [lerp(svc.xs[lo], svc.xs[hi], k), lerp(svc.ys[lo], svc.ys[hi], k)];
  }
  function svcLenAtY(y) {
    let lo = 0, hi = SAMPLES;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (svc.ys[m] <= y) lo = m; else hi = m;
    }
    const k = clamp01((y - svc.ys[lo]) / (svc.ys[hi] - svc.ys[lo] || 1));
    return lerp(svc.ls[lo], svc.ls[hi], k);
  }
  const svcGlide = (t) => 0.55 * t + 0.45 * t * t * (3 - 2 * t);
  const smooth01 = (t) => t * t * (3 - 2 * t);

  /* Where the container is on the Services route, as a pure function of the
   * scroll, and what that shows: the way travelled, the checkpoints passed,
   * and each card coming up beside its checkpoint as the container nears it
   * (from 45% of a leg before, fully there just after). Places the marker
   * when no page route has it (place = true); returns whether it did. */
  function updateServices(place) {
    if (!svc.L) return false;
    const sy = window.scrollY, vh = window.innerHeight;
    // the frame's top on screen: it scrolls in, is held at 0, then leaves
    const T = sy < svc.top ? svc.top - sy : Math.min(0, svc.top + svc.run - sy);
    let l, on;
    if (svc.held && sy >= svc.top) {
      // held: one leg per step of scroll, slowing a little at each checkpoint
      const u = Math.min(SVC_SEGS, (sy - svc.top) / svc.step);
      const k = Math.min(SVC_SEGS - 1, Math.floor(u));
      l = lerp(svc.knots[k], svc.knots[k + 1], svcGlide(u - k));
      on = true;
    } else {
      // coming in (or the rail): the container rides the cursor line
      const y = svc.line - T;
      on = y >= 0 || routes[0].passed;
      l = svcLenAtY(Math.min(Math.max(0, y), svc.held ? svc.line : svc.endY));
    }
    // s: 0 at S (or the rail's top), i + 1 at checkpoint i, SVC_SEGS at E
    const K = svc.knots;
    let ki = 0;
    while (ki < K.length - 2 && l > K[ki + 1]) ki++;
    const s = ki + clamp01((l - K[ki]) / ((K[ki + 1] - K[ki]) || 1));
    const off = svc.L - (on ? l : 0);
    svc.done.style.strokeDashoffset = svc.under.style.strokeDashoffset = off;
    svcCards.forEach((card, i) => {
      const r = Math.round(smooth01(clamp01((s - (i + 1) + 0.45) / 0.6)) * 1000) / 1000;
      svc.nodes[i].classList.toggle("is-lit", s >= i + 0.98);
      if (card._r === r) return;
      card._r = r;
      // up from beside its checkpoint: a short slide off the route, a fade,
      // the photo settling from a slight zoom
      const dir = card.classList.contains("svc-card--r") || !svc.held ? -1 : 1;
      card.style.opacity = r;
      card.style.pointerEvents = r < 0.5 ? "none" : "";
      card.style.transform = r >= 1 ? "" : `translate3d(${f1(dir * (1 - r) * 26)}px, ${f1((1 - r) * 10)}px, 0) scale(${(0.97 + 0.03 * r).toFixed(4)})`;
      card.querySelector(".svc-card__img").style.transform = r >= 1 ? "" : `scale(${(1.08 - 0.08 * r).toFixed(4)})`;
      svc.linkEls[i].style.opacity = r;
    });
    // "Next section" steps aside just before route 3 sets out over it
    svcNext.parentNode.style.opacity = svc.held ? 1 - clamp01((sy - svc.top - svc.run + vh * 0.08) / (vh * 0.12)) : "";
    // past the end once route 3 has carried the container on to the map
    if (!on || !place || routes[2].passed) return false;
    const [x, y] = svcPointAtLen(l);
    const sx = x, syc = T + y; // the frame spans the full width
    if (syc < -120 || syc > vh + 120) return false;
    placePin(sx, syc, 1, 1);
    return true;
  }

  function layoutRoutes() {
    layoutServices();
    const vh = window.innerHeight;
    const W = document.documentElement.clientWidth;
    const A = Math.min(W * 0.22, 300);

    // route 1 origin: the container, through the film's cover-fit framing
    const sw = sticky.clientWidth, sh = sticky.clientHeight;
    const fs = Math.max(sw / 1920, sh / 1080), fw = 1920 * fs;
    const fx = Math.min(0, Math.max(sw - fw, sw / 2 - fw * focusX(OCEAN_LAST)));
    const shipX = fx + SHIP[0] * fw;
    const shipY = (sh - 1080 * fs) / 2 + SHIP[1] * 1080 * fs;
    const r1 = routes[0];
    r1.holdUntil = unitToScroll(TOTAL); // the film lets go here
    r1.appearAt = unitToScroll(CARGO_IN);
    r1.originY = shipY;
    // destination: the top of the Services route, which carries on from there
    const toX = svcFrame.getBoundingClientRect().left + svc.x0;
    layRoute(r1, r1.holdUntil + shipY, svc.top, [[shipX, 0], [(shipX + toX) / 2 + A, 0.5], [toX, 1]]);
    // the cursor line rises to the Services line by the time the route ends
    r1.handAt = svc.top - svc.line;

    // route 2: from the top of the quote (just below the form) to the centre
    // of the Rockslink mark
    const lg = quoteLogo.getBoundingClientRect();
    layRoute(routes[1], docTop(quoteEl), lg.top + window.scrollY + lg.height / 2,
      [[W / 2, 0], [W / 2 + A, 0.5], [W / 2, 1]]);

    // route 3: from under the last service down onto Rotterdam, which the
    // atlas reports in screen px for the moment it pins
    const r3 = routes[2];
    if (atlasEntry) {
      const e = atlasEntry();
      // its cursor line starts where the container is as Services lets go
      // (no wait) and glides to Rotterdam's height by the time the map pins
      r3.line0 = svc.held ? svc.endY : svc.line;
      r3.line1 = e.y;
      const from = svc.top + svc.run + svc.endY;
      const fx = svcFrame.getBoundingClientRect().left + svc.endX;
      layRoute(r3, from, e.top + e.y, [[fx, 0], [(fx + e.x) / 2 - A * 0.6, 0.5], [e.x, 1]]);
      r3.pinTop = e.top;
      r3.sy0 = from - r3.line0;
      r3.sy1 = e.top;
    }
  }

  // the point of a route at height y (binary search on the samples)
  function pointAt(r, y) {
    let lo = 0, hi = SAMPLES;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (r.ys[m] <= y) lo = m; else hi = m;
    }
    const k = clamp01((y - r.ys[lo]) / (r.ys[hi] - r.ys[lo] || 1));
    return { x: lerp(r.xs[lo], r.xs[hi], k), l: lerp(r.ls[lo], r.ls[hi], k) };
  }

  // the marker, its corner on (x, y), growing out of that corner
  function placePin(x, y, scale, opacity) {
    cargo.style.transformOrigin = `${TIP[0]}px ${TIP[1]}px`;
    cargo.style.transform = `translate3d(${x - TIP[0]}px, ${y - TIP[1]}px, 0) scale(${scale})`;
    cargo.style.opacity = opacity;
  }

  // both run on every tick but depend only on the scroll: when the page has
  // not moved since the last tick there is nothing to do (a refresh clears
  // the record, as the layout under them may have changed)
  const lastAt = { cargo: NaN, atlas: NaN };
  const moved = (k) => {
    const at = window.scrollY + window.innerHeight * 1e6;
    if (at === lastAt[k]) return false;
    lastAt[k] = at;
    return true;
  };
  function updateCargo() {
    if (!routes[0].L || !moved("cargo")) return;
    const vh = window.innerHeight, sy = window.scrollY;
    let shown = false;
    routes.forEach((r, i) => {
      r.placed = false;
      if (!r.L) return;
      // route 1 is held with the film until the film lets go
      const eff = Math.max(sy, r.holdUntil);
      r.el.style.transform = `translate3d(0, ${r.ty + sy - eff}px, 0)`;
      const routeTop = r.top - eff; // route start, on screen

      let line, appear;
      if (r.kind === "film") {
        // the cursor line starts on the container, eases down a little while
        // the film is held, then settles at 55% once film and route move
        const hold = clamp01((sy - r.appearAt) / Math.max(1, r.holdUntil - r.appearAt));
        const after = easeInOut(clamp01((sy - r.holdUntil) / (vh * 0.8)));
        line = lerp(r.originY + vh * 0.14 * hold, vh * 0.55, after);
        // then rises to the Services line, reached as the route ends there
        const win = Math.max(vh * 0.6, r.handAt - (r.holdUntil + vh * 0.8));
        line = lerp(line, svc.line, smooth01(clamp01((sy - (r.handAt - win)) / win)));
        appear = clamp01((sy - r.appearAt) / (vh * 0.06));
      } else {
        // route 3: from the container's height at the end of Services to
        // Rotterdam's height as the map pins
        line = r.kind === "map" ? lerp(r.line0, r.line1, clamp01((sy - r.sy0) / (r.sy1 - r.sy0))) : vh * 0.5;
        appear = clamp01((line - routeTop) / (vh * 0.08) + 1);
      }
      const y = line - routeTop; // the cursor line, in route space
      r.passed = y > r.H;
      if (r.kind === "map" && y <= r.H) r.el.style.opacity = "";

      const on = appear > 0;
      if (r.from) r.from.classList.toggle("is-on", on);
      if (r.to) r.to.classList.toggle("is-on", on);
      if (r.kind === "quote") quoteLogo.style.setProperty("--dock", clamp01((y - r.H) / (vh * 0.12)));
      r.ahead.style.opacity = 0.75 * appear;
      if (!on) {
        r.done.style.strokeDashoffset = r.under.style.strokeDashoffset = r.L;
        return;
      }
      if (y <= r.H) {
        const p = pointAt(r, Math.max(0, y));
        r.done.style.strokeDashoffset = r.under.style.strokeDashoffset = r.L - p.l;
        // route 3 takes the container only once it reaches the line; until
        // then it waits at the end of the Services route
        if (r.kind === "map" && y < 0) return;
        placePin(p.x, routeTop + Math.max(0, y), r.kind === "map" ? 1 : 0.4 + 0.6 * appear, r.kind === "map" ? 1 : appear);
        r.placed = shown = true;
        return;
      }
      r.done.style.strokeDashoffset = r.under.style.strokeDashoffset = 0;
      if (r.kind === "film") return; // the Services route has it now
      if (r.kind === "map") {
        // handed over to the atlas's marker on Rotterdam; the line on the
        // page fades as the pinned map stays and the page moves on
        r.el.style.opacity = 1 - clamp01((y - r.H) / (vh * 0.2));
        return;
      }
      const endX = r.xs[SAMPLES], endY = routeTop + r.H;
      // arrived: route 2 shrinks into the Rockslink mark as the mark lights up
      const k = clamp01((y - r.H) / (vh * 0.12));
      if (k < 1) {
        placePin(endX, endY, 1 - 0.7 * k, 1 - k);
        r.placed = shown = true;
      }
    });
    if (updateServices(!shown)) shown = true;
    cargo.style.visibility = shown ? "visible" : "hidden";
  }

  if (!reduceMotion) {
    layoutRoutes();
    ScrollTrigger.addEventListener("refresh", () => { layoutRoutes(); lastAt.cargo = NaN; updateCargo(); });
    gsap.ticker.add(updateCargo);
  } else {
    layoutServices();
    window.addEventListener("resize", layoutServices);
  }

  await yieldToMain();

  /* ------------------------------------------------------------------
   * FAQ + Contact: the atlas. A plaster relief map of the world held on a
   * sticky stage, with the shipment route from the contact reference:
   * Rotterdam, Gdańsk, Odesa, Baku, then down through the Gulf and the
   * Indian Ocean (Jebel Ali, Mumbai, Port Louis), up through Beira and
   * Kinshasa, and home to Alexandria. Each port answers one question.
   * At the end the camera settles on Europe and Africa, the FAQ heading
   * leaves, and the contact block rises over the map with the container
   * resting at Alexandria between the details and the form.
   *
   * Map, route, checkpoints and container share one coordinate system: the
   * map's own 2500 x 1450 frame, which is the contact reference's 1672 x 941
   * view (cleaned of its route and markers by tools/clean-reference.py) with
   * a margin of 400 / 250 around it. The checkpoints sit where the
   * reference has its lights (data-x / data-y on each answer). One camera
   * transform moves it all; side by side it never moves at all. Everything is a pure function of the scroll
   * position, so it runs the same forwards and backwards:
   *   u = scroll past the top of the pin, in steps of 70vh (55vh on phones)
   *   the container glides along the route with the scroll, never parked:
   *   the first half step is Rotterdam, then each step is one leg, eased
   *   only enough to slow it a little as it passes each port. The answer
   *   on show is the nearest port's. From Kinshasa it carries straight on
   *   home (HOME_VH) and eases to a stop at Alexandria.
   * ---------------------------------------------------------------- */
  const atlasPin = $("#atlasPin");
  // the relief map image arrives only as the FAQ comes near
  whenNear(atlasPin, () => {
    const img = document.querySelector(".atlas__map");
    if (img.dataset.srcset) { img.srcset = img.dataset.srcset; img.src = img.dataset.src; }
    document.documentElement.classList.add("map-ready");
  });
  const atlasStage = $("#atlasStage");
  const atlasWorld = $("#atlasWorld");
  const atlasVeil = $("#atlasVeil");
  const atlasMarker = $("#atlasMarker");
  const atlasPlace = $("#atlasPlace");
  const atlasCard = $("#atlasCard");
  const atlasHead = $(".atlas__head");
  const atlasSteps = $("#atlasSteps");
  const qItems = [...document.querySelectorAll(".atlas__q")];
  const stepBtns = [...document.querySelectorAll("#atlasSteps button")];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAP_W = 2500, MAP_H = 1450;              // the baked map's frame
  const REF = { x: 400, y: 250, w: 1672, h: 941 }; // the reference view inside it
  const LEAD = 0.5;  // half a step at Rotterdam before the glide starts
  const HOME_VH = 0.35;  // the trip home, in viewport heights (--home in the CSS)
  const svgEl = (tag, attrs, parent) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    parent.appendChild(el);
    return el;
  };

  const stops = [
    ...qItems.map((li) => ({
      name: li.querySelector(".atlas__port").lastChild.textContent.split(",")[0].trim(),
      p: [+li.dataset.x, +li.dataset.y],
    })),
    { name: "Alexandria", p: [1097, 728] }, // where the reference's container stands
  ];

  // the route: one smooth curve through every port (Catmull-Rom, written as
  // a cubic Bézier per leg so each leg can be drawn and sailed on its own).
  // The way travelled is drawn by its dash (pathLength 1, so the offset is
  // simply the share still to go): no masks, so moving it only repaints the
  // leg itself, not the whole map-sized route layer. The dashed way ahead
  // is also the path the container rides.
  const routesSvg = $("#atlasRoutes");
  const defs = routesSvg.querySelector("defs");
  const legsG = $("#atlasLegs");
  const P = (i) => stops[Math.max(0, Math.min(stops.length - 1, i))].p;
  const LEG_N = 240;
  const legAt = (leg, e) => {
    const f = Math.min(LEG_N, Math.max(0, e * LEG_N)), i = Math.min(LEG_N - 1, Math.floor(f)), t = f - i;
    return { x: lerp(leg.pts.xs[i], leg.pts.xs[i + 1], t), y: lerp(leg.pts.ys[i], leg.pts.ys[i + 1], t) };
  };
  const legs = stops.slice(1).map((_, i) => {
    const [x0, y0] = P(i), [x1, y1] = P(i + 1), [xa, ya] = P(i - 1), [xb, yb] = P(i + 2);
    const c1 = [x0 + (x1 - xa) / 6, y0 + (y1 - ya) / 6];
    const c2 = [x1 - (xb - x0) / 6, y1 - (yb - y0) / 6];
    const d = `M${x0},${y0} C${c1} ${c2} ${x1},${y1}`;
    const g = svgEl("g", { class: "leg" }, legsG);
    const reveal = svgEl("path", { class: "leg__ahead", d }, g);
    const L = reveal.getTotalLength();
    const pts = { xs: new Float32Array(LEG_N + 1), ys: new Float32Array(LEG_N + 1), ls: new Float32Array(LEG_N + 1) };
    sampleSegs([[[x0, y0], c1, c2, [x1, y1]]], pts, L, LEG_N);
    // butt ends, so the drawn line stops exactly at the container
    const drawn = [svgEl("path", { class: "leg__under", d, pathLength: 1 }, g), svgEl("path", { class: "leg__done", d, pathLength: 1 }, g)];
    drawn.forEach((el) => { el.style.strokeDasharray = "1 2"; el.style.strokeDashoffset = 1; });
    return { reveal, drawn, pts, L, k: 0, len: Math.hypot(x1 - x0, y1 - y0) };
  });

  // checkpoints: tracking beacons drawn at screen size (scaled back by the
  // camera zoom): light spill, a soft cyan ring, a raised white-blue node
  const portsG = $("#atlasPorts");
  const ports = stops.map((s, i) => {
    const home = i === stops.length - 1;
    const g = svgEl("g", { class: home ? "port port--home" : "port", transform: `translate(${s.p[0]} ${s.p[1]})` }, portsG);
    const art = svgEl("g", { class: "port__art" }, g);
    svgEl("circle", { class: "port__spill", r: 24 }, art);
    svgEl("circle", { class: "port__glow", r: 13 }, art);
    svgEl("circle", { class: "port__ring", r: 13 }, art);
    svgEl("ellipse", { class: "port__shadow", cx: 0.8, cy: 2.6, rx: 6.5, ry: 3.4 }, art);
    svgEl("circle", { class: "port__node", r: 6.5 }, art);
    svgEl("circle", { class: "port__shine", cx: -1.9, cy: -2.1, r: 2 }, art);
    return g;
  });


  const atlasEdge = document.createElement("div");
  atlasEdge.className = "atlas__edge";
  atlasEdge.setAttribute("aria-hidden", "true");
  atlasStage.append(atlasEdge);
  const atlasPulse = document.createElement("span");
  atlasPulse.className = "atlas__pulse";
  atlasPulse.setAttribute("aria-hidden", "true");
  atlasPulse.innerHTML = "<i></i>";
  atlasWorld.append(atlasPulse);

  atlasMarker.innerHTML = containerMarkup("atlas");
  const atlas = { k: 1, endK: 1, endX: 0, endY: 0, vw: 0, vh: 0, mobile: false, pinTop: 0, pinEnd: 0, step: 1, homeU: 1, q: -2 };
  function layoutAtlas() {
    const vw = atlasStage.clientWidth, vh = atlasStage.clientHeight;
    const mobile = vw < 720;
    // phones follow the container at a little under the reference's scale
    const k = mobile ? Math.max(vw * 0.0022, (vh / MAP_H) * 1.1) : Math.max(vw * 0.001005, (vh / MAP_H) * 1.15);
    const stepVh = mobile ? 0.32 : 0.36; // --step in the CSS
    // the contact framing is the reference's own view, scaled to cover the
    // screen and centred; stacked layouts centre Alexandria above the form
    const split = vw > 900;
    const kh = Math.max(vw / REF.w, vh / REF.h);
    const homeTx = vw / 2 - (REF.x + REF.w / 2) * kh, homeTy = vh / 2 - (REF.y + REF.h / 2) * kh;
    const [hx, hy] = stops[stops.length - 1].p;
    Object.assign(atlas, {
      vw, vh, mobile, k, split, kh, homeTx, homeTy,
      endK: split ? kh : k,
      endX: split ? homeTx + hx * kh : vw / 2,
      endY: split ? homeTy + hy * kh : vh * 0.24,
      pinTop: docTop(atlasPin),
      pinEnd: docTop(atlasPin) + atlasPin.offsetHeight,
      step: window.innerHeight * stepVh,
      homeU: HOME_VH / stepVh,
    });
    // the contact block sticks with its bottom on the screen's bottom (its
    // top, when it fits), so the whole form holds still through the dwell
    const ch = contactSection.offsetHeight;
    contactSection.style.setProperty("--ct-top", `${Math.min(0, window.innerHeight - ch)}px`);
  }

  // where Rotterdam is on screen as the map pins (u = 0), for route 3
  atlasEntry = () => {
    const [x, y] = stops[0].p;
    const { vw, vh } = atlas;
    if (atlas.split) return { x: atlas.homeTx + x * atlas.kh, y: atlas.homeTy + y * atlas.kh, top: atlas.pinTop };
    const zk = Math.max(Math.max(vh / MAP_H, vw / MAP_W), atlas.k);
    const tx = Math.min(0, Math.max(vw - MAP_W * zk, 0.5 * vw - x * zk));
    const ty = Math.min(vh * 0.22, Math.max(vh - MAP_H * zk, 0.42 * vh - y * zk));
    return { x: tx + x * zk, y: ty + y * zk, top: atlas.pinTop };
  };

  // where the journey is at u: which leg, how far along it, which answer,
  // and how many ports have been reached
  // glide: mostly linear, with a gentle slow-down through each port
  const glide = (t) => 0.55 * t + 0.45 * t * t * (3 - 2 * t);
  function journeyAt(u) {
    const n = qItems.length;
    if (u < n) {
      // s: position along the route in ports (0 = Rotterdam, n - 1 = Kinshasa)
      const s = Math.min(n - 1, Math.max(0, (u - LEAD) * (n - 1) / (n - LEAD)));
      const leg = Math.min(n - 2, Math.floor(s));
      const t = s - leg;
      // the first answer waits until the map has settled under the container
      const q = u >= 0.22 ? Math.round(s) : -1;
      return { leg, t, e: glide(t), q, arrived: u >= 0 ? Math.floor(s + 0.02) + 1 : 0 };
    }
    // home: leaves Kinshasa at the glide's speed, settles at Alexandria
    const t = clamp01((u - n) / atlas.homeU);
    const e = 0.5 * t + 2 * t * t - 1.5 * t * t * t;
    return { leg: n - 1, t, e, q: -1, arrived: n, home: true };
  }

  function updateAtlas() {
    if (!moved("atlas")) return;
    const sy = window.scrollY, vhWin = window.innerHeight;
    // the floating WhatsApp button would sit on the answer card: the form
    // at the end of the journey offers WhatsApp instead
    document.body.classList.toggle("in-atlas", sy > atlas.pinTop - vhWin * 0.2 && sy < atlas.pinEnd - vhWin * 0.5);
    if (sy < atlas.pinTop - vhWin || sy > atlas.pinEnd) return;
    const { vw, vh } = atlas;
    atlasVeil.style.opacity = clamp01((atlas.pinTop - sy) / vhWin);
    const edge = clamp01((atlas.pinTop - sy) / (vhWin * 0.12)).toFixed(3);
    if (atlasEdge.style.opacity !== edge) atlasEdge.style.opacity = edge;

    const u = (sy - atlas.pinTop) / atlas.step;
    const j = journeyAt(u);
    const leg = legs[j.leg];
    const e = j.e;
    const pos = legAt(leg, e);

    // the FAQ heading and step dots leave on the way home, so nothing of
    // them is left behind the contact block
    const faqOut = clamp01((u - qItems.length) / (atlas.homeU * 0.35));
    atlasHead.style.opacity = atlasSteps.style.opacity = 1 - faqOut;
    atlasHead.style.visibility = atlasSteps.style.visibility = faqOut >= 1 ? "hidden" : "";
    atlasStage.classList.toggle("is-home", faqOut >= 0.5);

    // camera. Side by side: the reference's framing, held still from the
    // first question to the form; only the container and the lights move.
    // Stacked: follow the container, pulling back a little on long legs, and
    // ease to the contact framing on the way home.
    const home = j.home ? e : 0;
    let zk, tx, ty;
    if (atlas.split) {
      zk = atlas.kh;
      tx = atlas.homeTx;
      ty = atlas.homeTy;
    } else {
      const minK = Math.max(vh / MAP_H, vw / MAP_W);
      const baseK = lerp(atlas.k, atlas.endK, home);
      zk = Math.max(minK, baseK * (1 - 0.14 * Math.sin(Math.PI * j.t) * Math.min(1, leg.len / 390)));
      const ax = lerp(0.5 * vw, atlas.endX, home);
      const ay = lerp(0.42 * vh, atlas.endY, home);
      // the stage is sea-coloured, so the map may slide a little past its top
      const padY = vh * 0.22;
      tx = Math.min(0, Math.max(vw - MAP_W * zk, ax - pos.x * zk));
      ty = Math.min(padY, Math.max(vh - MAP_H * zk, ay - pos.y * zk));
    }
    atlasWorld.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${zk})`;
    const zs = zk.toFixed(3);
    if (zs !== atlas.zs) { atlas.zs = zs; atlasWorld.style.setProperty("--z", zs); } // beacons stay one size on screen
    const sx = tx + pos.x * zk, syc = ty + pos.y * zk;
    atlasMarker.style.transform = `translate3d(${sx - ANCHOR[0]}px, ${syc - ANCHOR[1]}px, 0)`;
    // until the pin, the page's marker is still on its way down (route 3)
    atlasMarker.style.visibility = u >= 0 ? "" : "hidden";

    // Alexandria's tag belongs to the contact framing
    const [hx, hy] = stops[stops.length - 1].p;
    atlasPlace.style.transform = `translate3d(${tx + hx * zk + 12}px, ${ty + hy * zk - 100}px, 0)`;
    atlasPlace.style.opacity = j.home ? clamp01((j.t - 0.8) / 0.2) : 0;

    legs.forEach((l, i) => {
      const k = i < j.leg ? 1 : i === j.leg ? Math.round(e * 2000) / 2000 : 0;
      if (k === l.k) return; // only the leg under way changes
      l.k = k;
      l.drawn.forEach((el) => { el.style.strokeDashoffset = 1 - k; });
    });

    const atHome = j.home && j.t >= 1;
    if (j.q === atlas.q && j.arrived === atlas.arrived && atHome === atlas.atHome) return;
    atlas.q = j.q;
    atlas.arrived = j.arrived;
    atlas.atHome = atHome;
    ports.forEach((p, i) => {
      const isHome = i === ports.length - 1;
      p.classList.toggle("is-lit", isHome ? atHome : i < j.arrived);
      p.classList.toggle("is-active", isHome ? atHome : i === j.q);
    });
    qItems.forEach((li, i) => li.classList.toggle("is-active", i === j.q));
    const pulseAt = atHome ? stops.length - 1 : j.q;
    atlasPulse.classList.toggle("is-on", pulseAt >= 0);
    if (pulseAt >= 0) atlasPulse.style.translate = `${stops[pulseAt].p[0]}px ${stops[pulseAt].p[1]}px`;
    atlasCard.classList.toggle("is-on", j.q >= 0);
    stepBtns.forEach((b, i) => {
      b.classList.toggle("is-done", i < j.arrived && i !== j.q);
      b.classList.toggle("is-active", i === j.q);
      b.setAttribute("aria-current", i === j.q ? "step" : "false");
    });
    indexItems.forEach((b, i) => b.setAttribute("aria-current", i === j.q ? "step" : "false"));
  }

  // the step dots jump to the moment the container is on that port
  const n9 = qItems.length;
  const toQuestion = (i) => scrollTo(atlas.pinTop + (LEAD + (i * (n9 - LEAD)) / (n9 - 1)) * atlas.step);
  stepBtns.forEach((b, i) => b.addEventListener("click", () => toQuestion(i)));

  // all questions at a glance: a list under the heading; picking one sails
  // the container there (or, without motion, scrolls to that answer)
  const indexBtn = $("#atlasIndexBtn");
  const indexList = $("#atlasIndex");
  const indexItems = [...indexList.querySelectorAll("button")];
  const setIndex = (open) => {
    indexBtn.setAttribute("aria-expanded", open);
    indexList.hidden = !open;
  };
  indexBtn.addEventListener("click", () => setIndex(indexList.hidden));
  indexItems.forEach((b, i) => b.addEventListener("click", () => {
    setIndex(false);
    if (reduceMotion) qItems[i].scrollIntoView();
    else toQuestion(i);
    indexBtn.focus();
  }));
  document.addEventListener("click", (e) => { if (!indexList.hidden && !e.target.closest(".atlas__index")) setIndex(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !indexList.hidden) { setIndex(false); indexBtn.focus(); } });

  if (!reduceMotion) {
    layoutAtlas();
    layoutRoutes(); // route 3 needs the atlas layout
    ScrollTrigger.addEventListener("refresh", () => { layoutAtlas(); atlas.q = -2; lastAt.atlas = lastAt.cargo = NaN; updateAtlas(); layoutRoutes(); updateCargo(); });
    gsap.ticker.add(updateAtlas);
  }

  // the FAQ heading once the map is most of the way up the screen (on
  // phones, once it has pinned: the container drops past the heading's
  // place on its way to Rotterdam)
  onView(".atlas__head", (t) => {
    motion.para(t, ".atlas__head .label", 0);
    motion.heading(t, "#atlasTitle .line > span", 0.08);
    motion.para(t, [".atlas__index", ".atlas__skip"], 0.3);
  }, window.innerWidth < 720 ? "top 2%" : "top 35%");

  await yieldToMain();

  /* ------------------------------------------------------------------
   * Contact: the invitation first, then the details and the form together.
   * ---------------------------------------------------------------- */
  onView(".atlas__contact", (t) => {
    motion.para(t, ".contact__topline", 0);
    motion.heading(t, "#ctTitle .line > span", 0.05);
    motion.para(t, ".contact__lede", 0.3);
    motion.para(t, ".enquiry", 0.35);
    motion.cards(t, [".info > div", ".office-card"], 0.42);
  }, "top 70%");

  await yieldToMain();

  /* ------------------------------------------------------------------
   * Footer: it simply follows the quote, full width. Only the wordmark
   * moves: it rises up through its own mask as it comes into view, and
   * goes back down if you scroll back above it.
   * ---------------------------------------------------------------- */
  if (!reduceMotion) {
    gsap.fromTo(".footer__word span", { yPercent: 105 }, {
      yPercent: 0,
      duration: 1.1,
      ease: M.ease,
      scrollTrigger: { trigger: ".footer__word", start: "top 96%", toggleActions: "play none none reverse" },
    });
  }

  await yieldToMain();

  /* ------------------------------------------------------------------
   * Enquiry form
   * ---------------------------------------------------------------- */
  const form = $("#enquiry");
  const statusEl = $("#enquiryStatus");
  const serviceSelect = $("#serviceSelect");

  function setService(name) {
    serviceSelect.value = name;
    serviceSelect.closest(".field").classList.remove("is-invalid");
  }

  const readForm = () => Object.fromEntries(new FormData(form).entries());

  function enquiryText(d) {
    return [
      "New shipment enquiry",
      `Name: ${d.name}`,
      d.company && `Company: ${d.company}`,
      `Phone: ${d.phone}`,
      d.email && `Email: ${d.email}`,
      `Service: ${d.service}`,
      (d.origin || d.destination) && `Route: ${d.origin || "?"} to ${d.destination || "?"}`,
      `Cargo: ${d.cargo}`,
    ].filter(Boolean).join("\n");
  }

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "enquiry__status" + (kind ? ` is-${kind}` : "");
  }

  function validate() {
    let firstBad = null;
    form.querySelectorAll("[required]").forEach((el) => {
      const field = el.closest(".field");
      const bad = !el.value.trim();
      field.classList.toggle("is-invalid", bad);
      if (bad && !firstBad) firstBad = el;
    });
    const email = form.elements.email;
    if (email.value && !email.checkValidity()) {
      email.closest(".field").classList.add("is-invalid");
      firstBad = firstBad || email;
    }
    if (firstBad) {
      firstBad.focus({ preventScroll: true });
      setStatus("Please fill in the highlighted fields.", "error");
      return false;
    }
    return true;
  }

  form.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field && e.target.value.trim()) field.classList.remove("is-invalid");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const data = readForm();
    if (data.website) return; // honeypot filled: silently drop spam
    delete data.website;

    const endpoint = form.dataset.endpoint;
    const submit = form.querySelector('[type="submit"]');
    if (endpoint) {
      // FormSubmit (formsubmit.co) delivers the enquiry to sales@rockslink.com.
      submit.disabled = true;
      setStatus("Sending…");
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            ...data,
            _subject: `Shipment enquiry: ${data.service}`,
            _replyto: data.email || undefined,
            _template: "table",
          }),
        });
        // FormSubmit answers 200 with success "false" until the inbox has
        // confirmed its activation email, so read the body too
        const out = await res.json().catch(() => ({}));
        if (!res.ok || String(out.success) === "false") throw new Error(out.message || res.status);
        form.reset();
        setStatus("Thank you. Your enquiry is with our team and we reply with a price within one working day.", "ok");
      } catch {
        setStatus("The enquiry could not be sent. Please try again or use WhatsApp.", "error");
      } finally {
        submit.disabled = false;
      }
    } else {
      // No form service connected yet: hand the enquiry to the visitor's email app.
      const subject = `Shipment enquiry: ${data.service}`;
      window.location.href = `mailto:${form.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(enquiryText(data))}`;
      setStatus("Your email app has opened with the enquiry ready. Press send there to reach our team.", "ok");
    }
  });

  $("#enquiryWa").addEventListener("click", () => {
    if (!validate()) return;
    const url = `https://wa.me/${form.dataset.whatsapp}?text=${encodeURIComponent(enquiryText(readForm()))}`;
    window.open(url, "_blank", "noopener");
    setStatus("WhatsApp has opened with your enquiry. Press send there to reach our team.", "ok");
  });

  await yieldToMain();

  /* ------------------------------------------------------------------
   * Boot
   * ---------------------------------------------------------------- */
  // a phone's address bar showing or hiding changes the height a little:
  // only a real change of width or height re-lays out the page
  let lastW = window.innerWidth, lastH = window.innerHeight;
  window.addEventListener("resize", () => {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === lastW && Math.abs(h - lastH) < 160) return;
    lastW = w; lastH = h;
    resize();
    ScrollTrigger.refresh();
  });
  // layout settles once fonts and images arrive: re-measure every trigger,
  // once, however many of those arrive together
  // (one re-measure for all of them, in a quiet moment, and only if the
  // page has actually changed size since it was last measured: a full
  // re-measure is the most expensive thing at start-up)
  const layoutSig = () => [document.documentElement.scrollHeight, window.innerWidth, window.innerHeight, pageTop(svcEl), pageTop(faqSection), pageTop(quoteEl)].map(Math.round).join(",");
  let measuredSig = layoutSig();
  ScrollTrigger.addEventListener("refresh", () => { measuredSig = layoutSig(); });
  let refreshTimer = 0;
  const settle = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const run = () => { if (layoutSig() !== measuredSig) ScrollTrigger.refresh(); };
      if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 1500 });
      else run();
    }, 150);
  };
  window.addEventListener("load", settle);
  if (document.fonts) document.fonts.ready.then(settle);
  // every section is in place: measure once for all of them (together with
  // the load and font re-measure, if those are still to come)
  settle();
  // arriving from another page with a section in the link (the footer of
  // the legal pages): go straight there
  const hash = location.hash;
  if (hash && hash !== "#top") {
    const target = hash === "#about" ? unitToScroll(CHAPTERS[1] + 4) : document.querySelector(hash);
    if (target) requestAnimationFrame(() => scrollTo(target, { immediate: true }));
  }
})();
