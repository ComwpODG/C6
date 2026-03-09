(() => {
    const mapCanvas = document.getElementById("mapCanvas");
    const mapCtx = mapCanvas.getContext("2d", { alpha: true });

    const overlayCanvas = document.getElementById("overlayCanvas");
    const overlayCtx = overlayCanvas.getContext("2d", { alpha: true });

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
        scale: 0.2,
        dragging: false,
        startMouseX: 0,
        startMouseY: 0,
        startCamX: 0,
        startCamY: 0
    };

    const ZOOM_MIN = 0.08;
    const ZOOM_MAX = 4.0;

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    //for when the window is resized
    function resizeCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        const mapRect = mapCanvas.getBoundingClientRect();
        mapCanvas.width = Math.floor(mapRect.width * dpr);
        mapCanvas.height = Math.floor(mapRect.height * dpr);

        const overlayRect = overlayCanvas.getBoundingClientRect();
        overlayCanvas.width = Math.floor(overlayRect.width * dpr);
        overlayCanvas.height = Math.floor(overlayRect.height * dpr);

        // draw in CSS pixels
        mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
        //const res = await fetch(`data/galaxies.json?cb=${Date.now()}`);
        const res = await fetch(`data/galaxies.json`);
        if (!res.ok) throw new Error(`Failed to fetch data/galaxies.json: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("data/galaxies.json must be a JSON array");
        return data;
    }

    //TODO: instead of one monolithic sectors.json, have individual files for each galaxy
    async function loadSectorsJson() {
        // cache-bust so updates show up quickly on GitHub Pages
        //const res = await fetch(`data/sectors.json?cb=${Date.now()}`);
        const res = await fetch(`data/sectors.json`);
        if (!res.ok) throw new Error(`Failed to fetch data/sectors.json: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data["sectors"])) throw new Error("section 'sectors' of data/sectors.json must be a JSON array");
        return data["sectors"];
    }

    async function loadGalacticSectorsJson() {
        // cache-bust so updates show up quickly on GitHub Pages
        //const res = await fetch(`data/sectors.json?cb=${Date.now()}`);
        const res = await fetch(`data/sectors.json`);
        if (!res.ok) throw new Error(`Failed to fetch data/sectors.json: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data["galacticSectors"])) throw new Error("section 'galacticSectors' of data/sectors.json must be a JSON array");
        return data["galacticSectors"];
    }

    // --- Galaxies in world space (loaded from JSON) ---
    let galaxies = []; // each: {id, src, x, y, scale, img}
    // sectors also in world space
    let sectors = []; // each: {x, y, src, name, img}
    // galactic sectors in world space
    let galacticSectors = []; // each {name, vertices[x1, y1 ...]}


    async function init() {
        try {
            const raw = await loadGalaxiesJson();
            const rawSectors = await loadSectorsJson(); //Load the sectors
            const rawGalacticSectors = await loadGalacticSectorsJson();

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
                const x = Number.isFinite(s.x) ? s.x / 2.5 : 0;
                const y = Number.isFinite(s.y) ? s.y / 2.5 : 0;
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


            // Load galactic sectors
            galacticSectors = rawGalacticSectors.map((s, i) => {
                const name = (s.name ?? `Sector ${i + 1}`).toString();
                let vertices = s.vertices;

                return {name, vertices};
            });



            // Start camera centered on the first galaxy in the JSON
            const g1 = galaxies[0];
            cam.x = g1.img.width * 0.5 * g1.scale + g1.x;
            cam.y = g1.img.height * 0.5 * g1.scale + g1.y;

            draw();

            // this always runs at the end of draw();
            //updateActiveGalaxyLabel();

        } catch (err) {
            console.error(err);
            // draw a friendly message on the mapCanvas too
            const rect = mapCanvas.getBoundingClientRect();
            mapCtx.clearRect(0, 0, rect.width, rect.height);
            mapCtx.fillStyle = "rgba(207,231,255,0.85)";
            mapCtx.fillText("Failed to load galaxies.json or images. Check console.", 20, 30);
        }
    }

    function screenToWorld(clientX, clientY) {
        const rect = mapCanvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const vw = rect.width;
        const vh = rect.height;

        const wx = (x - vw * 0.5) / cam.scale + cam.x;
        const wy = (y - vh * 0.5) / cam.scale + cam.y;
        return { x: wx, y: wy };
    }

    // TODO: fix such that it accepts slant
    function worldToScreen(x, y) {
        var xP = x;
        var yP = y * Math.cos(28 * Math.PI / 180); // z is 0
        var zP = y * Math.sin(28 * Math.PI / 180); // z is 0

        //mapCanvas.
        // TODO: make both angle and distance dynamic
        // 1400 is perspective(1400px)
        return {x: xP / (1 - (zP/1400)), y: yP / (1 - (zP/1400))};
    }

    // Star visibility + sizing rules
    const STAR_SHOW_ZOOM = 0.2;   // below this, stars don't render at all
    const STAR_MAX_AT_ZOOM = 0.4; // reaches max opacity at 2x zoom
    const STAR_MIN_PX_AT_1X = 4;  // "tiny" at 1x (tune: 2..6)
    const STAR_MAX_PX = 32;       // cap size once you hit 2x (and above)

    // Culling padding (in screen px -> converted to world units)
    const STAR_CULL_PAD_PX = 120;


    function draw() {
        const rect = mapCanvas.getBoundingClientRect();
        const vw = rect.width;
        const vh = rect.height;

        mapCtx.clearRect(0, 0, vw, vh);

        // TODO: separate map from overlay
        overlayCtx.clearRect(0, 0, vw, vh);

        // If images not ready yet
        if (galaxies.length === 0 || !galaxies[0].img) {
            mapCtx.fillStyle = "rgba(207,231,255,0.5)";
            mapCtx.fillText("Loading galaxies...", 20, 30);
            return;
        }

        // Camera transform
        mapCtx.save();
        mapCtx.translate(vw * 0.5, vh * 0.5);
        mapCtx.scale(cam.scale, cam.scale);
        mapCtx.translate(-cam.x, -cam.y);

        overlayCtx.save();
        overlayCtx.translate(vw * 0.5, vh * 0.5);
        overlayCtx.scale(cam.scale, cam.scale);
        overlayCtx.translate(-cam.x, -cam.y);

        // Draw galaxies (in world space)
        for (const g of galaxies) {
            if (!g.img) continue;
            const w = g.img.width * g.scale;
            const h = g.img.height * g.scale;
            mapCtx.drawImage(g.img, g.x, g.y, w, h);
        }

        // Draw galacic sectors
        mapCtx.lineWidth = 100;
        mapCtx.globalAlpha = 0.5;
        mapCtx.strokeStyle = "#000000";

        for(const s of galacticSectors)
        {
            if(s.vertices.length < 2) continue;
            var lastPair = {x:null, y:null};
            for (const v of s.vertices){
                if(lastPair.x === null)
                    lastPair = {x:v.x, y:v.y};
                else
                {
                    mapCtx.beginPath();
                    mapCtx.moveTo(lastPair.x / 2.5, lastPair.y / 2.5);
                    mapCtx.lineTo(v.x / 2.5, v.y / 2.5);
                    mapCtx.stroke();

                    lastPair = {x:v.x, y:v.y};
                }
            }
            mapCtx.beginPath();
            mapCtx.moveTo(lastPair.x / 2.5, lastPair.y / 2.5);
            mapCtx.lineTo(s.vertices[0].x / 2.5, s.vertices[0].y / 2.5);
            mapCtx.stroke();
        }
        mapCtx.globalAlpha = 1.0;

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

            // 0.0 fully transparent, 1.0 fully opaque
            var fadeAmt = (cam.scale - STAR_SHOW_ZOOM) / (STAR_MAX_AT_ZOOM - STAR_SHOW_ZOOM);
            overlayCtx.globalAlpha = fadeAmt <= 1 ? fadeAmt : 1;
            //console.log(STAR_MAX_AT_ZOOM - cam.scale);

            for (const s of sectors) {
                if (!s.img) continue;

                // Cull first (cheap)
                if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) continue;

                // Maintain aspect ratio
                //const aspect = s.img.width / Math.max(1, s.img.height);
                
                // get screen coordinates from map coordinates
                //var pos = worldToScreen(s.x, s.y);

                // TODO: find better scaling factors, finish the scaler as per given specs
                //overlayCtx.drawImage(s.img, pos.x - cam.scale, pos.y - (cam.scale * aspect), 50, 50);
                overlayCtx.drawImage(s.img, s.x + cam.scale - (s.img.width / 2 / cam.scale), s.y + cam.scale - (s.img.height / 2 / cam.scale), 50 / cam.scale, 50 / cam.scale);
            }

            overlayCtx.globalAlpha = 1.0; // reset it after, important
        }


        mapCtx.restore();
        overlayCtx.restore();
        updateActiveGalaxyLabel();

    }

    // TODO: see if I need these on the other canvas as well
    // Pan: pointer drag
    mapCanvas.addEventListener("pointerdown", (e) => {
        cam.dragging = true;
        cam.startMouseX = e.clientX;
        cam.startMouseY = e.clientY;
        cam.startCamX = cam.x;
        cam.startCamY = cam.y;
        mapCanvas.setPointerCapture(e.pointerId);
    });

    mapCanvas.addEventListener("pointermove", (e) => {
        if (!cam.dragging) return;
        const dx = (e.clientX - cam.startMouseX) / cam.scale;
        const dy = (e.clientY - cam.startMouseY) / cam.scale;
        cam.x = cam.startCamX - dx;
        cam.y = cam.startCamY - dy;
        draw();
    });

    mapCanvas.addEventListener("pointerup", () => {
        cam.dragging = false;
    });

    // Zoom: mouse wheel anchored at mouse position
    mapCanvas.addEventListener("wheel", (e) => {
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
