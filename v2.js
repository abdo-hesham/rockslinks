(() => {
  "use strict";

  gsap.registerPlugin(ScrollTrigger);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) document.documentElement.classList.add("rm");

  /* ------------------------------------------------------------------
   * Config
   * ---------------------------------------------------------------- */
  const FRAME_COUNT = 192;
  const isSmall = Math.min(window.innerWidth, window.innerHeight) < 600 && window.innerWidth < 900;
  const saveData = navigator.connection && navigator.connection.saveData;
  const FRAME_DIR = isSmall || saveData ? "frames-m" : "frames";
  const frameSrc = (i) => `${FRAME_DIR}/f_${String(i + 1).padStart(3, "0")}.webp`;

  // Timeline is measured in "units" of scroll. The drone shot plays linearly
  // between FILM_KEYS ([unit, frame] pairs; the last pair is where the settle
  // begins), then settles on a clean ocean frame (before the haze rolls in).
  // On that frame the ship's wake is traced in amber and runs down out of
  // the screen, where the page's thread picks it up.
  const FILM_KEYS = [[0, 0], [19, 48], [79.6, 140]];
  const OCEAN_LAST = 148; // the settle runs from FILM_KEYS' last frame to here
  const TOTAL = 114;
  const CHAPTERS = [0, 33, 74];
  const WAKE_AT = 90, WAKE_LEN = 16; // units over which the wake is drawn
  // the wake on frame OCEAN_LAST, from the stern back to the left edge, as
  // fractions of the frame (traced on the 1920 x 1080 frame)
  const WAKE = [[445, 712], [380, 700], [300, 672], [200, 632], [100, 595], [0, 565]].map(([x, y]) => [x / 1920, y / 1080]);
  const FRAME_W = 1920, FRAME_H = 1080;
  const READ_LINE = 0.62; // the thread fills to this height of the screen

  /* ------------------------------------------------------------------
   * Elements and shared state
   * ---------------------------------------------------------------- */
  const $ = (s) => document.querySelector(s);
  const canvas = $("#filmCanvas");
  const ctx = canvas.getContext("2d");
  const film = $("#film");
  const sticky = film.querySelector(".film__sticky");
  const nav = $("#nav");
  const loadline = $("#loadline");
  const loadFill = $("#loadFill");
  const railFill = $("#railFill");
  const wakePath = $("#wakePath");
  const voyage = $("#voyage");
  const thread = $("#thread");
  const knots = [...document.querySelectorAll(".knot")];
  const stops = [...document.querySelectorAll(".stop")];
  const quote = $("#quote"), how = $("#how"), questions = $("#questions");
  const spyLinks = [...document.querySelectorAll("[data-spy]")];
  const mbar = $("#mbar");
  const narrow = window.matchMedia("(max-width: 900px)");

  // ScrollTriggers can fire while they are being created (a reload part-way
  // down the page), so all shared state exists before any of them
  let filmProgress = 0;
  let wakeLen = 0;
  let threadH = 0;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);
  document.getElementById("year").textContent = new Date().getFullYear();

  /* ------------------------------------------------------------------
   * Smooth scroll (Lenis) wired into GSAP's ticker. The page scrolls from
   * the first moment; nothing waits for the film.
   * ---------------------------------------------------------------- */
  let lenis = null;
  if (!reduceMotion && window.Lenis) {
    lenis = new Lenis({ duration: 1.25, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  const scrollTo = (target, opts = {}) => {
    if (lenis) lenis.scrollTo(target, { duration: 1.6, ...opts });
    else window.scrollTo({ top: typeof target === "number" ? target : target.getBoundingClientRect().top + window.scrollY, behavior: reduceMotion ? "auto" : "smooth" });
  };

  /* ------------------------------------------------------------------
   * Frame loading: the first frame first (it is preloaded), then coarse
   * to fine so scrubbing works long before everything is in. The amber
   * line along the top shows the progress and then fades away.
   * ---------------------------------------------------------------- */
  const images = new Array(FRAME_COUNT);
  const loaded = new Uint8Array(FRAME_COUNT);
  let loadedCount = 0;

  const order = [];
  const seen = new Set();
  [16, 8, 4, 2, 1].forEach((step) => {
    for (let i = 0; i < FRAME_COUNT; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
  });

  const loadFrame = (i) =>
    new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        images[i] = img;
        loaded[i] = 1;
        loadedCount++;
        onProgress();
        if (i === 0) showSite();
        if (i === currentFrame || nearestLoaded(currentFrame) === i) render(true);
        resolve();
      };
      img.onerror = () => { loadedCount++; onProgress(); resolve(); };
      img.src = frameSrc(i);
    });

  const runQueue = async (concurrency = 6) => {
    await loadFrame(order[0]);
    let next = 1;
    const worker = async () => {
      while (next < order.length) await loadFrame(order[next++]);
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  };

  function onProgress() {
    const p = loadedCount / FRAME_COUNT;
    loadFill.style.transform = `scaleX(${p})`;
    if (p >= 1) loadline.classList.add("is-done");
  }

  /* ------------------------------------------------------------------
   * Canvas rendering (cover-fit, DPR aware, focal point per frame)
   * ---------------------------------------------------------------- */
  let currentFrame = 0;
  let drawnFrame = -1;
  let cw = 0, ch = 0;

  function nearestLoaded(i) {
    if (loaded[i]) return i;
    for (let d = 1; d < FRAME_COUNT; d++) {
      if (i - d >= 0 && loaded[i - d]) return i - d;
      if (i + d < FRAME_COUNT && loaded[i + d]) return i + d;
    }
    return -1;
  }

  // On tall/narrow screens the 16:9 film is cropped; steer the crop toward
  // the subject: the port stays centred, the ship sits left of centre.
  function focusX(i) {
    if (i < 90) return 0.5;
    if (i < 120) return gsap.utils.mapRange(90, 120, 0.5, 0.3, i);
    return 0.3;
  }

  // where a frame lands on a w x h screen (cover-fit with the focal point)
  function coverRect(w, h, i) {
    const s = Math.max(w / FRAME_W, h / FRAME_H);
    const dw = FRAME_W * s, dh = FRAME_H * s;
    const dx = Math.min(0, Math.max(w - dw, w / 2 - dw * focusX(i)));
    return { x: dx, y: (h - dh) / 2, w: dw, h: dh };
  }

  function render(force) {
    const idx = nearestLoaded(currentFrame);
    if (idx < 0 || (!force && idx === drawnFrame)) return;
    const r = coverRect(cw, ch, idx);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(images[idx], r.x, r.y, r.w, r.h);
    drawnFrame = idx;
  }

  /* The wake: traced on the final ocean frame from the stern back to the
   * point where it crosses the thread's line, then turned down and out of
   * the bottom of the screen. Rebuilt whenever the screen size changes. */
  function buildWake() {
    const w = sticky.clientWidth, h = sticky.clientHeight;
    const r = coverRect(w, h, OCEAN_LAST);
    const railX = thread.offsetLeft + 1;
    const pts = WAKE.map(([fx, fy]) => [r.x + fx * r.w, r.y + fy * r.h]);
    const path = [pts[0]];
    let cross = null;
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
      if (x1 <= railX) {
        const t = (x0 - railX) / (x0 - x1);
        cross = [railX, y0 + (y1 - y0) * t];
        break;
      }
      path.push(pts[k]);
    }
    if (!cross) cross = [railX, path[path.length - 1][1]];
    // round the turn: arrive along the wake, leave straight down
    const [px, py] = path[path.length - 1];
    const back = Math.min(36, Math.hypot(px - cross[0], py - cross[1]));
    const ang = Math.atan2(py - cross[1], px - cross[0]);
    const a = [cross[0] + Math.cos(ang) * back, cross[1] + Math.sin(ang) * back];
    let d = `M${path.map((p) => p.map((n) => n.toFixed(1)).join(" ")).join(" L")}`;
    d += ` L${a[0].toFixed(1)} ${a[1].toFixed(1)} Q${cross[0].toFixed(1)} ${cross[1].toFixed(1)} ${cross[0].toFixed(1)} ${(cross[1] + back).toFixed(1)} L${cross[0].toFixed(1)} ${h + 2}`;
    wakePath.setAttribute("d", d);
    wakeLen = wakePath.getTotalLength();
    wakePath.style.strokeDasharray = wakeLen;
    drawWake();
  }
  const wakeState = { p: 0 };
  function drawWake() {
    wakePath.style.strokeDashoffset = wakeLen * (1 - wakeState.p);
    wakePath.style.opacity = wakeState.p > 0 ? 1 : 0;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = Math.round(sticky.clientWidth * dpr);
    ch = Math.round(sticky.clientHeight * dpr);
    canvas.width = cw;
    canvas.height = ch;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    render(true);
    buildWake();
  }

  /* ------------------------------------------------------------------
   * Film timeline
   * ---------------------------------------------------------------- */
  const statement = $("#statement");
  statement.innerHTML = statement.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(" ");
  const words = statement.querySelectorAll(".w");

  const playhead = { frame: 0 };
  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: film, start: "top top", end: "bottom bottom", scrub: 0.6, onUpdate: (self) => onFilmUpdate(self.progress) },
  });
  const renderPlayhead = () => {
    currentFrame = Math.round(playhead.frame);
    render(false);
  };
  for (let k = 1; k < FILM_KEYS.length; k++) {
    const [u0] = FILM_KEYS[k - 1];
    const [u1, f1] = FILM_KEYS[k];
    tl.to(playhead, { frame: f1, duration: u1 - u0, onUpdate: renderPlayhead }, u0);
  }
  tl.to(playhead, { frame: OCEAN_LAST, duration: 12.6, ease: "power2.out", onUpdate: renderPlayhead }, FILM_KEYS[FILM_KEYS.length - 1][0]);
  tl.set({}, {}, TOTAL);

  tl.to("#topShade", { opacity: 0, duration: 4 }, 16)
    .to("#topShade", { opacity: 1, duration: 4 }, 45);
  tl.to("#ch1", { opacity: 0, y: -60, filter: "blur(6px)", duration: 8, ease: "power1.in" }, 7)
    .to("#filmShade", { opacity: 0, duration: 14 }, 6);
  tl.fromTo("#ch2", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 5, ease: "power2.out" }, 23)
    .to(words, { opacity: 1, duration: 1.2, stagger: 10 / words.length }, 26)
    .to("#ch2", { opacity: 0, y: -40, filter: "blur(6px)", duration: 5, ease: "power1.in" }, 41);
  tl.to("#shipShade", { opacity: 1, duration: 8 }, 58)
    .fromTo("#ch3", { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 6, ease: "power2.out" }, 62)
    .to("#ch3 .ship__meta", { opacity: 0, y: -24, duration: 4, ease: "power1.in" }, 82)
    .to("#ch3 .ship__title .line > span", { yPercent: -110, duration: 4, stagger: 0.8, ease: "power2.in" }, 83)
    .to("#shipShade", { opacity: 0, duration: 6 }, 86);
  if (!reduceMotion) tl.to(wakeState, { p: 1, duration: WAKE_LEN, ease: "power1.inOut", onUpdate: drawWake }, WAKE_AT);

  const unitToScroll = (u) => {
    const st = tl.scrollTrigger;
    return st.start + (u / TOTAL) * (st.end - st.start);
  };
  // light film behind = dark ink, dark film behind = white ink
  const themeForUnit = (u) => (u > 19 && u < 46 ? "dark" : "light");

  function onFilmUpdate(p) {
    filmProgress = p;
    railFill.style.transform = `scaleY(${p})`;
    sticky.dataset.theme = themeForUnit(p * TOTAL);
    // reduced motion: the wake is simply there once the film reaches it
    if (reduceMotion) { wakeState.p = p * TOTAL >= WAKE_AT ? 1 : 0; drawWake(); }
    onScroll();
  }

  $("#nextBtn").addEventListener("click", () => {
    const u = filmProgress * TOTAL;
    const nextChapter = CHAPTERS.find((c) => c > u + 2);
    scrollTo(nextChapter !== undefined ? unitToScroll(nextChapter + 4) : voyage);
  });

  /* ------------------------------------------------------------------
   * The thread: fills to the reading line as you scroll; each knot (and on
   * narrow screens each route stop, which sits on the thread) lights as
   * the fill reaches it. Ends at the footer's knot.
   * ---------------------------------------------------------------- */
  const endKnot = $(".knot--end");
  function measureThread() {
    const v = voyage.getBoundingClientRect();
    const e = endKnot.getBoundingClientRect();
    threadH = e.top + e.height / 2 - v.top;
    thread.style.setProperty("--thread-h", `${threadH}px`);
  }

  function onScroll() {
    const vh = window.innerHeight;
    const line = vh * READ_LINE;
    const vTop = voyage.getBoundingClientRect().top;
    if (!reduceMotion) {
      const t = threadH ? gsap.utils.clamp(0, 1, (line - vTop) / threadH) : 0;
      thread.style.setProperty("--t", t.toFixed(4));
      knots.forEach((k) => k.classList.toggle("is-on", k.getBoundingClientRect().top < line));
      if (narrow.matches) stops.forEach((s) => s.classList.toggle("is-on", s.getBoundingClientRect().top < line));
    }

    // nav: film colours over the film, a solid dark bar after it
    const pastFilm = vTop < vh * 0.5;
    nav.dataset.theme = pastFilm ? "light" : themeForUnit(filmProgress * TOTAL);
    nav.classList.toggle("is-solid", pastFilm);

    // the section in view
    const spy = vh * 0.4;
    let current = "";
    if (quote.getBoundingClientRect().top < spy) current = "quote";
    else if (questions.getBoundingClientRect().top < spy) current = "questions";
    else if (how.getBoundingClientRect().top < spy) current = "how";
    else if (vTop < spy) current = "services";
    spyLinks.forEach((l) => l.classList.toggle("is-active", l.dataset.spy === current));

    // phones: the action bar once the hero's own buttons have gone, but not
    // over the form itself
    const q = quote.getBoundingClientRect();
    const onForm = q.top < vh * 0.6 && q.bottom > vh * 0.4;
    mbar.classList.toggle("is-on", filmProgress * TOTAL > 12 && !onForm);
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ------------------------------------------------------------------
   * Services: all six names at once. Pointing at one (hover, tap or
   * keyboard focus) fills the screen with its photo and shows its line.
   * ---------------------------------------------------------------- */
  const svcNames = [...document.querySelectorAll(".svc__name")];
  const svcImgs = [...document.querySelectorAll(".svc__bg img")];
  const svcDesc = $("#svcDesc");
  let svcOn = 0;
  function setService(i) {
    if (i === svcOn) return;
    svcOn = i;
    svcNames.forEach((b, n) => {
      b.classList.toggle("is-on", n === i);
      b.setAttribute("aria-pressed", String(n === i));
    });
    svcImgs.forEach((img, n) => img.classList.toggle("is-on", n === i));
    gsap.killTweensOf(svcDesc);
    if (reduceMotion) { svcDesc.textContent = svcNames[i].dataset.desc; return; }
    gsap.timeline()
      .to(svcDesc, { opacity: 0, y: -6, duration: 0.15, ease: "power1.in", onComplete: () => { svcDesc.textContent = svcNames[svcOn].dataset.desc; } })
      .to(svcDesc, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" });
  }
  svcNames.forEach((b, i) => {
    b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") setService(i); });
    b.addEventListener("click", () => setService(i));
    b.addEventListener("focus", () => setService(i));
  });

  /* ------------------------------------------------------------------
   * How it works (wide screens): the section holds while the container
   * rides the route; each stop lights as it arrives (dots at 0, 1/3, 2/3,
   * end). On narrow screens the stops sit on the thread instead.
   * ---------------------------------------------------------------- */
  const route = $("#route");
  const setRoute = (p) => {
    route.style.setProperty("--p", p.toFixed(4));
    stops.forEach((s, k) => s.classList.toggle("is-on", p >= Math.max(0.02, k / (stops.length - 1) - 0.02)));
  };
  const mm = gsap.matchMedia();
  mm.add("(min-width: 901px) and (prefers-reduced-motion: no-preference)", () => {
    const proxy = { p: 0 };
    gsap.to(proxy, {
      p: 1, ease: "none",
      onUpdate: () => setRoute(proxy.p),
      scrollTrigger: { trigger: how, start: "top top", end: () => "+=" + (how.offsetHeight - window.innerHeight) * 0.85, scrub: 0.6 },
    });
    return () => setRoute(0);
  });
  if (reduceMotion) setRoute(1);

  /* ------------------------------------------------------------------
   * Section titles rise through their line masks once, in the hero's
   * vocabulary. The quote's ocean drifts with the scroll.
   * ---------------------------------------------------------------- */
  if (!reduceMotion) {
    ["#svcTitle", "#howTitle", "#qaTitle", "#quoteTitle"].forEach((sel) => {
      gsap.fromTo(`${sel} .line > span`, { yPercent: 110 }, {
        yPercent: 0, duration: 1.1, stagger: 0.1, ease: "expo.out",
        scrollTrigger: { trigger: sel, start: "top 85%", once: true },
      });
    });
    gsap.fromTo(".quote__bg img", { yPercent: -10 }, {
      yPercent: 0, ease: "none",
      scrollTrigger: { trigger: quote, start: "top bottom", end: "bottom bottom", scrub: true },
    });
  }

  /* ------------------------------------------------------------------
   * Anchor links through the smooth scroller
   * ---------------------------------------------------------------- */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      const target = id === "#top" ? 0 : document.querySelector(id);
      if (target === null) return;
      e.preventDefault();
      scrollTo(target);
    });
  });

  /* ------------------------------------------------------------------
   * Intro: the page's one orchestrated moment. Runs as soon as the first
   * frame is on screen (or after a short wait if the network is slow).
   * ---------------------------------------------------------------- */
  let siteShown = false;
  if (!reduceMotion) {
    gsap.set(".hero__title .line > span", { yPercent: 110 });
    gsap.set(".hero__rule", { scaleX: 0 });
    gsap.set([".hero__sub", ".hero__actions"], { opacity: 0, y: 16 });
    gsap.set([nav, ".film__sticky .next", ".rail", ".wa-fab"], { opacity: 0 });
  } else {
    gsap.set(".wa-fab", { opacity: 1 });
  }
  function showSite() {
    if (siteShown) return;
    siteShown = true;
    ScrollTrigger.refresh();
    if (reduceMotion) return;
    gsap.timeline({ delay: 0.1, defaults: { ease: "expo.out" } })
      .to(".hero__title .line > span", { yPercent: 0, duration: 1.4, stagger: 0.1 })
      .to(".hero__rule", { scaleX: 1, duration: 1 }, "-=1")
      .to([".hero__sub", ".hero__actions"], { opacity: 1, y: 0, duration: 1, stagger: 0.08 }, "-=0.9")
      .to(nav, { opacity: 1, duration: 1 }, "-=1.1")
      .to([".film__sticky .next", ".rail", ".wa-fab"], { opacity: 1, duration: 0.8 }, "-=0.8");
  }
  setTimeout(showSite, 1500);

  /* ------------------------------------------------------------------
   * Questions: one answer open at a time
   * ---------------------------------------------------------------- */
  const accItems = [...document.querySelectorAll(".acc__item")];
  const setAcc = (item, open) => {
    item.classList.toggle("is-open", open);
    item.querySelector(".acc__q button").setAttribute("aria-expanded", String(open));
  };
  accItems.forEach((item) => {
    item.querySelector(".acc__q button").addEventListener("click", () => {
      const open = !item.classList.contains("is-open");
      accItems.forEach((other) => other !== item && other.classList.contains("is-open") && setAcc(other, false));
      setAcc(item, open);
      setTimeout(() => ScrollTrigger.refresh(), 400);
    });
  });

  /* ------------------------------------------------------------------
   * Enquiry form: delivered to the inbox through a form service when
   * data-endpoint is set; otherwise written out in the visitor's email
   * app. WhatsApp opens a chat with the same enquiry.
   * ---------------------------------------------------------------- */
  const form = $("#enquiry");
  const formBody = $("#formBody");
  const formDone = $("#formDone");
  const statusEl = $("#enquiryStatus");

  const readForm = () => Object.fromEntries(new FormData(form).entries());
  const enquiryText = (d) => [
    "New shipment enquiry",
    `Service: ${d.service}`,
    `Name: ${d.name}`,
    d.company && `Company: ${d.company}`,
    `Phone: ${d.phone}`,
    d.email && `Email: ${d.email}`,
    (d.origin || d.destination) && `Route: ${d.origin || "?"} to ${d.destination || "?"}`,
    `Cargo: ${d.cargo}`,
  ].filter(Boolean).join("\n");

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "form__status" + (kind ? ` is-${kind}` : "");
  }

  function validate() {
    let firstBad = null;
    form.querySelectorAll("[required]").forEach((el) => {
      const bad = !el.value.trim();
      el.closest(".field").classList.toggle("is-invalid", bad);
      if (bad && !firstBad) firstBad = el;
    });
    const email = form.elements.email;
    if (email.value && !email.checkValidity()) {
      email.closest(".field").classList.add("is-invalid");
      firstBad = firstBad || email;
    }
    if (firstBad) {
      firstBad.focus({ preventScroll: true });
      setStatus("Fill in the highlighted fields: service, name, phone and cargo.", "error");
      return false;
    }
    return true;
  }

  form.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field && e.target.value.trim()) field.classList.remove("is-invalid");
  });

  function showDone() {
    formBody.hidden = true;
    formDone.hidden = false;
    formDone.focus();
    measureThread();
  }
  $("#formAgain").addEventListener("click", () => {
    form.reset();
    setStatus("");
    formDone.hidden = true;
    formBody.hidden = false;
    form.elements.service.focus();
    measureThread();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const data = readForm();
    if (data.website) return; // honeypot filled: drop spam
    delete data.website;

    const endpoint = form.dataset.endpoint;
    const submit = form.querySelector('[type="submit"]');
    if (endpoint) {
      submit.disabled = true;
      setStatus("Sending…");
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ...data, subject: `Shipment enquiry: ${data.service}` }),
        });
        if (!res.ok) throw new Error(res.status);
        setStatus("");
        showDone();
      } catch {
        setStatus("The enquiry was not sent. Try again, or send it on WhatsApp.", "error");
      } finally {
        submit.disabled = false;
      }
    } else {
      const subject = `Shipment enquiry: ${data.service}`;
      window.location.href = `mailto:${form.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(enquiryText(data))}`;
      setStatus("Your email app opened with the enquiry written out. Press send there to reach us.", "ok");
    }
  });

  $("#enquiryWa").addEventListener("click", () => {
    if (!validate()) return;
    window.open(`https://wa.me/${form.dataset.whatsapp}?text=${encodeURIComponent(enquiryText(readForm()))}`, "_blank", "noopener");
    setStatus("WhatsApp opened with your enquiry. Press send there to reach us.", "ok");
  });

  /* ------------------------------------------------------------------
   * Boot
   * ---------------------------------------------------------------- */
  resize();
  measureThread();
  onScroll();
  window.addEventListener("resize", () => { resize(); measureThread(); ScrollTrigger.refresh(); onScroll(); });
  ScrollTrigger.addEventListener("refresh", () => { measureThread(); buildWake(); onScroll(); });
  window.addEventListener("load", () => ScrollTrigger.refresh());
  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());
  runQueue();
})();
