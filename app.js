(() => {
    // --- DOM ---
    const mount = document.getElementById("pixiMount");

    const hoverCard = document.getElementById("hoverCard");
    const hcName = document.getElementById("hcName");
    const hcOwner = document.getElementById("hcOwner");
    const hcIcons = document.getElementById("hcIcons");
    const hcDetails = document.getElementById("hcDetails");

    // --- config ---
    const STATE_URL = "state.json";

    const ZOOM_MIN = 0.08;
    const ZOOM_MAX = 4.0;

    // star visual behavior:
    // - shrink with zoom-out (and can disappear)
    // - cap at STAR_MAX_PX when zooming in (prevents mush)
    const STAR_BASE_PX = 18;     // desired screen px at zoom=1
    const STAR_MAX_PX = 26;     // cap when zooming in
    const STAR_HIDE_PX = 1.6;    // hide if below this size on-screen
    const LABEL_SHOW_ZOOM = 0.45;

    // polling
    const DEFAULT_POLL_SECONDS = 20;

    // --- Pixi app ---
    const app = new PIXI.Application({
        resizeTo: mount,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    mount.appendChild(app.view);

    // --- Scene graph ---
    // parallaxLayer: does NOT scale with camera, just offsets with camera center
    // world: scales/translates with camera (universe plane)
    const parallaxLayer = new PIXI.Container();
    const world = new PIXI.Container();

    app.stage.addChild(parallaxLayer);
    app.stage.addChild(world);

    // --- Camera model: infinite plane, center + scale ---
    const camera = {
        center: new PIXI.Point(0, 0),
        scale: 0.35,
        dragging: false,
        dragStart: null,
        centerStart: null
    };

    function clampScale(s) {
        return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s));
    }

    function applyCamera() {
        const vw = app.renderer.width;
        const vh = app.renderer.height;

        // world transform so camera.center appears in the middle of the viewport
        world.scale.set(camera.scale);
        world.position.set(vw * 0.5, vh * 0.5);
        world.pivot.set(camera.center.x, camera.center.y);

        // parallax layers fill viewport and move based on camera center (not zoom)
        resizeParallax(vw, vh);
        const cx = camera.center.x;
        const cy = camera.center.y;

        // depths: far moves slower than near
        if (farStars) farStars.tilePosition.set(-cx * 0.12, -cy * 0.12);
        if (nearStars) nearStars.tilePosition.set(-cx * 0.25, -cy * 0.25);
    }

    // --- Input: drag pan + wheel zoom ---
    app.view.addEventListener("pointerdown", (e) => {
        camera.dragging = true;
        camera.dragStart = { x: e.clientX, y: e.clientY };
        camera.centerStart = { x: camera.center.x, y: camera.center.y };
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
    });

    app.view.addEventListener("wheel", (e) => {
        e.preventDefault();

        const rect = app.view.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        const before = screenToWorld(sx, sy);

        const zoomFactor = Math.pow(1.0017, -e.deltaY);
        camera.scale = clampScale(camera.scale * zoomFactor);

        const after = screenToWorld(sx, sy);

        // keep mouse point "anchored" while zooming
        camera.center.x += (before.x - after.x);
        camera.center.y += (before.y - after.y);

        applyCamera();
    }, { passive: false });

    function screenToWorld(sx, sy) {
        const vw = app.renderer.width;
        const vh = app.renderer.height;
        const x = (sx - vw * 0.5) / camera.scale + camera.center.x;
        const y = (sy - vh * 0.5) / camera.scale + camera.center.y;
        return { x, y };
    }

    // --- Hover card (HTML overlay, not tilted) ---
    function showHover(system, screenX, screenY, factions, iconLegend) {
        const fac = factions?.[system.owner] || { name: system.owner, color: "#b9c1cf" };

        hcName.textContent = system.name;
        hcOwner.textContent = fac.name;
        hcOwner.style.color = fac.color;
        hcOwner.style.borderColor = `${fac.color}66`;

        hcIcons.innerHTML = "";
        for (const k of (system.icons || [])) {
            const pill = document.createElement("div");
            pill.className = "iconPill";
            pill.textContent = iconLegend?.[k] ?? k;
            hcIcons.appendChild(pill);
        }

        hcDetails.textContent = system.details || "";

        hoverCard.hidden = false;
        const pad = 16;
        hoverCard.style.left = `${screenX + pad}px`;
        hoverCard.style.top = `${screenY + pad}px`;
    }

    function hideHover() {
        hoverCard.hidden = true;
    }

    // --- Textures (procedural) ---
    function makeStarTexture() {
        const g = new PIXI.Graphics();
        g.beginFill(0xffffff, 0.20);
        g.drawCircle(0, 0, 16);
        g.endFill();
        g.beginFill(0xffffff, 1.0);
        g.drawCircle(0, 0, 8);
        g.endFill();
        g.beginFill(0xffffff, 1.0);
        g.drawCircle(0, 0, 3);
        g.endFill();

        const tex = app.renderer.generateTexture(g, { resolution: 2, scaleMode: PIXI.SCALE_MODES.LINEAR });
        tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
        return tex;
    }

    function makeIconTexture(kind) {
        const g = new PIXI.Graphics();

        if (kind === "shipyard") {
            g.beginFill(0xffffff, 1);
            g.drawRoundedRect(-8, -6, 16, 12, 3);
            g.endFill();
            g.beginFill(0xffffff, 1);
            g.drawRect(-2, -10, 4, 6);
            g.endFill();
        } else if (kind === "capital") {
            g.beginFill(0xffffff, 1);
            g.drawPolygon([-8, 6, 0, -10, 8, 6]);
            g.endFill();
            g.beginFill(0xffffff, 1);
            g.drawCircle(0, 2, 2);
            g.endFill();
        } else if (kind === "anomaly") {
            g.lineStyle(2, 0xffffff, 1);
            g.drawCircle(0, 0, 7);
            g.drawCircle(0, 0, 3);
            g.lineStyle(0);
        } else if (kind === "ruins") {
            g.beginFill(0xffffff, 1);
            g.drawRect(-7, -7, 14, 14);
            g.endFill();
            g.beginFill(0x000000, 0.35);
            g.drawRect(-3, -7, 6, 10);
            g.endFill();
        } else if (kind === "trade") {
            g.beginFill(0xffffff, 1);
            g.drawRoundedRect(-7, -4, 14, 8, 3);
            g.endFill();
            g.beginFill(0x000000, 0.35);
            g.drawCircle(-3, 0, 1.5);
            g.drawCircle(3, 0, 1.5);
            g.endFill();
        } else if (kind === "danger") {
            g.beginFill(0xffffff, 1);
            g.drawPolygon([0, -9, 9, 8, -9, 8]);
            g.endFill();
            g.beginFill(0x000000, 0.45);
            g.drawRect(-1, -2, 2, 6);
            g.drawCircle(0, 6, 1.3);
            g.endFill();
        } else {
            g.beginFill(0xffffff, 1);
            g.drawCircle(0, 0, 7);
            g.endFill();
        }

        const tex = app.renderer.generateTexture(g, { resolution: 2, scaleMode: PIXI.SCALE_MODES.LINEAR });
        tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
        return tex;
    }

    // Parallax tile textures: draw a tiny canvas once, then use TilingSprite
    function makeStarTileTexture({ dense = false } = {}) {
        const size = 128;
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d");

        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillRect(0, 0, size, size);

        const count = dense ? 90 : 40;
        for (let i = 0; i < count; i++) {
            const x = (Math.random() * size) | 0;
            const y = (Math.random() * size) | 0;
            const b = dense ? (Math.random() * 0.9 + 0.1) : (Math.random() * 0.6 + 0.1);
            const r = Math.random() < 0.08 ? 2 : 1;

            ctx.fillStyle = `rgba(255,255,255,${b.toFixed(3)})`;
            ctx.fillRect(x, y, r, r);
        }

        // a few bigger "sparkles"
        const sparkles = dense ? 8 : 4;
        for (let i = 0; i < sparkles; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.beginPath();
            ctx.arc(x, y, 1.6, 0, Math.PI * 2);
            ctx.fill();
        }

        const tex = PIXI.Texture.from(c);
        tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF; // tiling background doesn't need mipmaps
        return tex;
    }

    const starTex = makeStarTexture();
    const iconTex = new Map();
    ["shipyard", "capital", "anomaly", "ruins", "trade", "danger"].forEach(k => iconTex.set(k, makeIconTexture(k)));

    // --- Parallax background ---
    let farStars = null;
    let nearStars = null;

    function initParallax() {
        const farTex = makeStarTileTexture({ dense: false });
        const nearTex = makeStarTileTexture({ dense: true });

        farStars = new PIXI.TilingSprite(farTex, app.renderer.width, app.renderer.height);
        nearStars = new PIXI.TilingSprite(nearTex, app.renderer.width, app.renderer.height);

        farStars.alpha = 0.35;
        nearStars.alpha = 0.50;

        parallaxLayer.addChild(farStars, nearStars);
    }

    function resizeParallax(w, h) {
        if (farStars) { farStars.width = w; farStars.height = h; }
        if (nearStars) { nearStars.width = w; nearStars.height = h; }
    }

    // --- State + world build ---
    let state = null;
    let lastUpdatedUtc = null;

    // marker references for per-frame scaling rules
    const allMarkers = [];

    async function loadState() {
        const res = await fetch(`${STATE_URL}?cb=${Date.now()}`);
        if (!res.ok) throw new Error(`Failed to load state.json: ${res.status}`);
        return await res.json();
    }

    function clearWorld() {
        world.removeChildren();
        allMarkers.length = 0;
        hideHover();
    }

    async function rebuildWorld(s) {
        state = s;
        clearWorld();

        const factions = state.factions || {};
        const iconLegend = state.iconLegend || {};

        // One container per galaxy
        for (const g of (state.galaxies || [])) {
            const galaxy = new PIXI.Container();
            const gx = g.pos?.[0] ?? 0;
            const gy = g.pos?.[1] ?? 0;
            const gs = (g.scale ?? 1);

            galaxy.position.set(gx, gy);
            galaxy.scale.set(gs);

            // Load galaxy image as sprite
            // Common pitfall on Pages: path is case-sensitive and must exist.
            const bgTex = await PIXI.Assets.load(g.image);
            bgTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;

            const bg = new PIXI.Sprite(bgTex);
            bg.anchor.set(0, 0); // galaxy-local space origin is top-left of image
            bg.alpha = 0.95;
            galaxy.addChild(bg);

            // Territories (galaxy-local coordinates)
            const territoryLayer = new PIXI.Container();
            galaxy.addChild(territoryLayer);

            for (const t of (g.territories || [])) {
                const fac = factions[t.owner] || { color: "#b9c1cf" };
                const colorHex = PIXI.utils.string2hex(fac.color);

                const poly = new PIXI.Graphics();
                poly.beginFill(colorHex, t.alpha ?? 0.16);
                poly.drawPolygon((t.polygon || []).flatMap(p => p));
                poly.endFill();

                poly.lineStyle(2, colorHex, Math.min((t.alpha ?? 0.16) + 0.12, 0.35));
                poly.drawPolygon((t.polygon || []).flatMap(p => p));
                poly.lineStyle(0);

                territoryLayer.addChild(poly);
            }

            // Systems (galaxy-local coordinates)
            const systemLayer = new PIXI.Container();
            galaxy.addChild(systemLayer);

            for (const sys of (g.systems || [])) {
                const fac = factions[sys.owner] || { color: "#b9c1cf" };

                const marker = new PIXI.Container();
                marker.position.set(sys.pos[0], sys.pos[1]);
                marker.eventMode = "static";
                marker.cursor = "pointer";

                // Star sprite
                const star = new PIXI.Sprite(starTex);
                star.anchor.set(0.5);
                star.tint = PIXI.utils.string2hex(fac.color);
                marker.addChild(star);

                // Name label
                const label = new PIXI.Text(sys.name, {
                    fontFamily: "ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial",
                    fontSize: 18,
                    fill: 0xcfe7ff
                });
                label.x = 16;
                label.y = -10;
                marker.addChild(label);

                // Icons after label (procedural for now)
                const iconSprites = [];
                let ix = label.x + Math.min(label.width + 10, 220);
                const iy = 0;

                for (const ik of (sys.icons || [])) {
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

                // Hover only: no scaling changes
                marker.on("pointerover", (ev) => {
                    const sx = ev.global.x;
                    const sy = ev.global.y;
                    showHover(sys, sx, sy, factions, iconLegend);
                });
                marker.on("pointermove", (ev) => {
                    if (hoverCard.hidden) return;
                    showHover(sys, ev.global.x, ev.global.y, factions, iconLegend);
                });
                marker.on("pointerout", () => hideHover());

                systemLayer.addChild(marker);

                allMarkers.push({ star, label, iconSprites });
            }

            world.addChild(galaxy);
        }

        // Start camera in a sensible place:
        // If there is at least one galaxy, center on it (roughly its middle).
        // We can’t know image size without reading bgTex; use bg width/height once loaded:
        // We'll center on the first galaxy image center.
        if ((state.galaxies || []).length > 0) {
            const first = state.galaxies[0];
            try {
                const tex = PIXI.Assets.get(first.image);
                if (tex && tex.width && tex.height) {
                    camera.center.set((first.pos?.[0] ?? 0) + tex.width * (first.scale ?? 1) * 0.5,
                        (first.pos?.[1] ?? 0) + tex.height * (first.scale ?? 1) * 0.5);
                } else {
                    camera.center.set(first.pos?.[0] ?? 0, first.pos?.[1] ?? 0);
                }
            } catch {
                camera.center.set(first.pos?.[0] ?? 0, first.pos?.[1] ?? 0);
            }
        }

        applyCamera();
    }

    // --- Per-frame: marker size cap and declutter ---
    function updateMarkerScales() {
        const z = camera.scale;

        for (const m of allMarkers) {
            const texW = m.star.texture.width || 32;

            const pxDesired = STAR_BASE_PX * z;
            const px = Math.min(pxDesired, STAR_MAX_PX);

            const visible = px >= STAR_HIDE_PX;
            m.star.visible = visible;

            const showLabel = z >= LABEL_SHOW_ZOOM;
            m.label.visible = showLabel;
            for (const ic of m.iconSprites) ic.visible = showLabel;

            // Keep star screen size capped:
            // screenPx = z * localScale * texW => localScale = screenPx / (z*texW)
            const localScale = px / (z * texW);
            m.star.scale.set(localScale);

            // Icons scale similarly, capped smaller
            for (const ic of m.iconSprites) {
                const iw = ic.texture.width || 16;
                const ipxDesired = 12 * z;
                const ipx = Math.min(ipxDesired, 14);
                const iscale = ipx / (z * iw);
                ic.scale.set(iscale);
            }

            // Label tries to remain readable-ish but fades out when zoomed out anyway
            if (showLabel) {
                const labelScale = 1 / Math.max(z, 0.001);
                m.label.scale.set(Math.min(labelScale, 2.0));
            }
        }
    }

    // --- Poll loop ---
    async function pollLoop() {
        try {
            const s = await loadState();
            const updated = s.updatedUtc || "__no_updatedUtc__";

            if (updated !== lastUpdatedUtc) {
                lastUpdatedUtc = updated;
                await rebuildWorld(s);
            }

            const delay = Math.max(5, s.pollSeconds ?? DEFAULT_POLL_SECONDS) * 1000;
            setTimeout(pollLoop, delay);
        } catch (err) {
            console.error(err);
            setTimeout(pollLoop, 6000);
        }
    }

    // --- Ticker ---
    app.ticker.add(() => {
        updateMarkerScales();
    });

    // --- init ---
    initParallax();
    applyCamera();
    pollLoop();

})();
