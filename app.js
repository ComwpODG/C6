(() => {
    const canvas = document.getElementById("mapCanvas");
    const mount = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });

    const galaxyNameEl = document.getElementById("galaxyName");
    const galaxyDescEl = document.getElementById("galaxyDesc");
    let activeGalaxyId = null;

    function updateActiveGalaxyLabel() {
        if (!galaxies || galaxies.length === 0 || !galaxies[0].img) return;

        // pick the galaxy whose TOP-LEFT is closest to camera center (world coords)
        let best = null;
        let bestD2 = Infinity;

        for (const g of galaxies) {
            // top-left "anchor" at g.x, g.y (as requested)
            const cx = g.x + (g.img.width * g.scale) * 0.5;
            const cy = g.y + (g.img.height * g.scale) * 0.5;

            const dx = cam.x - cx;
            const dy = cam.y - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = g;
            }
        }

        if (!best) return;
        if (best.id === activeGalaxyId) return; // no DOM churn

        activeGalaxyId = best.id;

        const nm = (best.name ?? best.id ?? "").toString();
        const ds = (best.desc ?? "").toString();

        galaxyNameEl.textContent = nm;
        galaxyDescEl.textContent = ds;
    }


    // Camera in world pixels
    const cam = {
        x: 0,
        y: 0,
        scale: 0.35,
        dragging: false,
        startMouseX: 0,
        startMouseY: 0,
        startCamX: 0,
        startCamY: 0
    };

    const ZOOM_MIN = 0.08;
    const ZOOM_MAX = 4.0;

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function resizeCanvas() {
        const rect = mount.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);

        // draw in CSS pixels
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }

    window.addEventListener("resize", resizeCanvas);

    const imageCache = new Map(); // src -> Promise<HTMLImageElement>
    function getImageCached(src) {
        if (!imageCache.has(src)) {
            imageCache.set(src, new Promise((resolve, reject) => {
                const img = new Image();
                img.src = src;
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(`Failed to load ${src} (check path + case)`));
            }));
        }
        return imageCache.get(src);
    }


    async function loadGalaxiesJson() {
        // cache-bust so updates show up quickly on GitHub Pages
        const res = await fetch(`data/galaxies.json?cb=${Date.now()}`);
        if (!res.ok) throw new Error(`Failed to fetch data/galaxies.json: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("data/galaxies.json must be a JSON array");
        return data;
    }

    //TODO: instead of one monolithic sectors.json, have individual files for each galaxy
    async function loadSectorsJson() {
        // cache-bust so updates show up quickly on GitHub Pages
        const res = await fetch(`data/sectors.json?cb=${Date.now()}`);
        if (!res.ok) throw new Error(`Failed to fetch data/sectors.json: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("data/sectors.json must be a JSON array");
        return data;
    }

    // --- Galaxies in world space (loaded from JSON) ---
    let galaxies = []; // each: {id, src, x, y, scale, img}
    // sectors also in world space
    let sectors = []; // each: {x, y, src, name, img}


    async function init() {
        try {
            const raw = await loadGalaxiesJson();
            const rawSectors = await loadSectorsJson(); //Load the sectors

            // Normalize + validate
            // g is the actual object, i is object ID in json array
            galaxies = raw.map((g, i) => {
                // if null after trim, ID becomes g1, g2 etc
                const id = (typeof g.id === "string" && g.id.trim()) ? g.id.trim() : `g${i + 1}`;
                const src = (typeof g.src === "string" && g.src.trim())
                    ? g.src.trim()
                    : (typeof g.image === "string" && g.image.trim())
                        ? g.image.trim()
                        : null;

                if (!src) {
                    throw new Error(`Galaxy entry ${i} is missing "src" (or "image")`);
                }

                const x = Number.isFinite(g.x) ? g.x : 0;
                const y = Number.isFinite(g.y) ? g.y : 0;
                const scale = Number.isFinite(g.scale) ? g.scale : 1.0;

                // this is shorthand notation
                // equivalent to saying id: id, src: src etc
                return { id, src, x, y, scale, name: g.name ?? "", desc: g.desc ?? "", img: null };
            });

            if (galaxies.length === 0) {
                throw new Error("data/galaxies.json contained 0 galaxies");
            }

            // Load all images
            // promise says that if ANY load fails, nothing gets saved
            const images = await Promise.all(galaxies.map(g => getImageCached(g.src)));
            for (let i = 0; i < galaxies.length; i++) {
                galaxies[i].img = images[i];
            }

            //Do the same for sectors
            // Normalize sectors
            sectors = rawSectors.map((s, i) => {
                const x = Number.isFinite(s.x) ? s.x : 0;
                const y = Number.isFinite(s.y) ? s.y : 0;
                const src = (typeof s.src === "string" && s.src.trim()) ? s.src.trim() : null;
                const name = (s.name ?? `Sector ${i + 1}`).toString();

                if (!src) throw new Error(`Sector entry ${i} missing "src"`);

                return { x, y, src, name, img: null };
            });

            // Preload star images ONCE per unique src, then assign to every sector
            const uniqueStarSrcs = [...new Set(sectors.map(s => s.src))];
            const starImgs = await Promise.all(uniqueStarSrcs.map(src => getImageCached(src)));
            const starImgBySrc = new Map(uniqueStarSrcs.map((src, idx) => [src, starImgs[idx]]));

            for (const s of sectors) {
                s.img = starImgBySrc.get(s.src);
            }




            // Start camera centered on the first galaxy in the JSON
            const g1 = galaxies[0];
            cam.x = g1.img.width * 0.5 * g1.scale + g1.x;
            cam.y = g1.img.height * 0.5 * g1.scale + g1.y;

            draw();

            // this always runs at the end of draw();
            //updateActiveGalaxyLabel();

        } catch (err) {
            console.error(err);
            // draw a friendly message on the canvas too
            const rect = canvas.getBoundingClientRect();
            ctx.clearRect(0, 0, rect.width, rect.height);
            ctx.fillStyle = "rgba(207,231,255,0.85)";
            ctx.fillText("Failed to load galaxies.json or images. Check console.", 20, 30);
        }
    }

    function screenToWorld(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const vw = rect.width;
        const vh = rect.height;

        const wx = (x - vw * 0.5) / cam.scale + cam.x;
        const wy = (y - vh * 0.5) / cam.scale + cam.y;
        return { x: wx, y: wy };
    }

    // Star visibility + sizing rules
    const STAR_SHOW_ZOOM = 0.25;   // below this, stars don't render at all
    const STAR_MAX_AT_ZOOM = 1.3; // reaches max size at 2x zoom
    const STAR_MIN_PX_AT_1X = 4;  // "tiny" at 1x (tune: 2..6)
    const STAR_MAX_PX = 32;       // cap size once you hit 2x (and above)

    // Culling padding (in screen px -> converted to world units)
    const STAR_CULL_PAD_PX = 120;


    function draw() {
        const rect = canvas.getBoundingClientRect();
        const vw = rect.width;
        const vh = rect.height;

        ctx.clearRect(0, 0, vw, vh);

        // If images not ready yet
        if (galaxies.length === 0 || !galaxies[0].img) {
            ctx.fillStyle = "rgba(207,231,255,0.5)";
            ctx.fillText("Loading galaxies...", 20, 30);
            return;
        }

        // Camera transform
        ctx.save();
        ctx.translate(vw * 0.5, vh * 0.5);
        ctx.scale(cam.scale, cam.scale);
        ctx.translate(-cam.x, -cam.y);

        // Draw galaxies (in world space)
        for (const g of galaxies) {
            if (!g.img) continue;
            const w = g.img.width * g.scale;
            const h = g.img.height * g.scale;
            ctx.drawImage(g.img, g.x, g.y, w, h);
        }

        // Draw sectors/stars (world space)
        // Draw sectors/stars with culling and size rules
        if (cam.scale >= STAR_SHOW_ZOOM) {
            // Visible world rect derived from camera + viewport
            const halfW_world = (vw * 0.5) / cam.scale;
            const halfH_world = (vh * 0.5) / cam.scale;

            // Add padding so stars don't pop in at the exact edge
            const pad_world = STAR_CULL_PAD_PX / cam.scale;

            const minX = cam.x - halfW_world - pad_world;
            const maxX = cam.x + halfW_world + pad_world;
            const minY = cam.y - halfH_world - pad_world;
            const maxY = cam.y + halfH_world + pad_world;

            // deprecated feature, replaced with fading in and out
            // Ramp star size from tiny@1x to max@2x
            //const t = Math.max(0, Math.min(1, (cam.scale - STAR_SHOW_ZOOM) / (STAR_MAX_AT_ZOOM - STAR_SHOW_ZOOM)));
            //const desiredPx = STAR_MIN_PX_AT_1X + t * (STAR_MAX_PX - STAR_MIN_PX_AT_1X);

            // Convert desired screen pixels to world units so it stays visually capped
            //const worldH = desiredPx / cam.scale;

            for (const s of sectors) {
                if (!s.img) continue;

                // Cull first (cheap)
                if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) continue;

                // Maintain aspect ratio
                //const aspect = s.img.width / Math.max(1, s.img.height);
                //const worldW = worldH * aspect;

                // TODO: dynamically adjust size based on canvas size (?) or at least find better values
                ctx.drawImage(s.img, s.x - worldW * 0.5, s.y - worldH * 0.5, 50, 50);
            }
        }


        ctx.restore();
        updateActiveGalaxyLabel();

    }

    // Pan: pointer drag
    canvas.addEventListener("pointerdown", (e) => {
        cam.dragging = true;
        cam.startMouseX = e.clientX;
        cam.startMouseY = e.clientY;
        cam.startCamX = cam.x;
        cam.startCamY = cam.y;
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener("pointermove", (e) => {
        if (!cam.dragging) return;
        const dx = (e.clientX - cam.startMouseX) / cam.scale;
        const dy = (e.clientY - cam.startMouseY) / cam.scale;
        cam.x = cam.startCamX - dx;
        cam.y = cam.startCamY - dy;
        draw();
    });

    canvas.addEventListener("pointerup", () => {
        cam.dragging = false;
    });

    // Zoom: mouse wheel anchored at mouse position
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();

        const before = screenToWorld(e.clientX, e.clientY);

        const zoomFactor = Math.pow(1.0017, -e.deltaY);
        cam.scale = clamp(cam.scale * zoomFactor, ZOOM_MIN, ZOOM_MAX);

        const after = screenToWorld(e.clientX, e.clientY);

        cam.x += (before.x - after.x);
        cam.y += (before.y - after.y);

        draw();
    }, { passive: false });

    // Kick off
    resizeCanvas();
    init();
})();
