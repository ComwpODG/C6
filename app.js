(() => {
  const mount = document.getElementById("pixiMount");
  const hoverCard = document.getElementById("hoverCard");
  const hcName = document.getElementById("hcName");
  const hcOwner = document.getElementById("hcOwner");
  const hcIcons = document.getElementById("hcIcons");
  const hcDetails = document.getElementById("hcDetails");

  const navLeft  = document.getElementById("navLeft");
  const navRight = document.getElementById("navRight");
  const navUp    = document.getElementById("navUp");
  const navDown  = document.getElementById("navDown");

  // --- config ---
  const STATE_URL = "data/state.json";
  const ZOOM_MIN = 0.12;
  const ZOOM_MAX = 3.5;

  // Star size behavior:
  // - When zooming OUT: stars shrink with zoom and can vanish
  // - When zooming IN: star pixel size is capped so they don't become huge overlapping mush
  const STAR_BASE_PX = 18;     // pixel size at zoom = 1
  const STAR_MAX_PX  = 26;     // cap when zooming in
  const STAR_HIDE_PX = 1.8;    // if computed pixel size below this, hide

  const LABEL_SHOW_ZOOM = 0.45; // below this, hide labels for declutter

  // Camera pan animation
  const PAN_MS = 750;

  // --- Pixi app ---
  const app = new PIXI.Application({
    resizeTo: mount,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2)
  });
  mount.appendChild(app.view);

  // Root scene
  const world = new PIXI.Container();
  app.stage.addChild(world);

  // Apply CRT filter toggle (optional)
  let crtEnabled = true;
  const crtFilter = new PIXI.filters.CRTFilter({
    curvature: 2.2,
    lineWidth: 1.3,
    lineContrast: 0.08,
    noise: 0.12,
    noiseSize: 1.0,
    seed: Math.random(),
    vignetting: 0.22,
    vignettingAlpha: 0.6
  });
  app.stage.filters = [crtFilter];

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "c") {
      crtEnabled = !crtEnabled;
      app.stage.filters = crtEnabled ? [crtFilter] : null;
    }
  });

  // --- textures (procedural star + procedural icons) ---
  function makeStarTexture() {
    const g = new PIXI.Graphics();
    g.clear();
    // simple 5-point star-ish burst
    g.beginFill(0xffffff, 1.0);
    g.drawCircle(0, 0, 10);
    g.endFill();

    // glow ring
    g.beginFill(0xffffff, 0.22);
    g.drawCircle(0, 0, 16);
    g.endFill();

    // core
    g.beginFill(0xffffff, 1.0);
    g.drawCircle(0, 0, 4);
    g.endFill();

    const tex = app.renderer.generateTexture(g, { resolution: 2, scaleMode: PIXI.SCALE_MODES.LINEAR });
    tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
    return tex;
  }

  function makeIconTexture(kind) {
    const g = new PIXI.Graphics();

    // All icons share size ~16px in their own texture space.
    // We draw distinct shapes so you can swap to PNGs later if you want.
    if (kind === "shipyard") {
      g.beginFill(0xffffff, 1.0);
      g.drawRoundedRect(-8, -6, 16, 12, 3);
      g.endFill();
      g.beginFill(0xffffff, 1.0);
      g.drawRect(-2, -10, 4, 6);
      g.endFill();
    } else if (kind === "capital") {
      g.beginFill(0xffffff, 1.0);
      g.drawPolygon([-8, 6, 0, -10, 8, 6]);
      g.endFill();
      g.beginFill(0xffffff, 1.0);
      g.drawCircle(0, 2, 2);
      g.endFill();
    } else if (kind === "anomaly") {
      g.lineStyle(2, 0xffffff, 1.0);
      g.drawCircle(0, 0, 7);
      g.drawCircle(0, 0, 3);
      g.lineStyle(0);
    } else if (kind === "ruins") {
      g.beginFill(0xffffff, 1.0);
      g.drawRect(-7, -7, 14, 14);
      g.endFill();
      g.beginFill(0x000000, 0.35);
      g.drawRect(-3, -7, 6, 10);
      g.endFill();
    } else if (kind === "trade") {
      g.beginFill(0xffffff, 1.0);
      g.drawRoundedRect(-7, -4, 14, 8, 3);
      g.endFill();
      g.beginFill(0x000000, 0.35);
      g.drawCircle(-3, 0, 1.5);
      g.drawCircle(3, 0, 1.5);
      g.endFill();
    } else if (kind === "danger") {
      g.beginFill(0xffffff, 1.0);
      g.drawPolygon([0, -9, 9, 8, -9, 8]);
      g.endFill();
      g.beginFill(0x000000, 0.45);
      g.drawRect(-1, -2, 2, 6);
      g.drawCircle(0, 6, 1.3);
      g.endFill();
    } else {
      g.beginFill(0xffffff, 1.0);
      g.drawCircle(0, 0, 7);
      g.endFill();
    }

    const tex = app.renderer.generateTexture(g, { resolution: 2, scaleMode: PIXI.SCALE_MODES.LINEAR });
    tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
    return tex;
  }

  const starTex = makeStarTexture();
  const iconTex = new Map();
  ["shipyard","capital","anomaly","ruins","trade","danger"].forEach(k => iconTex.set(k, makeIconTexture(k)));

  // --- camera model ---
  const camera = {
    scale: 0.42,
    center: new PIXI.Point(2000, 2000),
    dragging: false,
    dragStart: null,
    centerStart: null,
    panAnim: null
  };

  function applyCamera() {
    // world is transformed so that camera.center appears at viewport center
    const vw = app.renderer.width;
    const vh = app.renderer.height;

    world.scale.set(camera.scale);
    world.position.set(vw * 0.5, vh * 0.5);
    world.pivot.set(camera.center.x, camera.center.y);
  }

  function clampScale(s) {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s));
  }

  // --- input: drag pan + wheel zoom ---
  app.view.addEventListener("pointerdown", (e) => {
    camera.dragging = true;
    camera.dragStart = { x: e.clientX, y: e.clientY };
    camera.centerStart = { x: camera.center.x, y: camera.center.y };
    camera.panAnim = null; // cancel pan animation if user drags
    hideHover();
  });

  window.addEventListener("pointerup", () => {
    camera.dragging = false;
  });

  window.addEventListener("pointermove", (e) => {
    if (!camera.dragging) return;
    const dx = (e.clientX - camera.dragStart.x) / camera.scale;
    const dy = (e.clientY - camera.dragStart.y) / camera.scale;
    camera.center.x = camera.centerStart.x - dx;
    camera.center.y = camera.centerStart.y - dy;
    applyCamera();
    updateNavArrows();
  });

  app.view.addEventListener("wheel", (e) => {
    e.preventDefault();

    const rect = app.view.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert mouse screen point to world before zoom
    const before = screenToWorld(mouseX, mouseY);

    // Zoom
    const zoomFactor = Math.pow(1.0016, -e.deltaY);
    const nextScale = clampScale(camera.scale * zoomFactor);

    camera.scale = nextScale;

    // Convert mouse screen point to world after zoom, adjust center so the point stays anchored
    const after = screenToWorld(mouseX, mouseY);
    camera.center.x += (before.x - after.x);
    camera.center.y += (before.y - after.y);

    applyCamera();
    updateNavArrows();
  }, { passive: false });

  function screenToWorld(sx, sy) {
    // Inverse transform of world -> screen given our camera model
    const vw = app.renderer.width;
    const vh = app.renderer.height;
    const x = (sx - vw * 0.5) / camera.scale + camera.center.x;
    const y = (sy - vh * 0.5) / camera.scale + camera.center.y;
    return { x, y };
  }

  // --- hover UI helpers ---
  function showHover(system, screenX, screenY, factions, iconLegend) {
    hcName.textContent = system.name;
    const f = factions[system.owner] || { name: system.owner, color: "#b9c1cf" };
    hcOwner.textContent = f.name;
    hcOwner.style.borderColor = `${f.color}66`;
    hcOwner.style.color = f.color;

    hcIcons.innerHTML = "";
    (system.icons || []).forEach(k => {
      const pill = document.createElement("div");
      pill.className = "iconPill";
      pill.textContent = iconLegend?.[k] ?? k;
      hcIcons.appendChild(pill);
    });

    hcDetails.textContent = system.details || "";

    hoverCard.hidden = false;

    // Offset so it doesn't sit under cursor
    const pad = 16;
    hoverCard.style.left = `${screenX + pad}px`;
    hoverCard.style.top  = `${screenY + pad}px`;
  }

  function hideHover() {
    hoverCard.hidden = true;
  }

  // --- data + scene build ---
  let state = null;
  const galaxiesById = new Map();

  // Keep references for per-frame scaling rules
  const allMarkers = []; // { starSprite, labelText, iconSprites[], data, factionsRef, iconLegendRef }
  const galaxyCenters = []; // { id, name, cx, cy }

  async function loadState() {
    // cache-bust to make GitHub Pages updates show up quickly
    const res = await fetch(`${STATE_URL}?cb=${Date.now()}`);
    if (!res.ok) throw new Error(`Failed to load state: ${res.status}`);
    return await res.json();
  }

  async function rebuildScene(newState) {
    state = newState;

    // clear
    world.removeChildren();
    galaxiesById.clear();
    allMarkers.length = 0;
    galaxyCenters.length = 0;
    hideHover();

    const factions = state.factions || {};
    const iconLegend = state.iconLegend || {};

    // build each galaxy as a container in shared universe-space
    for (const g of state.galaxies || []) {
      const galaxy = new PIXI.Container();
      galaxy.position.set(g.origin[0], g.origin[1]);
      world.addChild(galaxy);

      // background
      const bgTex = await PIXI.Assets.load(g.background.image);
      bgTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
      const bg = new PIXI.Sprite(bgTex);
      bg.x = 0;
      bg.y = 0;
      bg.width = g.background.width;
      bg.height = g.background.height;
      bg.alpha = 0.95;
      galaxy.addChild(bg);

      // territories (under stars)
      const territoryLayer = new PIXI.Container();
      galaxy.addChild(territoryLayer);

      for (const t of g.territories || []) {
        const fac = factions[t.owner] || { color: "#b9c1cf" };
        const poly = new PIXI.Graphics();
        poly.beginFill(PIXI.utils.string2hex(fac.color), t.alpha ?? 0.16);
        poly.drawPolygon(t.polygon.flatMap(p => p));
        poly.endFill();

        // soft outline
        poly.lineStyle(2, PIXI.utils.string2hex(fac.color), Math.min((t.alpha ?? 0.16) + 0.12, 0.35));
        poly.drawPolygon(t.polygon.flatMap(p => p));
        poly.lineStyle(0);

        territoryLayer.addChild(poly);
      }

      // stars
      const systemLayer = new PIXI.Container();
      galaxy.addChild(systemLayer);

      for (const s of g.systems || []) {
        const fac = factions[s.owner] || { color: "#b9c1cf" };

        const marker = new PIXI.Container();
        marker.position.set(s.pos[0], s.pos[1]);
        marker.eventMode = "static";
        marker.cursor = "pointer";

        // star sprite (centered)
        const star = new PIXI.Sprite(starTex);
        star.anchor.set(0.5);
        star.tint = PIXI.utils.string2hex(fac.color);
        marker.addChild(star);

        // label (not tilted because it's in-canvas; we hide at low zoom)
        const label = new PIXI.Text(s.name, {
          fontFamily: "ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial",
          fontSize: 18,
          fill: 0xcfe7ff,
          align: "left"
        });
        label.x = 16;
        label.y = -10;
        label.alpha = 0.95;
        marker.addChild(label);

        // icons next to name
        const iconSprites = [];
        let ix = label.x + Math.min(label.width + 10, 220);
        const iy = 0;

        for (const ik of (s.icons || [])) {
          const tex = iconTex.get(ik);
          if (!tex) continue;
          const ic = new PIXI.Sprite(tex);
          ic.anchor.set(0.5);
          ic.x = ix;
          ic.y = iy;
          ic.tint = 0xffffff;
          marker.addChild(ic);
          iconSprites.push(ic);
          ix += 18;
        }

        // interaction: hover card only (no scaling)
        marker.on("pointerover", (ev) => {
          const rect = app.view.getBoundingClientRect();
          const sx = rect.left + ev.global.x; // ev.global is in renderer coords
          const sy = rect.top + ev.global.y;
          showHover(s, sx - rect.left, sy - rect.top, factions, iconLegend);
        });
        marker.on("pointermove", (ev) => {
          if (hoverCard.hidden) return;
          const rect = app.view.getBoundingClientRect();
          const sx = ev.global.x;
          const sy = ev.global.y;
          // keep within HUD coordinate space (non-tilted)
          showHover(s, sx, sy, factions, iconLegend);
        });
        marker.on("pointerout", () => hideHover());

        systemLayer.addChild(marker);

        allMarkers.push({
          starSprite: star,
          labelText: label,
          iconSprites,
          data: s,
          factionsRef: factions,
          iconLegendRef: iconLegend
        });
      }

      galaxiesById.set(g.id, { galaxy, meta: g });

      // Precompute center for navigation
      const cx = g.origin[0] + g.background.width * 0.5;
      const cy = g.origin[1] + g.background.height * 0.5;
      galaxyCenters.push({ id: g.id, name: g.name, cx, cy });
    }

    // Start camera focused on first galaxy center if not already set
    if (galaxyCenters.length > 0) {
      camera.center.set(galaxyCenters[0].cx, galaxyCenters[0].cy);
    }
    applyCamera();
    updateNavArrows();
  }

  // --- per-frame rules: star scaling cap, label visibility, etc. ---
  function updateMarkerScales() {
    const z = camera.scale;

    // star pixel size rule: px = min(basePx*z, maxPx)
    // then set localScale so resulting on-screen size is px
    for (const m of allMarkers) {
      const texW = m.starSprite.texture.width || 32;

      const pxDesired = STAR_BASE_PX * z;
      const px = Math.min(pxDesired, STAR_MAX_PX);

      // Hide if too tiny
      const visible = px >= STAR_HIDE_PX;
      m.starSprite.visible = visible;

      // Also reduce hit clutter by hiding label/icons when zoomed out
      const showLabel = z >= LABEL_SHOW_ZOOM;
      m.labelText.visible = showLabel;
      for (const ic of m.iconSprites) ic.visible = showLabel;

      // Scale formula:
      // screenPx = z * localScale * texW  =>  localScale = screenPx / (z * texW)
      // If pxDesired is below cap, localScale is constant and stars shrink with zoom out.
      // If capped, stars stop growing larger on zoom in.
      const localScale = px / (z * texW);
      m.starSprite.scale.set(localScale);

      // Icons should stay readable-ish but not huge: cap similarly
      for (const ic of m.iconSprites) {
        const iw = ic.texture.width || 16;
        const ipxDesired = 12 * z;
        const ipx = Math.min(ipxDesired, 14);
        const iscale = ipx / (z * iw);
        ic.scale.set(iscale);
      }

      // Label size: keep it mostly constant but fade away when zooming out
      if (m.labelText.visible) {
        m.labelText.alpha = 0.95;
        // keep label scale near constant screen size by inversely scaling with zoom
        const labelScale = 1 / Math.max(z, 0.001);
        // but don't let it balloon if z is tiny (we hide anyway)
        m.labelText.scale.set(Math.min(labelScale, 2.0));
      }
    }
  }

  // --- arrow navigation ---
  function currentViewCenter() {
    return { x: camera.center.x, y: camera.center.y };
  }

  function findNearestGalaxyInDirection(dir) {
    const c = currentViewCenter();

    // filter galaxies in that direction and pick closest by projected distance
    const candidates = galaxyCenters.filter(g => {
      const dx = g.cx - c.x;
      const dy = g.cy - c.y;
      if (dir === "left")  return dx < -20;
      if (dir === "right") return dx > 20;
      if (dir === "up")    return dy < -20;
      if (dir === "down")  return dy > 20;
      return false;
    });

    if (candidates.length === 0) return null;

    // score: prioritize direction axis first, then overall distance
    let best = null;
    let bestScore = Infinity;
    for (const g of candidates) {
      const dx = g.cx - c.x;
      const dy = g.cy - c.y;
      const axis = (dir === "left" || dir === "right") ? Math.abs(dx) : Math.abs(dy);
      const dist = Math.hypot(dx, dy);
      const score = axis * 1.0 + dist * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best;
  }

  function updateNavArrows() {
    const L = findNearestGalaxyInDirection("left");
    const R = findNearestGalaxyInDirection("right");
    const U = findNearestGalaxyInDirection("up");
    const D = findNearestGalaxyInDirection("down");

    navLeft.hidden = !L;
    navRight.hidden = !R;
    navUp.hidden = !U;
    navDown.hidden = !D;

    navLeft.onclick = L ? () => panTo(L.cx, L.cy) : null;
    navRight.onclick = R ? () => panTo(R.cx, R.cy) : null;
    navUp.onclick = U ? () => panTo(U.cx, U.cy) : null;
    navDown.onclick = D ? () => panTo(D.cx, D.cy) : null;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;
  }

  function panTo(x, y) {
    hideHover();
    camera.panAnim = {
      t0: performance.now(),
      fromX: camera.center.x,
      fromY: camera.center.y,
      toX: x,
      toY: y
    };
  }

  // --- state polling ---
  let lastUpdatedUtc = null;
  async function pollLoop() {
    try {
      const s = await loadState();
      if (lastUpdatedUtc !== s.updatedUtc) {
        lastUpdatedUtc = s.updatedUtc;
        await rebuildScene(s);
      }
      const delay = Math.max(5, s.pollSeconds || 20) * 1000;
      setTimeout(pollLoop, delay);
    } catch (err) {
      // backoff if fetch fails
      console.error(err);
      setTimeout(pollLoop, 6000);
    }
  }

  // --- ticker ---
  app.ticker.add(() => {
    // animate CRT noise seed
    if (crtEnabled) crtFilter.seed = (crtFilter.seed + 0.01) % 1.0;

    // pan animation
    if (camera.panAnim) {
      const now = performance.now();
      const t = Math.min(1, (now - camera.panAnim.t0) / PAN_MS);
      const e = easeInOutCubic(t);
      camera.center.x = camera.panAnim.fromX + (camera.panAnim.toX - camera.panAnim.fromX) * e;
      camera.center.y = camera.panAnim.fromY + (camera.panAnim.toY - camera.panAnim.fromY) * e;
      applyCamera();

      if (t >= 1) camera.panAnim = null;
    }

    updateMarkerScales();
  });

  // initial load
  pollLoop();
})();
