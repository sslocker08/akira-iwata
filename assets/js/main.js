/* 岩田暉良 作品集 — 演出・暗転・ライトボックス・収蔵庫
   規律: scrollイベント不使用（IntersectionObserverのみ）/ アニメは transform・opacity のみ */
(function () {
  "use strict";

  var docEl = document.documentElement;
  docEl.classList.add("js");

  /* 画面中央±5%の帯。-50%同士だと帯の高さが0になり発火しない環境がある */
  var CENTER_BAND = { rootMargin: "-45% 0% -45% 0%", threshold: 0 };

  /* ---------- 幕題の文字分割（旗めき用） ---------- */
  document.querySelectorAll("[data-maku]").forEach(function (el) {
    var chars = Array.from(el.textContent.trim());
    el.textContent = "";
    chars.forEach(function (ch, i) {
      var span = document.createElement("span");
      span.className = "ch";
      span.style.setProperty("--i", i);
      span.textContent = ch;
      el.appendChild(span);
    });
  });

  /* ---------- リビール（1回きり・発火後unobserve） ---------- */
  var revealIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("is-in");
        revealIO.unobserve(e.target);
      }
    });
  }, { rootMargin: "0% 0% -12% 0%", threshold: 0 });

  document.querySelectorAll("[data-reveal], .maku-title").forEach(function (el) {
    revealIO.observe(el);
  });

  /* ---------- 幕ゾーン（紙⇄夜） ---------- */
  var zoneIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      docEl.dataset.act = e.target.dataset.actzone;
    });
  }, CENTER_BAND);
  document.querySelectorAll("[data-actzone]").forEach(function (el) {
    zoneIO.observe(el);
  });

  /* ---------- 収蔵庫グリッド生成（WORKS: data.js） ---------- */
  var kuraGrid = document.getElementById("kura-grid");
  if (kuraGrid && typeof WORKS !== "undefined") {
    var frag = document.createDocumentFragment();
    WORKS.forEach(function (w, i) {
      var no = "No." + String(i + 1).padStart(3, "0");
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "kura__cell";
      cell.dataset.lb = w.id;
      cell.setAttribute("aria-label", no);
      var img = document.createElement("img");
      img.src = "img/thumbs/" + w.id + ".jpg";
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.width = 400;
      img.height = Math.round(400 * w.h / w.w);
      img.style.background = w.color;
      cell.appendChild(img);
      frag.appendChild(cell);
    });
    kuraGrid.appendChild(frag);
  }

  /* ---------- 欠図処理（unhappy path） ---------- */
  document.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.tagName === "IMG") {
      var host = t.closest(".plate, .kura__cell, .byobu__inner");
      if (host) host.classList.add("is-missing");
    }
  }, true);

  /* ---------- ライトボックス ---------- */
  var lb = document.querySelector(".lb");
  if (lb && typeof WORKS !== "undefined") {
    var lbImg = lb.querySelector(".lb__img");
    var btnClose = lb.querySelector(".lb__close");
    var btnPrev = lb.querySelector(".lb__prev");
    var btnNext = lb.querySelector(".lb__next");
    var indexOf = {};
    WORKS.forEach(function (w, i) { indexOf[w.id] = i; });
    var current = 0;
    var opener = null;

    var srcOf = function (w) { return "img/works/" + w.id + ".jpg"; };

    var show = function (i) {
      current = (i + WORKS.length) % WORKS.length;
      var w = WORKS[current];
      lbImg.classList.add("is-switching");
      var next = new Image();
      next.onload = function () {
        lbImg.src = next.src;
        lbImg.alt = "";
        lbImg.classList.remove("is-switching");
      };
      next.onerror = function () {
        lbImg.removeAttribute("src");
        lbImg.alt = "画像を読み込めませんでした（" + w.id + "）";
        lbImg.classList.remove("is-switching");
      };
      next.src = srcOf(w);
      /* 隣接±1のみ先読み */
      [current - 1, current + 1].forEach(function (j) {
        var p = new Image();
        p.src = srcOf(WORKS[(j + WORKS.length) % WORKS.length]);
      });
    };

    var open = function (id, openerEl) {
      opener = openerEl || null;
      docEl.style.overflow = "hidden";
      docEl.classList.add("lb-open");
      lb.showModal();
      show(indexOf[id] != null ? indexOf[id] : 0);
    };

    var unlock = function () {
      docEl.style.removeProperty("overflow");
      docEl.classList.remove("lb-open");
      lbImg.removeAttribute("src");
      if (opener && document.contains(opener)) opener.focus();
      opener = null;
    };
    lb.addEventListener("close", unlock);
    lb.addEventListener("cancel", function () {
      docEl.style.removeProperty("overflow");
      docEl.classList.remove("lb-open");
    });

    /* バックドロップクリックで閉じる */
    lb.addEventListener("click", function (e) {
      if (e.target === lb) lb.close();
    });

    btnClose.addEventListener("click", function () { lb.close(); });
    btnPrev.addEventListener("click", function () { show(current - 1); });
    btnNext.addEventListener("click", function () { show(current + 1); });

    lb.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); show(current - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); show(current + 1); }
    });

    /* タッチ: 横スワイプで前後 */
    var touchX = null, touchY = null;
    lb.addEventListener("touchstart", function (e) {
      touchX = e.changedTouches[0].clientX;
      touchY = e.changedTouches[0].clientY;
    }, { passive: true });
    lb.addEventListener("touchend", function (e) {
      if (touchX == null) return;
      var dx = e.changedTouches[0].clientX - touchX;
      var dy = e.changedTouches[0].clientY - touchY;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        show(dx < 0 ? current + 1 : current - 1);
      }
      touchX = touchY = null;
    }, { passive: true });

    /* 全図版クリック（委譲） */
    document.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-lb]");
      if (btn) open(btn.dataset.lb, btn);
    });
  }

  /* ---------- パララックス（rAF・transformのみ・可視要素のみ駆動） ---------- */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!reduceMotion.matches) {
    var targets = [];

    /* 汎用: data-px="深度"（負=遅れて付いてくる、正=先行して流れる） */
    document.querySelectorAll("[data-px]").forEach(function (el) {
      targets.push({ el: el, depth: parseFloat(el.dataset.px) || 0, mode: "drift", top: 0, h: 0, on: false });
    });
    /* フルブリード写真: 額縁の中で画像がゆっくり流れる（scale+translate） */
    document.querySelectorAll(".bleed-photo--cover img").forEach(function (img) {
      targets.push({ el: img, depth: 0.1, mode: "cover", top: 0, h: 0, on: false });
    });

    if (targets.length) {
      var vh = window.innerHeight;

      var hostOf = function (t) {
        return t.mode === "cover" ? t.el.closest(".bleed-photo--cover") : t.el;
      };
      var measure = function () {
        vh = window.innerHeight;
        targets.forEach(function (t) {
          var host = hostOf(t);
          var r = host.getBoundingClientRect();
          /* transformの影響を受けない素の位置に補正するため、現在の適用量を差し引く */
          t.top = r.top + window.scrollY - (t.cur || 0);
          t.h = r.height;
        });
      };

      var running = false;
      var frame = function () {
        var sy = window.scrollY;
        var active = 0;
        targets.forEach(function (t) {
          if (!t.on) return;
          active++;
          var center = t.top + t.h / 2 - sy;
          var progress = (center - vh / 2) / vh;   /* 画面中央=0, 下端≈+1, 上端≈-1 */
          if (progress > 1.4) progress = 1.4;
          if (progress < -1.4) progress = -1.4;
          if (t.mode === "cover") {
            var ty = progress * t.depth * t.h;
            t.cur = 0;
            t.el.style.transform = "translate3d(0," + ty.toFixed(1) + "px,0) scale(1.12)";
          } else {
            var d = progress * t.depth * vh;
            t.cur = d;
            t.el.style.transform = "translate3d(0," + d.toFixed(1) + "px,0)";
          }
        });
        if (active > 0) {
          requestAnimationFrame(frame);
        } else {
          running = false;
        }
      };

      var pxIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          targets.forEach(function (t) {
            if (hostOf(t) === e.target) t.on = e.isIntersecting;
          });
        });
        if (!running && targets.some(function (t) { return t.on; })) {
          running = true;
          requestAnimationFrame(frame);
        }
      }, { rootMargin: "12% 0% 12% 0%" });

      measure();
      targets.forEach(function (t) { pxIO.observe(hostOf(t)); });
      window.addEventListener("resize", measure);
    }
  }
})();
