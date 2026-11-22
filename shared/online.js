try{history.scrollRestoration="manual"}catch(e){}
scrollTo(0,0);addEventListener("load",()=>scrollTo(0,0));addEventListener("pageshow",()=>scrollTo(0,0));
/* Online functies voor de gedeelde app:
   - sterren (1–5) per oefening met toelichting, opgeslagen in Supabase
     (of, als testversie binnen Claude, in de gedeelde opslag van het artifact)
   - tellen hoe vaak een oefening in een training wordt gekozen
   - link terug naar het startscherm en de offline-app (service worker) */
(function () {
  const PROGRAM = window.FB_PROGRAM;
  /* Uit welke app: de gymles-app (repository floorball-gymles, loader.js) zet FB_APP.id = "gymzaal"; anders de trainersapp. */
  const APP = (window.FB_APP && window.FB_APP.id) || "training";
  const withApp = b => (APP === "training" ? b : Object.assign(b, { p_app: APP }));
  const CFG = window.FB_CONFIG || {};
  const SUPA = !!(CFG.supabaseUrl && CFG.supabaseKey);
  const HOSTED = !!window.FB_HOSTED;
  let api = null, isOwner = false;
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  let DEVICE = ls.get("fb-device", null);
  if (!DEVICE) { DEVICE = uuid(); ls.set("fb-device", DEVICE); }

  const MINE_KEY = "fb-rate-" + PROGRAM, QUEUE_KEY = "fb-queue";
  const FB_KEY = "fb-note-" + PROGRAM;
  let mine = ls.get(MINE_KEY, {}), notes = ls.get(FB_KEY, {});
  let stats = {};
  const openFb = new Set(), sentFb = new Set(), drafts = {};
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /* ---------- Supabase ---------- */
  async function rpc(fn, body) {
    const r = await fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.supabaseKey, Authorization: "Bearer " + CFG.supabaseKey },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error("rpc " + fn + " " + r.status);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  const supaApi = {
    call: (fn, body) => rpc(fn, body),
    stats: () => rpc("stats", { p_program: PROGRAM }),
    feedback: () => rpc("feedback", { p_program: PROGRAM })
  };

  /* ---------- testversie binnen Claude: gedeelde opslag van het artifact ---------- */
  async function claudeApi() {
    if (HOSTED || !window.claude || typeof claude.use !== "function") return null;
    const [db, user] = await Promise.all([claude.use("db").catch(() => null), claude.use("user").catch(() => null)]);
    if (!db || !user) return null;
    const uid = await user.id(); if (!uid) return null;
    try { isOwner = !!(await user.isOwner()); } catch (e) {}
    const col = db.collection("scores"), ref = col.doc(uid);
    const snap = await Promise.race([ref.get(), new Promise((_, j) => setTimeout(() => j(new Error("timeout")), 10000))]);
    const doc = snap.exists ? snap.data() : {}; doc.r = doc.r || {}; doc.p = doc.p || {};
    Object.entries(doc.r).forEach(([k, v]) => { const [pr, ex] = k.split("|"); if (pr === PROGRAM && v && v.s) { mine[ex] = v.s; if (v.f) notes[ex] = v.f; } });
    ls.set(MINE_KEY, mine); ls.set(FB_KEY, notes);
    let chain = Promise.resolve();
    const save = () => (chain = chain.then(() => ref.set(JSON.parse(JSON.stringify(doc)))));
    const all = async () => (await col.get()).docs.map(d => d.data() || {});
    return {
      async call(fn, b) {
        const k = b.p_program + "|" + b.p_exercise;
        if (fn === "rate") { const prev = doc.r[k] || {}; doc.r[k] = { s: b.p_score, f: b.p_feedback == null ? prev.f || "" : String(b.p_feedback).trim().slice(0, 500), at: new Date().toISOString() }; }
        if (fn === "pick") { const d = new Date().toISOString().slice(0, 10), arr = doc.p[k] || []; if (arr.includes(d)) return; arr.push(d); doc.p[k] = arr.slice(-366); }
        await save();
      },
      async stats() {
        const agg = {};
        const row = ex => agg[ex] = agg[ex] || { exercise_id: ex, sum: 0, votes: 0, picks: 0, pickers: 0, comments: 0 };
        (await all()).forEach(d => {
          Object.entries(d.r || {}).forEach(([k, v]) => { const [pr, ex] = k.split("|"); if (pr !== PROGRAM || !v || !v.s) return; const a = row(ex); a.sum += v.s; a.votes++; if (v.f) a.comments++; });
          Object.entries(d.p || {}).forEach(([k, v]) => { const [pr, ex] = k.split("|"); if (pr !== PROGRAM || !v || !v.length) return; const a = row(ex); a.picks += v.length; a.pickers++; });
        });
        return Object.values(agg).map(a => ({ ...a, avg_score: a.votes ? a.sum / a.votes : null }));
      },
      async feedback() {
        const out = [];
        (await all()).forEach(d => Object.entries(d.r || {}).forEach(([k, v]) => { const [pr, ex] = k.split("|"); if (pr === PROGRAM && v && v.f) out.push({ exercise_id: ex, score: v.s, feedback: v.f, updated_at: v.at }); }));
        return out.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      }
    };
  }

  function enqueue(job) { const q = ls.get(QUEUE_KEY, []); q.push(job); ls.set(QUEUE_KEY, q.slice(-200)); flush(); }
  let flushing = false;
  async function flush() {
    if (!api || flushing) return; flushing = true;
    try {
      let q = ls.get(QUEUE_KEY, []);
      while (q.length) {
        const job = q[0];
        try { await api.call(job.fn, job.body); }
        catch (e) { break; }
        q = ls.get(QUEUE_KEY, []); q.shift(); ls.set(QUEUE_KEY, q);
      }
    } finally { flushing = false; }
  }
  async function loadStats() {
    if (!api) return;
    try {
      const rows = await api.stats();
      stats = {}; (rows || []).forEach(r => { stats[r.exercise_id] = r; });
      refreshAll();
    } catch (e) {}
  }

  /* ---------- sterren ---------- */
  const fmt = v => (Math.round(v * 10) / 10).toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function label(id) {
    const s = stats[id], m = mine[id];
    const avg = s && s.votes ? `gemiddeld ${fmt(+s.avg_score)} (${s.votes})` : "";
    if (m) return `Jouw score ${m}${avg ? " · " + avg : ""}`;
    return avg || "Nog geen scores · geef de eerste";
  }
  function widget(id) {
    const m = mine[id] || 0, s = stats[id], show = m || (s && s.votes ? Math.round(+s.avg_score) : 0);
    const cls = m ? "mine" : "avg";
    return `<div class="fb-rate" data-ex="${id}"><span class="fb-stars" role="group" aria-label="Geef een score van 1 tot 5">` +
      [1, 2, 3, 4, 5].map(n => `<button type="button" class="fb-star ${n <= show ? "on " + cls : ""}" data-rate="${n}" data-ex="${id}" aria-label="${n} ${n === 1 ? "ster" : "sterren"}" aria-pressed="${m === n}">★</button>`).join("") +
      `</span><span class="fb-lbl">${label(id)}</span>` + feedbackHtml(id) + `</div>`;
  }
  function feedbackHtml(id) {
    if (!mine[id]) return "";
    const note = drafts[id] != null ? drafts[id] : notes[id] || "";
    if (openFb.has(id)) return `<form class="fb-form" data-fbform="${id}"><label>${mine[id] <= 2 ? "Wat kan er beter aan deze oefening?" : "Wat werkte goed, of wat kan beter?"}</label>` +
      `<textarea aria-label="Toelichting" maxlength="500" rows="3" placeholder="Bijvoorbeeld: te ingewikkeld voor groep 4, of: werkt goed als warming-up">${esc(note)}</textarea>` +
      `<div class="fb-fact"><button type="submit" class="fb-send">Versturen</button><button type="button" class="fb-cancel" data-fbtoggle="${id}">Annuleren</button></div></form>`;
    return `<button type="button" class="fb-fbtn" data-fbtoggle="${id}">${sentFb.has(id) ? "Bedankt! Toelichting aanpassen" : note ? "Toelichting aanpassen" : "Toelichting geven"}</button>`;
  }
  function refresh(el) {
    const id = el.dataset.ex, ta = el.querySelector("textarea"), focus = ta && document.activeElement === ta;
    if (ta) drafts[id] = ta.value;
    el.insertAdjacentHTML("afterend", widget(id)); const nw = el.nextElementSibling; el.remove();
    if (focus) { const n = nw.querySelector("textarea"); if (n) { n.focus({ preventScroll: true }); n.setSelectionRange(n.value.length, n.value.length); } }
  }
  function refreshAll() { document.querySelectorAll(".fb-rate").forEach(refresh); applyStarFilter(); }

  /* ---------- filter op aantal sterren ---------- */
  let starMin = ls.get("fb-starfilter-" + PROGRAM, "all");
  const scoreOf = id => { const s = stats[id]; return s && s.votes ? +s.avg_score : mine[id] || null; };
  function starFilterHtml() {
    const opts = [["all", "Alle sterren"], ["5", "★★★★★"], ["4", "★★★★ en meer"], ["3", "★★★ en meer"], ["2", "★★ en meer"], ["low", "Onder ★★★"], ["none", "Nog geen score"]];
    return `<label class="fb-sf"><select id="fb-starfilter" aria-label="Filter op aantal sterren">${opts.map(([v, l]) => `<option value="${v}"${v === starMin ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
  }
  /* zoeken: titel, doel, uitleg, variaties … alles wat bij de oefening staat */
  let query = "";
  const norm = t => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const strip = t => String(t).replace(/<[^>]*>/g, " ");
  const textIdx = {};
  function textOf(id) {
    if (textIdx[id] != null) return textIdx[id];
    let t = "";
    const ex = typeof EX !== "undefined" && EX.find(e => e.id === id);
    const walk = v => { if (v == null) return; if (typeof v === "string") t += " " + strip(v); else if (Array.isArray(v)) v.forEach(walk); else if (typeof v === "object") Object.entries(v).forEach(([k, x]) => { if (k !== "fig" && k !== "anim") walk(x); }); };
    if (ex) walk(ex);
    return (textIdx[id] = norm(t));
  }
  function searchHtml() {
    return `<label class="fb-search"><span class="fb-search-i" aria-hidden="true">⌕</span><input id="fb-search" type="search" placeholder="Zoek oefening" aria-label="Zoek oefening" autocomplete="off" value="${esc(query)}"></label>`;
  }
  function ensureStarFilter() {
    const f = document.getElementById("filters");
    if (!f || f.querySelector(".fb-tools")) return;
    const had = document.activeElement && document.activeElement.id === "fb-search";
    f.insertAdjacentHTML("beforeend", `<div class="fb-tools">${searchHtml()}${starFilterHtml()}</div>`);
    if (had) { const i = f.querySelector("#fb-search"); i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length); }
  }
  function matches(card, id) {
    if (!query.trim()) return true;
    const h = card.querySelector("h3"), ex = typeof EX !== "undefined" && EX.find(e => e.id === id);
    const hay = norm((ex && ex.title) || (h && h.textContent) || "");
    return norm(query).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
  }
  function passes(id) {
    if (starMin === "all") return true;
    const v = scoreOf(id);
    if (starMin === "none") return v == null;
    if (v == null) return false;
    if (starMin === "low") return v < 3;
    return Math.round(v * 10) / 10 >= +starMin - 0.25;
  }
  function applyStarFilter() {
    const grid = document.getElementById("grid"); if (!grid) return;
    let shown = 0;
    grid.querySelectorAll("article.card").forEach(card => {
      const b = card.querySelector("[data-open]"); const ok = !b || (passes(b.dataset.open) && matches(card, b.dataset.open));
      card.style.display = ok ? "" : "none"; if (ok) shown++;
    });
    grid.querySelectorAll(".grid-h").forEach(h => {
      let n = h.nextElementSibling, any = false;
      while (n && !n.classList.contains("grid-h")) { if (n.matches("article.card") && n.style.display !== "none") any = true; n = n.nextElementSibling; }
      h.style.display = any ? "" : "none";
    });
    let msg = document.getElementById("fb-sf-empty");
    if (!shown) { if (!msg) grid.insertAdjacentHTML("beforebegin", `<p class="note" id="fb-sf-empty"></p>`); }
    else if (msg) msg.remove();
    msg = document.getElementById("fb-sf-empty");
    if (msg) msg.textContent = query.trim() ? `Niets gevonden voor “${query.trim()}”. Probeer een andere naam, of kies Alles bij de onderdelen.` : "Geen oefeningen met dit aantal sterren. Kies een ander filter.";
  }
  document.addEventListener("input", ev => { if (ev.target.id !== "fb-search") return; query = ev.target.value; applyStarFilter(); });
  document.addEventListener("change", ev => {
    if (ev.target.id !== "fb-starfilter") return;
    starMin = ev.target.value; ls.set("fb-starfilter-" + PROGRAM, starMin); applyStarFilter();
  });
  /* chips op de telefoon: vervaging rechts zolang er nog meer chips zijn om naartoe te schuiven */
  function chipFade(fc) {
    if (!fc) return;
    if (!fc.querySelector(".fb-fade")) fc.insertAdjacentHTML("beforeend", `<span class="fb-fade" aria-hidden="true"></span>`);
    fc.classList.toggle("fb-end", fc.scrollLeft + fc.clientWidth >= fc.scrollWidth - 4);
  }
  /* lege balk onderin: op de telefoon alleen de knoppen, zonder "0 oefeningen · 0 min" */
  function barState() {
    const sum = document.getElementById("les-sum"), bar = sum && sum.closest(".lesbar");
    if (bar) bar.classList.toggle("fb-empty", /^0\s/.test(sum.textContent.trim()));
  }
  /* legenda (kleuren en pijlen) onder de tekening in het Uitleg-venster */
  function decorateDlgLegend() {
    const body = document.getElementById("dlg-body"), leg = document.getElementById("legend");
    if (!body || !leg || body.querySelector(".fb-dlg-leg")) return;
    const fig = body.querySelector(":scope > .field"); if (!fig) return;
    fig.insertAdjacentHTML("afterend", `<details class="legwrap fb-dlg-leg"><summary>Legenda</summary><div class="legend">${leg.innerHTML}</div></details>`);
  }
  /* onderbalk: lange tekst op breed scherm, korte op de telefoon */
  function barLabels() {
    const u = (window.FB_APP && FB_APP.words && FB_APP.words.unit) || "training";
    [["open-mat", "Maak een " + u, "Mijn " + u], ["open-gen", "Suggestie voor een " + u, "Suggestie"]].forEach(([id, l, k]) => {
      const b = document.getElementById(id); if (!b || b.querySelector(".fb-l-lbl")) return;
      b.innerHTML = `<span class="fb-l-lbl">${l}</span><span class="fb-s-lbl">${k}</span>`;
    });
  }
  function decorate() {
    decorateDlgLegend(); barLabels();
    ensureStarFilter(); decorateShare(); decorateTrainingShare(); chipFade(document.querySelector(".fchips")); barState();
    document.querySelectorAll("#grid article.card").forEach(card => {
      if (card.querySelector(".fb-rate")) return;
      const b = card.querySelector("[data-open]"); if (!b) return;
      const act = card.querySelector(".actions");
      act.insertAdjacentHTML("beforebegin", widget(b.dataset.open));
    });
    applyStarFilter();
  }

  /* ---------- oefening delen via een link (#oefening=<id>) ---------- */
  const SHARE_KEY = "oefening";
  const exById = id => typeof EX !== "undefined" ? EX.find(e => e.id === id) : null;
  const shareUrl = id => location.href.split("#")[0] + "#" + SHARE_KEY + "=" + encodeURIComponent(id);
  function decorateShare() {
    const d = document.getElementById("dlg"), body = document.getElementById("dlg-body");
    if (!d || !body || !d.dataset.id) return;
    /* knop Delen bovenin naast de sluitknop, zodat de onderste balk op de telefoon op één regel past */
    const close = d.querySelector(".dlg-head .close"); let btn = d.querySelector(".dlg-head .fb-share");
    if (close && !btn) { close.insertAdjacentHTML("beforebegin", `<button type="button" class="btn fb-share" aria-label="Deel deze oefening via een link">Delen</button>`); btn = d.querySelector(".dlg-head .fb-share"); }
    if (btn) btn.dataset.share = d.dataset.id;
    const act = body.querySelector(":scope > .actions:last-child");
    if (act && !act.querySelector(".fb-share-msg")) act.insertAdjacentHTML("beforeend", `<span class="msg fb-share-msg" role="status" aria-live="polite"></span>`);
  }
  async function share(id, btn) {
    const ex = exById(id), url = shareUrl(id), title = ex ? ex.title : "Floorball-oefening";
    const msg = (btn.closest("dialog") || btn.parentElement).querySelector(".fb-share-msg"), say = t => { if (msg) msg.textContent = t; };
    if (navigator.share) {
      try { await navigator.share({ title, text: "Floorball-oefening: " + title, url }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); say("Link gekopieerd. Plak hem in een bericht of mail."); return; } catch (e) {}
    if (msg) { msg.innerHTML = `Kopieer deze link: <input class="fb-share-url" readonly value="${esc(url)}">`; const i = msg.querySelector("input"); i.focus(); i.select(); }
  }
  /* hele training delen: #training=<id>.<min>[+|-],…&w=<wissel>&n=<aantal>&z=<b>x<l>&t=<naam>
     (+ = moeilijker, - = makkelijker, niets = basis) */
  const LVL_CODE = { moeilijker: "+", makkelijker: "-", basis: "" };
  const unitWord = () => (window.FB_APP && FB_APP.words && FB_APP.words.unit) || "training";
  const has = n => { try { return typeof eval(n) !== "undefined"; } catch (e) { return false; } };
  function trainingUrl() {
    const q = new URLSearchParams();
    q.set("training", sel.map(x => x.id + "." + x.min + (LVL_CODE[x.lvl] || "")).join(","));
    if (has("WISSEL")) q.set("w", WISSEL);
    if (has("N")) q.set("n", N);
    if (has("ZW") && has("ZH")) q.set("z", ZW + "x" + ZH);
    const name = has("sheetTitle") ? sheetTitle() : "";
    if (name && !(has("C") && name === C.title)) q.set("t", name);
    return location.href.split("#")[0] + "#" + q.toString().replace(/%2C/g, ",");
  }
  function decorateTrainingShare() {
    const save = document.getElementById("do-save");
    if (!save || document.getElementById("fb-share-les")) return;
    save.insertAdjacentHTML("afterend", `<button type="button" class="btn" id="fb-share-les" aria-label="Deel deze ${unitWord()} via een link">Delen</button>`);
  }
  async function shareTraining() {
    const say = t => { if (typeof setMsg === "function") setMsg(t); };
    if (!has("sel") || !sel.length) { say(`Kies eerst oefeningen, dan kun je de ${unitWord()} delen.`); return; }
    const url = trainingUrl(), name = (has("sheetTitle") && sheetTitle()) || "Floorball-" + unitWord();
    const min = sel.reduce((t, x) => t + x.min, 0);
    if (navigator.share) {
      try { await navigator.share({ title: name, text: `${name}: ${sel.length} oefeningen, ${min} minuten`, url }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); say(`Link naar deze ${unitWord()} gekopieerd. Plak hem in een bericht of mail.`); return; } catch (e) {}
    const m = document.getElementById("les-msg");
    if (m) { m.innerHTML = `Kopieer deze link: <input class="fb-share-url" readonly value="${esc(url)}">`; const i = m.querySelector("input"); i.focus(); i.select(); }
  }
  document.addEventListener("click", ev => { if (ev.target.closest("#fb-share-les")) shareTraining(); });
  function openSharedTraining(q) {
    if (!has("sel") || !has("normSel") || typeof EX === "undefined") return;
    const items = String(q.get("training") || "").split(",").map(t => {
      const m = t.match(/^(.+)\.(\d+)([+-]?)$/); if (!m) return null;
      return { id: m[1], min: +m[2], lvl: m[3] === "+" ? "moeilijker" : m[3] === "-" ? "makkelijker" : "basis" };
    }).filter(v => v && EX.some(e => e.id === v.id)).map(normSel);
    if (!items.length) return;
    const same = JSON.stringify(sel) === JSON.stringify(items);
    if (sel.length && !same && !confirm(`Je hebt al oefeningen gekozen. Wil je die vervangen door de gedeelde ${unitWord()}?`)) return;
    sel = items;
    const w = parseInt(q.get("w"), 10); if (w >= 0 && w <= 30 && has("WISSEL")) { WISSEL = w; try { localStorage.setItem(C.key + "-wissel", w); } catch (e) {} if (typeof syncWissel === "function") syncWissel(); }
    const n = parseInt(q.get("n"), 10); if (n >= 4 && n <= 40 && has("N")) { N = n; try { if (typeof N_KEY !== "undefined") localStorage.setItem(N_KEY, n); } catch (e) {} const ki = document.getElementById("kids"); if (ki) ki.value = n; }
    const z = String(q.get("z") || "").split("x").map(Number); if (z.length === 2 && typeof setZaal === "function") setZaal(z[0], z[1]);
    if (has("curNr")) curNr = null;
    if (typeof saveLes === "function") saveLes();
    if (typeof renderGrid === "function") renderGrid();
    if (typeof renderBar === "function") renderBar();
    const d = document.getElementById("mat");
    if (typeof renderKit === "function") renderKit();
    if (typeof renderSum === "function") renderSum();
    const t = q.get("t");
    if (typeof setMsg === "function") setMsg(`Gedeelde ${unitWord()}${t ? " “" + t + "”" : ""} geladen. Klik op Bewaren om hem in je bibliotheek te zetten.`);
    if (d && !d.open) d.showModal();
  }

  /* geopend via een gedeelde link: oefening of training meteen tonen */
  function openShared() {
    if (location.hash.startsWith("#training=")) {
      openSharedTraining(new URLSearchParams(location.hash.slice(1)));
      history.replaceState(null, "", location.href.split("#")[0]);
      return;
    }
    const m = location.hash.match(new RegExp("^#" + SHARE_KEY + "=([^&]+)")); if (!m) return;
    let id; try { id = decodeURIComponent(m[1]); } catch (e) { return; }
    if (typeof openEx !== "function" || !exById(id)) return;
    openEx(id);
    const d = document.getElementById("dlg");
    if (d) d.addEventListener("close", () => { if (location.hash.startsWith("#" + SHARE_KEY + "=")) history.replaceState(null, "", location.href.split("#")[0]); }, { once: true });
  }

  /* ---------- klikken ---------- */
  document.addEventListener("click", ev => {
    const sh = ev.target.closest("[data-share]");
    if (sh) { share(sh.dataset.share, sh); return; }
    const star = ev.target.closest("[data-rate]");
    if (star) {
      const id = star.dataset.ex, n = +star.dataset.rate;
      mine[id] = n; ls.set(MINE_KEY, mine);
      openFb.add(id); sentFb.delete(id);
      refreshAll();
      const ta = document.querySelector(`#grid [data-fbform="${id}"] textarea`); if (ta) ta.focus({ preventScroll: true });
      enqueue({ fn: "rate", body: withApp({ p_program: PROGRAM, p_exercise: id, p_device: DEVICE, p_score: n }) }); setTimeout(loadStats, 1200);
      return;
    }
    const tg = ev.target.closest("[data-fbtoggle]");
    if (tg) { const id = tg.dataset.fbtoggle; if (openFb.has(id)) { openFb.delete(id); delete drafts[id]; } else openFb.add(id); refreshAll(); return; }
    const t = ev.target.closest("[data-toggle]");
    if (t && t.getAttribute("aria-pressed") !== "true")
      enqueue({ fn: "pick", body: withApp({ p_program: PROGRAM, p_exercise: t.dataset.toggle, p_device: DEVICE }) });
  }, true);
  document.addEventListener("submit", ev => {
    const f = ev.target.closest("[data-fbform]"); if (!f) return;
    ev.preventDefault();
    const id = f.dataset.fbform, txt = f.querySelector("textarea").value.trim().slice(0, 500);
    notes[id] = txt; ls.set(FB_KEY, notes); delete drafts[id]; openFb.delete(id); sentFb.add(id); refreshAll();
    if (mine[id]) { setTimeout(loadStats, 1200); enqueue({ fn: "rate", body: withApp({ p_program: PROGRAM, p_exercise: id, p_device: DEVICE, p_score: mine[id], p_feedback: txt }) }); }
  }, true);

  /* ---------- overzicht van scores en toelichtingen (testversie: alleen voor de eigenaar) ---------- */
  async function openReport() {
    let d = document.getElementById("fb-report");
    if (!d) {
      document.body.insertAdjacentHTML("beforeend", `<dialog id="fb-report" aria-labelledby="fb-report-t"><div class="dlg-head"><div><div class="num">Alle gebruikers</div><h2 id="fb-report-t">Scores en toelichtingen</h2></div><button class="close" type="button" data-close aria-label="Sluiten">×</button></div><div class="dlg-body" id="fb-report-b"></div></dialog>`);
      d = document.getElementById("fb-report");
      d.addEventListener("click", e => { if (e.target === d) d.close(); });
    }
    const body = document.getElementById("fb-report-b"); body.innerHTML = `<p class="note">Laden…</p>`; d.showModal();
    try {
      const [rows, fb] = await Promise.all([api.stats(), api.feedback()]);
      const list = (typeof EX !== "undefined" ? EX : []).map(e => ({ e, s: rows.find(r => r.exercise_id === e.id) || {} }))
        .sort((a, b) => (a.s.avg_score ?? 9) - (b.s.avg_score ?? 9) || a.e.title.localeCompare(b.e.title, "nl"));
      const st = v => v == null ? "–" : "★".repeat(Math.round(v)) + "☆".repeat(5 - Math.round(v)) + " " + fmt(v);
      body.innerHTML = `<p class="note">Laagste score bovenaan. Rood: gemiddeld onder de 2,5 met minstens 3 stemmen.</p><div class="fb-rep">` + list.map(({ e, s }) => {
        const f = fb.filter(x => x.exercise_id === e.id), low = s.votes >= 3 && s.avg_score < 2.5;
        return `<details class="fb-repi${low ? " low" : ""}"${f.length ? "" : " data-empty"}><summary><b>${esc(e.title)}</b><span>${st(s.avg_score)} · ${s.votes || 0} stemmen · ${s.picks || 0}× gekozen · ${f.length} ${f.length === 1 ? "toelichting" : "toelichtingen"}</span></summary>` +
          (f.length ? `<ul>${f.map(x => `<li><span class="fb-s">${"★".repeat(x.score)}</span> ${esc(x.feedback)}</li>`).join("")}</ul>` : "") + `</details>`;
      }).join("") + `</div>`;
    } catch (e) { body.innerHTML = `<p class="note">De scores konden niet worden geladen.</p>`; }
  }
  document.addEventListener("click", ev => { if (ev.target.closest("#fb-report-open")) openReport(); });

  /* ---------- opmaak ---------- */
  const css = `.fb-rate{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px}
.fb-stars{display:inline-flex}
.fb-star{font:22px/1 var(--body,system-ui);width:34px;height:34px;padding:0;border:none;background:none;color:var(--line);cursor:pointer;border-radius:6px}
.fb-star.on.avg{color:var(--cone,#f2b705);opacity:.55}.fb-star.on.mine{color:var(--cone,#f2b705)}
.fb-star:hover,.fb-star:focus-visible{background:var(--bg)}
.fb-lbl{font-size:13px;color:var(--muted)}
.fb-fbtn{font:inherit;font-size:13px;font-weight:700;color:var(--accent);background:none;border:none;padding:4px 0;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.fb-form{flex-basis:100%;display:grid;gap:6px;margin-top:2px}
.fb-form label{font-size:14px;font-weight:700}.fb-form label span{font-weight:400;color:var(--muted)}
.fb-form textarea{font:inherit;font-size:15px;width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);resize:vertical}
.fb-fact{display:flex;gap:8px}
.fb-send,.fb-cancel{font:inherit;font-size:14px;font-weight:700;border-radius:8px;padding:6px 12px;cursor:pointer;border:1.5px solid var(--ink);background:transparent;color:var(--ink)}
.fb-send{background:var(--ink);color:var(--surface)}
.fb-dlg-rate{background:var(--bg);border-radius:10px;padding:10px 12px}
.fb-dlg-rate h4{margin:0 0 2px}
.fb-sf{display:inline-flex;align-items:center;gap:6px;font-size:15px;margin-left:auto}
.fb-sf select{font:inherit;font-size:15px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);padding:5px 10px;border-radius:999px;cursor:pointer}
#dlg .dlg-body>.actions:last-child{flex-wrap:wrap;align-items:center}
.fb-share{margin-left:auto;flex:none;white-space:nowrap}
.fb-share-msg{flex-basis:100%;text-align:right}.fb-share-msg:empty{display:none}
.fb-share-url{font:inherit;font-size:14px;width:100%;margin-top:4px;padding:6px 8px;border-radius:8px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink)}
.fb-home{display:inline-flex;align-items:center;gap:6px;font:700 15px var(--body,system-ui);color:var(--ink);text-decoration:none;border:1.5px solid var(--line);border-radius:999px;padding:5px 12px;justify-self:start;background:var(--surface)}
.fb-home:hover{border-color:var(--ink)}
.fb-rep{display:grid;gap:8px}
.fb-repi{border:1px solid var(--line);border-radius:10px;padding:8px 12px}
.fb-repi.low{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}
.fb-repi summary{cursor:pointer;display:grid;gap:2px}.fb-repi summary span{font-size:14px;color:var(--muted)}
.fb-repi[data-empty] summary{cursor:default;list-style:none}
.fb-repi ul{margin:8px 0 2px;padding-left:18px;display:grid;gap:4px;font-size:15px}
.fb-s{color:var(--cone,#f2b705)}
.fb-tools{display:flex;align-items:center;gap:8px;margin-left:auto;flex:1 1 340px;justify-content:flex-end;min-width:0}
.fb-tools .fb-sf{margin-left:0;flex:none}
.fb-search{display:inline-flex;align-items:center;gap:6px;flex:1 1 140px;max-width:280px;min-width:0;border:1.5px solid var(--line);background:var(--surface);border-radius:999px;padding:0 6px 0 12px}
.fb-search:focus-within{border-color:var(--ink)}
.fb-search-i{color:var(--muted);font-size:18px;line-height:1}
.fb-search input{font:inherit;font-size:15px;border:none;outline:none;background:none;color:var(--ink);padding:6px 4px;width:100%;min-width:0}
header.fb-has-logo{position:relative}
header.fb-has-logo>:not(.fb-logo-a):not(.fb-home){padding-right:clamp(64px,15vw,110px);text-align:left}
.fb-logo-a{position:absolute;top:18px;right:0;display:flex;flex-direction:column;align-items:center;gap:4px;text-decoration:none;color:var(--ink)}
.fb-logo-label{font:800 clamp(14px,3vw,18px)/1 var(--display,inherit);text-transform:uppercase;letter-spacing:.08em}
.fb-logo{display:block;width:auto;height:clamp(84px,19vw,130px)}
@media print{.fb-share,.fb-share-msg,.fb-form,.fb-rate,.fb-dlg-rate,.fb-home,.fb-search{display:none!important}.fb-logo{height:70px}}
/* UI-herziening nov 2026: rustiger kaarten, compacte balken op mobiel, grotere tikvlakken */
.legrow{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px 16px;margin-block:0 12px}
.legwrap{flex:1 1 0;min-width:0}
.legwrap summary{cursor:pointer;font-weight:700;font-size:14px;color:var(--muted);min-height:44px;display:inline-flex;align-items:center;gap:6px}
.legwrap .legend{margin-block:4px 4px}
.legrow .pause{font:inherit;font-size:14px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:0 14px;min-height:44px;cursor:pointer;margin-left:auto}
.fchips{display:contents}
.fgl{align-self:center;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);flex:none}
.chip{min-height:44px;padding:6px 16px}
.btn{min-height:44px}
.tstep button{width:44px;height:44px}
.mini button,.les-list .mini button{width:44px;height:44px}
.close{width:44px;height:44px}
.fb-search input{min-height:40px}
.filters .fb-tools{flex-basis:460px}
.meta .m2{border:none;padding:0}
.card .num{margin-bottom:-4px}
.tile.zero{display:none}
#mat .dlg-body{display:flex;flex-direction:column}
#mat .les-actions{order:2;position:sticky;bottom:0;z-index:2;background:var(--surface);margin:0 -18px -20px;padding:12px 18px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line)}
#mat #sum-list{order:1}
#dlg .dlg-body>.actions:last-child{position:sticky;bottom:0;z-index:2;background:var(--surface);margin:0 -18px -20px;padding:12px 18px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line)}
.print-choice{display:flex;flex-wrap:wrap;gap:8px;width:100%}
/* UI-review nov 2026: tikvlakken minstens 44 px, Delen bovenin het Uitleg-venster, nette sterrenkeuze */
.fb-star{width:44px;height:44px}
.fb-fbtn{min-height:44px}
.fb-home{min-height:44px;padding:0 14px}
body .tstep button{width:44px;height:44px}
body .stepper button{width:46px;height:46px}
body .dlg-body ol.sum-list{padding-left:0}
#dlg .dlg-head>div:first-child{flex:1 1 auto;min-width:0}
#dlg .dlg-head .fb-share{margin-left:0;align-self:flex-start}
.fb-sf{position:relative}
.fb-sf select{-webkit-appearance:none;appearance:none;min-height:44px;padding:0 34px 0 14px}
.fb-sf::after{content:"";position:absolute;right:14px;top:50%;width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:translateY(-70%) rotate(45deg);pointer-events:none}
.fb-search{min-height:44px}
.legwrap summary{list-style:none}
.legwrap summary::-webkit-details-marker{display:none}
/* niet inzoomen op de telefoon: geen dubbeltik-zoom op knoppen, en invoervelden minstens 16 px (anders zoomt iOS in bij het tikken) */
button,a,input,select,textarea,summary,label,.chip{touch-action:manipulation}
.fb-form textarea,.fb-sf select,.fb-search input{font-size:16px}
.legwrap summary::before{content:"";width:7px;height:7px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);margin-right:2px}
.legwrap[open] summary::before{transform:rotate(45deg)}
@media (prefers-reduced-motion:no-preference){.legwrap summary::before{transition:transform .15s}}
.fb-fade{display:none}
.print-choice[hidden]{display:none}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .lesbar{background:var(--surface);color:var(--ink);border-top:1px solid var(--line)}:root:not([data-theme="light"]) .lesbar .btn{border-color:var(--ink);color:var(--ink)}:root:not([data-theme="light"]) .lesbar .btn.light{background:var(--ink);color:var(--surface)}}
:root[data-theme="dark"] .lesbar{background:var(--surface);color:var(--ink);border-top:1px solid var(--line)}
:root[data-theme="dark"] .lesbar .btn{border-color:var(--ink);color:var(--ink)}
:root[data-theme="dark"] .lesbar .btn.light{background:var(--ink);color:var(--surface)}
@media (max-width:700px),(max-height:500px) and (orientation:landscape){
  /* telefoon (staand, of liggend met een laag scherm): alleen de onderdeel-chips blijven bovenin staan, zoeken en sterren scrollen mee */
  div.filters{display:contents}
  .filters .fchips{position:sticky;top:env(safe-area-inset-top,0px);z-index:4;background:var(--bg);padding-block:10px;box-shadow:0 1px 0 var(--line)}
  .filters .fb-tools{flex-wrap:wrap;margin-block:10px}
  .fchips{display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;margin-inline:-16px;padding-inline:16px;scrollbar-width:none}
  .fchips::-webkit-scrollbar{display:none}
  .fchips>*{flex:none}
  .filters .fb-tools{flex:1 1 100%;margin-left:0;flex-wrap:wrap;justify-content:flex-start;row-gap:8px}
  .filters .fb-search{max-width:none;flex:1 1 0}
  .filters .fb-tools{flex-wrap:nowrap}
  .fchips{position:relative}
  .fchips .fb-fade{display:block;position:sticky;right:-16px;flex:none;width:48px;margin-left:-48px;margin-right:-16px;background:linear-gradient(to right,transparent,var(--bg) 80%);pointer-events:none;transition:opacity .15s}
  .fchips.fb-end .fb-fade{opacity:0}
}
@media (max-width:700px){
  .lesbar{padding-top:8px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}
  body .lesbar .in{display:grid;grid-template-columns:1fr;gap:6px}
  .lesbar strong{font-size:18px}
  .lesbar .bar-sub{display:none}
  body .lesbar .barbtns{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
  body .lesbar .btn{padding:6px 4px;font-size:14px;white-space:nowrap;text-align:center}
  .lesbar .lg{display:none}
  body{padding-bottom:110px}
  .lesbar.fb-empty strong{display:none}
  body:has(.lesbar.fb-empty){padding-bottom:70px}
}
/* UI-review 22 nov 2026 */
/* knoppen op een kaart blijven op hun plek als een buurkaart hoger wordt (tijdknop na "In de training") */
body #grid .card .body .actions{margin-top:0}
/* legenda ook in het Uitleg-venster */
.fb-dlg-leg{margin:-4px 0 4px}
.fb-dlg-leg .legend{margin-block:4px 0}
/* korte knopteksten in de onderbalk op de telefoon */
.fb-s-lbl{display:none}
@media (max-width:700px){
  .lesbar .btn .fb-l-lbl{display:none}
  .lesbar .btn .fb-s-lbl{display:inline}
  body .lesbar .barbtns .btn{white-space:nowrap;font-size:14px;padding:6px 4px}
  /* kop compacter, knoppen onder de kop op één regel die zijwaarts scrolt */
  header{padding-block:16px 6px}
  header .lead{font-size:15px;line-height:1.4}
  body .o-row{flex-wrap:nowrap;overflow-x:auto;margin-inline:-16px;padding-inline:16px;scrollbar-width:none}
  body .o-row::-webkit-scrollbar{display:none}
  body .o-row>*{flex:none}
  body .o-row .pill{min-height:40px;padding:0 12px}
}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  function start() {
    const head = document.querySelector("header");
    /* Losse app (floorball-gymles): eigen logo, eigen kopteksten en woorden, terugknop naar de eigen startpagina. */
    const APP = window.FB_APP;
    if (APP && head) {
      const T = APP.texts || {}, W = APP.words, set = (sel, t) => { const el = document.querySelector(sel); if (el && t) el.textContent = t; };
      if (T.title) document.title = T.title;
      set("header .eyebrow", T.eyebrow); set("header h1", T.h1); set("header .lead", T.lead);
      if (W) {
        set("#open-mat", "Maak een " + W.unit); set("#open-gen", "Suggestie voor een " + W.unit); set("#gen-title", "Suggestie voor een " + W.unit); set("#mat-title", W.title); set("#bib .num", W.libTitle);
        const mt = document.getElementById("mat-title"), num = mt && mt.previousElementSibling; if (num) num.textContent = W.Unit + "overzicht";
        document.querySelectorAll("header .lead, .note").forEach(el => { el.innerHTML = el.innerHTML.replace(/In de training/g, "In de " + W.unit).replace(/elke training/g, "elke " + W.unit); });
      }
      if (W && W.people === "kinderen") {                     // venster Instellingen: kinderen en zaal in plaats van spelers en veld
        set("#set .num", "Kinderen, zaal en wisselen"); set('label[for="kids"]', "Aantal kinderen");
        set('label[for="zw"]', "Lengte zaal (m)"); set('label[for="zh"]', "Breedte zaal (m)");
        document.querySelectorAll("#set .note").forEach(el => { el.textContent = el.textContent.replace("de indeling van het veld", "de indeling van de zaal"); });
      }
      head.querySelectorAll(".fb-home").forEach(a => a.remove());
      if (APP.home) head.insertAdjacentHTML("afterbegin", `<a class="fb-home" href="${APP.home}">← Terug naar startpagina</a>`);
      if (!head.querySelector(".fb-logo")) { head.classList.add("fb-has-logo"); head.insertAdjacentHTML("afterbegin", `<a href="${APP.home || "#"}" class="fb-logo-a" aria-label="Naar de startpagina"><img class="fb-logo" src="${APP.logo}" alt="${esc(APP.logoAlt || "")}"><span class="fb-logo-label">${esc(APP.logoLabel || "training")}</span></a>`); }
    }
    if (HOSTED && !APP && head && !head.querySelector(".fb-home")) head.insertAdjacentHTML("afterbegin", `<a class="fb-home" href="../">← Terug naar startpagina</a>`);
    if (HOSTED && !APP && head && !head.querySelector(".fb-logo")) { head.classList.add("fb-has-logo"); head.insertAdjacentHTML("afterbegin", `<a href="../" class="fb-logo-a" aria-label="Naar de startpagina"><img class="fb-logo" src="../icons/ufc-logo.png" alt="UFC Utrecht" width="155" height="224"><span class="fb-logo-label">training</span></a>`); }
    decorate();
    const mo = new MutationObserver(decorate);
    ["grid", "dlg-body", "filters"].forEach(id => { const el = document.getElementById(id); if (el) mo.observe(el, { childList: true }); });
    (async () => {
      if (SUPA) api = supaApi;
      else { try { api = await claudeApi(); } catch (e) { api = null; } }
      if (api && !SUPA && isOwner && head && !document.getElementById("fb-report-open"))
        head.insertAdjacentHTML("beforeend", `<button type="button" class="linkbtn" id="fb-report-open">Scores en toelichtingen van alle gebruikers</button>`);
      refreshAll(); loadStats(); flush();
    })();
    openShared();
    addEventListener("hashchange", openShared);
    const sum = document.getElementById("les-sum");
    if (sum) new MutationObserver(barState).observe(sum, { childList: true, characterData: true, subtree: true });
    document.addEventListener("scroll", e => { if (e.target.classList && e.target.classList.contains("fchips")) chipFade(e.target); }, true);
    addEventListener("resize", () => chipFade(document.querySelector(".fchips")));
    if (HOSTED && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register((window.FB_APP && window.FB_APP.sw) || "../sw.js", { scope: (window.FB_APP && window.FB_APP.swScope) || "../" }).catch(() => {});
  }

  /* Eén printknop in het trainingsoverzicht: opent de keuze tussen alleen oefeningen of alles. */
  document.addEventListener("click", ev => {
    const pm = ev.target.closest("#print-menu"), om = ev.target.closest("#open-mat");
    const c = document.getElementById("print-choice"), b = document.getElementById("print-menu");
    if (!c || !b) return;
    if (pm) { c.hidden = !c.hidden; b.setAttribute("aria-expanded", String(!c.hidden)); }
    else if (om) { c.hidden = true; b.setAttribute("aria-expanded", "false"); }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.FB_ONLINE = { loadStats, get stats() { return stats; } };
})();
