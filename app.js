(() => {
    const mapCanvas = document.getElementById("mapCanvas");
    const mapCtx = mapCanvas.getContext("2d", { alpha: true });

    const overlayCanvas = document.getElementById("overlayCanvas");
    const overlayCtx = overlayCanvas.getContext("2d", { alpha: true });

    const galaxyNameEl = document.getElementById("galaxyName");
    const galaxyDescEl = document.getElementById("galaxyDesc");
    let activeGalaxyId = null;

    // Camera in world pixels
    const cam = {
        x: 0,
        y: 0,
        scale: 0.22,
        dragging: false,
        startMouseX: 0,
        startMouseY: 0,
        startCamX: 0,
        startCamY: 0
    };

    const ZOOM_MIN = 0.08;
    const ZOOM_MAX = 4.0;


    // --- Galaxies in world space (loaded from JSON) ---
    let galaxies = []; // each: {id, src, x, y, scale, img}
    // sectors also in world space
    let sectors = []; // each: {x, y, src, name, img}
    // galactic sectors in world space
    let galacticSectors = []; // each {name, vertices:{x1, y1}, ...]}


    let factionMap = new Map();

    factionMap.set("PC",         "#FFD800");
    factionMap.set("AZ",         "#636363");
    factionMap.set("VT",         "#39dbcb");
    factionMap.set("ENI",        "#8F93FF");
    factionMap.set("BIO",        "#00FF00");
    factionMap.set("FED",        "#00FFFF");
    factionMap.set("KGC",        "#FF0000");
    factionMap.set("WVP",        "#FF00DC");
    factionMap.set("M.E.W.A.O.", "#A80000");
    factionMap.set("PTMC",       "#FFC987");
    factionMap.set("BOTS",       "#E27900");
    factionMap.set("PHM",        "#BAD300");
    factionMap.set("SIGG",       "#9BFF70");
    factionMap.set("OSM",        "#7FC9FF");
    factionMap.set("LVN",        "#FFC600");


    async function init() {
        try {
            const raw = await loadGalaxiesJson();
            let rawSectors = []; //Load the sectors
            let rawGalacticSectors = [];

            // Normalize + validate
            // g is the actual object, i is object ID in json array
            galaxies = raw.map((g, i) => {
                // if null after trim, ID becomes g1, g2 etc
                const id = (typeof g.id === "string" && g.id.trim()) ? g.id.trim() : `g${i + 1}`;
                var src = (typeof g.src === "string" && g.src.trim())
                    ? g.src.trim()
                    : (typeof g.image === "string" && g.image.trim())
                        ? g.image.trim()
                        : null;

                if (!src) {
                    throw new Error(`Galaxy entry ${i} is missing "src" (or "image")`);
                }

                const sectorFile = (typeof g.sectors === "string" && g.sectors.trim()) ? g.sectors.trim() : null;
                if (!sectorFile) {
                    throw new Error(`Galaxy entry ${i} is missing "sectors"`);
                }

                const gsectorFile = (typeof g.galacticSectors === "string" && g.galacticSectors.trim()) ? g.galacticSectors.trim() : null;
                if (!gsectorFile) {
                    throw new Error(`Galaxy entry ${i} is missing "galacticSectors"`);
                }

                const x = Number.isFinite(g.x) ? g.x : 0;
                const y = Number.isFinite(g.y) ? g.y : 0;
                const scale = Number.isFinite(g.scale) ? g.scale : 1.0;

                // equivalent to saying id: id, src: src etc
                return { id, src, sectorFile, gsectorFile, x, y, scale, name: g.name ?? "", desc: g.desc ?? "", img: null };
            });

            if (galaxies.length === 0) {
                throw new Error("data/galaxies.json contained 0 galaxies");
            }

            // Load all images
            // promise.all says that if ANY load fails, nothing gets saved
            const images = await Promise.all(galaxies.map(g => getImageCached(g.src)));
            for (let i = 0; i < galaxies.length; i++) {
                galaxies[i].img = images[i];
            }

            // Start camera centered on the first galaxy in the JSON
            const g1 = galaxies[0];
            cam.x = g1.img.width * 0.5 * g1.scale + g1.x;
            cam.y = g1.img.height * 0.5 * g1.scale + g1.y;


            for (const g of galaxies){
                rawSectors = [...rawSectors, ...await loadSectorsJson(g.sectorFile)];
                rawGalacticSectors = [...rawGalacticSectors, ...await loadGalacticSectorsJson(g.gsectorFile)];
            }



            //Do the same for sectors
            sectors = rawSectors.map((s, i) => {
                const x = Number.isFinite(s.x) ? s.x / 2.5 : 0;
                const y = Number.isFinite(s.y) ? s.y / 2.5 : 0;
                const src = (typeof s.src === "string" && s.src.trim()) ? s.src.trim() : null;
                const fedName = (s.name ?? `Sector ${i + 1}`).toString();

                //prioritize properName
                const name = (typeof s.properName === "string" && s.properName.trim()) ? s.properName.trim() : null;
                const faction = (typeof s.faction === "string" && s.faction.trim()) ? s.faction.trim() : null;

                if (!src) throw new Error(`Sector entry ${i} missing "src"`);

                return { x, y, src, name, fedName, faction, img: null };
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


            await loadFonts();
            overlayCtx.imageSmoothingEnabled = false;


            before = {x: cam.x, y: cam.y};
            const rect = mapCanvas.getBoundingClientRect();
            mouseRaw = {x: rect.width / 3, y: rect.height / 3};

            draw();

            requestAnimationFrame(animationLoop);
            requestAnimationFrame(mouseLoop);

        } catch (err) {
            console.error(err);

            // draw a friendly message on the mapCanvas too
            const rect = mapCanvas.getBoundingClientRect();
            mapCtx.clearRect(0, 0, rect.width, rect.height);
            mapCtx.fillStyle = "rgba(207,231,255,0.85)";
            mapCtx.fillText("Failed to load galaxies.json or images. Check console.", 20, 30);
        }
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
    async function loadSectorsJson(src) {
        // cache-bust so updates show up quickly on GitHub Pages
        //const res = await fetch(`data/sectors.json?cb=${Date.now()}`);
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Failed to fetch ${src}: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("data/sectors.json must be a JSON array");
        return data;
    }

    async function loadGalacticSectorsJson(src) {
        // cache-bust so updates show up quickly on GitHub Pages
        //const res = await fetch(`data/sectors.json?cb=${Date.now()}`);
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Failed to fetch ${src}: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("data/galacticSectors.json must be a JSON array");
        return data;
    }


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



    // Star visibility + sizing rules
    const STAR_SHOW_ZOOM = 0.22;   // below this, stars don't render at all
    const STAR_MAX_AT_ZOOM = 0.4; // reaches max opacity at 2x zoom

    const TEXT_SHOW_ZOOM = 0.5;   // below this, stars don't render at all
    const TEXT_MAX_AT_ZOOM = 0.8; // reaches max opacity at 2x zoom



    // Culling padding (in screen px -> converted to world units)
    const STAR_CULL_PAD_PX = 120;

    const STAR_SIZE = 50;
    let starScale = STAR_SIZE;

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


        starScale = STAR_SIZE / cam.scale;

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

            // 0.0 fully transparent, 1.0 fully opaque
            var starFadeAmt = (cam.scale - STAR_SHOW_ZOOM) / (STAR_MAX_AT_ZOOM - STAR_SHOW_ZOOM);
            var textFadeAmt = clamp((cam.scale - TEXT_SHOW_ZOOM) / (TEXT_MAX_AT_ZOOM - TEXT_SHOW_ZOOM), 0, 1);

            overlayCtx.font = `${starScale / 3}px C6-font`;
            overlayCtx.fillStyle = "#FFFFFF";
            overlayCtx.textAlign = "center";
            overlayCtx.textBaseline = "middle";

            for (const s of sectors) {
                if (!s.img) continue;

                // Cull first (cheap)
                if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) continue;

                overlayCtx.globalAlpha = starFadeAmt <= 1 ? starFadeAmt : 1;
                overlayCtx.drawImage(
                    s.img,
                    s.x - (starScale / 2), // Center on x
                    s.y - (starScale / 2), // Center on y
                    starScale,
                    starScale
                    );

                overlayCtx.globalAlpha = textFadeAmt <= 1 ? textFadeAmt : 1;
                overlayCtx.fillText(
                    s.name ?? s.fedName,
                    s.x,
                    s.y - (starScale / 2) + (starScale / 5 + starScale)
                );
            }

            overlayCtx.globalAlpha = 1.0; // reset it after, important

            // only draw info panel when the stars are also visible
            drawInfoPanel();
        }

        mapCtx.restore();
        overlayCtx.restore();
        updateActiveGalaxyLabel();

    }


    let activeStar = null;
    function drawInfoPanel(){
        if(activeStar){
            const colour = activeStar.faction ? factionMap.get(activeStar.faction) : "#FFFFFF";
            overlayCtx.fillStyle = "#000000";
            overlayCtx.strokeStyle = colour;
            overlayCtx.lineWidth = 5 / cam.scale;

            const textHeight = starScale / 3;
            overlayCtx.textAlign = "start";
            overlayCtx.textBaseline = "top";

            const bottomLeftX = activeStar.x - (250 / cam.scale) + (overlayCtx.lineWidth * 1.8);
            var bottomLeftY = activeStar.y - starScale - (30 / cam.scale);


            var rectHeight = 2 * overlayCtx.lineWidth; // baseline
            var topOffset = overlayCtx.lineWidth * 1.8;

            rectHeight += 2 * textHeight + (40 / cam.scale) + overlayCtx.lineWidth; // fed name and faction

            if(activeStar.name){
                rectHeight += (starScale / 2);
                topOffset += (starScale / 2);
            }

            // this is where we wound add notes;
            //
            //

            const topLeft = bottomLeftY - rectHeight;

            // draw background
            overlayCtx.fillRect(bottomLeftX - (overlayCtx.lineWidth * 1.8), topLeft, 500 / cam.scale, rectHeight);
            overlayCtx.strokeRect(bottomLeftX - (overlayCtx.lineWidth * 1.8), topLeft, 500 / cam.scale, rectHeight);

            // draw title
            if(activeStar.name){
                overlayCtx.fillStyle = colour;
                overlayCtx.font = `${starScale / 2}px C6-font`;
                overlayCtx.fillText(activeStar.name, bottomLeftX, topLeft + (10 / cam.scale), 500 / cam.scale);
            }

            overlayCtx.font = `${textHeight}px C6-font`;

            overlayCtx.fillStyle = "#666666";
            overlayCtx.fillText(activeStar.fedName, bottomLeftX, topLeft + topOffset + (7/cam.scale), 500 / cam.scale);
            topOffset += textHeight + (20 / cam.scale);

            overlayCtx.beginPath();
            overlayCtx.moveTo(bottomLeftX + (50 / cam.scale), topLeft + topOffset);
            overlayCtx.lineTo(bottomLeftX + (450 / cam.scale), topLeft + topOffset);
            overlayCtx.stroke();
            topOffset += (20 / cam.scale) + overlayCtx.lineWidth;

            overlayCtx.fillStyle = colour;
            overlayCtx.textAlign = "center";
            overlayCtx.textBaseline = "middle";
            var factionText = activeStar.faction ? activeStar.faction + "-Controlled Territory" : "Uncontested Territory"
            overlayCtx.fillText(factionText, activeStar.x, topLeft + topOffset, 500 / cam.scale);
            topOffset += textHeight;
        }
    }



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



    function checkClickedStar(a){
        for(const s of sectors){
            var starX = s.x ;
            var starY = s.y ;
            var dist = ((starX - a.x) * (starX - a.x)) + ((starY - a.y) * (starY - a.y))

            //console.log(dist, " <- ", starScale * starScale);
            
            if(dist <= starScale * starScale)
                return s;
        }
        return null;
    }

    async function loadFonts() {
        const font = new FontFace("C6-font", "url(assets/20_Arial_12pt_st.ttf)", {
            style: "normal",
            weight: "400",
            stretch: "condensed",
        });
        // wait for font to be loaded
        await font.load();
        // add font to document
        document.fonts.add(font);
        // enable font with CSS class
        document.body.classList.add("fonts-loaded");
    }



    //for when the window is resized
    window.addEventListener("resize", resizeCanvas);

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


    // Pan: pointer drag
    let LClickTime = null;
    mapCanvas.addEventListener("pointerdown", (e) => {
        LClickTime = Date.now();
        
        cam.startMouseX = e.clientX;
        cam.startMouseY = e.clientY;
        cam.startCamX = cam.x;
        cam.startCamY = cam.y;
        mapCanvas.setPointerCapture(e.pointerId);
    });

    mapCanvas.addEventListener("pointermove", (e) => {
        if(LClickTime && !cam.dragging) cam.dragging = true;
        if (!cam.dragging) return;
        const dx = (e.clientX - cam.startMouseX) / cam.scale;
        const dy = (e.clientY - cam.startMouseY) / cam.scale;
        cam.x = cam.startCamX - dx;
        cam.y = cam.startCamY - dy;
        draw();
    });

    mapCanvas.addEventListener("pointerup", (e) => {
        if(Date.now() - LClickTime < 200 && cam.dragging === false){ //200ms threshold for click
            //console.log("click at:", e.clientX, " ", e.clientY);
            activeStar = checkClickedStar(screenToWorld(e.clientX, e.clientY));
            draw();
            if(activeStar){
                console.warn(activeStar);
            }
            else{
                //var a = checkSectorVertex(screenToWorld(e.clientX, e.clientY));
                //if(a === null){
                //    galacticSectors.push({name: "newSector", vertices: tempSector});
                //    for (const v of tempSector) {
                //        console.log("{\"x\":",v.x, ", \"y\":", v.y,"},");
                //    }
                //    tempSector = [];
                //    draw();
                //}
                //else tempSector.push(a);
            }
        }
        cam.dragging = false;
        LClickTime = null;  
    });


    let tempSector = [];
    function checkSectorVertex(mousePos){
        var coords = {x: mousePos.x * 2.5, y: mousePos.y * 2.5};

        if(tempSector.length != 0){
            var dist = ((tempSector[0].x - coords.x) * (tempSector[0].x - coords.x)) + ((tempSector[0].y - coords.y) * (tempSector[0].y - coords.y));
            if(dist <= 1000000) return null;
        }

        for(const s of galacticSectors)
        {
            for (const v of s.vertices){
                var dist = ((v.x - coords.x) * (v.x - coords.x)) + ((v.y - coords.y) * (v.y - coords.y));
                if(dist <= 1000000)
                    return v;
            }
        }

        if(tempSector.length == 0) return coords;

        return coords;
    }



    function mouseLoop(){
        if(LClickTime && cam.dragging === false)
        {
            if(Date.now() - LClickTime > 1000) //1s threshold for hold
            {
                //console.log("Holding!");
            }
        }

        requestAnimationFrame(mouseLoop);
    }

    // Zoom: mouse wheel anchored at mouse position
    let targetZoom = 0.15;
    let before = null;
    let mouseRaw = null;
    function animationLoop() {
        if(before){
            if(Math.abs(targetZoom - cam.scale) > 0.001){
                cam.scale += (targetZoom - cam.scale) * 0.1;
                const after = screenToWorld(mouseRaw.x, mouseRaw.y);

                cam.x += (before.x - after.x);
                cam.y += (before.y - after.y);

                draw();
            }
            else{
                cam.scale = targetZoom;
                const after = screenToWorld(mouseRaw.x, mouseRaw.y);

                cam.x += (before.x - after.x);
                cam.y += (before.y - after.y);

                before = null;
                draw();
            }
        }

        requestAnimationFrame(animationLoop);
    }

    mapCanvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        targetZoom *= Math.pow(1.0017, -e.deltaY);;
        targetZoom = clamp(targetZoom, ZOOM_MIN, ZOOM_MAX);

        //console.log(targetZoom, " -> ", targetZoom - cam.scale);

        before = screenToWorld(e.clientX, e.clientY);
        mouseRaw = {x: e.clientX, y:e.clientY};
    }, { passive: false });





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

    // b is up, a is down
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    // Kick off
    resizeCanvas();
    init();
})();

