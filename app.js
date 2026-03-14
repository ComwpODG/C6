(() => {
    const mapCanvas = document.getElementById("mapCanvas");
    const mapCtx = mapCanvas.getContext("2d", { alpha: true });

    const overlayCanvas = document.getElementById("overlayCanvas");
    const overlayCtx = overlayCanvas.getContext("2d", { alpha: true });

    const newsCanvas = document.getElementById("newsCanvas");
    const newsCtx = newsCanvas.getContext("2d", { alpha: true });

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

    const ZOOM_MIN = 0.04;
    const ZOOM_MAX = 4.0;


    // --- Galaxies in world space (loaded from JSON) ---
    let galaxies = []; // each: {id, src, x, y, scale, img}
    // sectors also in world space
    const sectors = new Map(); // each: {x, y, src, name, img}
    // galactic sectors in world space
    let galacticSectors = []; // each {name, vertices:{x1, y1}, ...]}

    let lanes = [];  //each: {{x1, y1, x2, y2}, ...}



    let showTokenTray = false;
    let hamburgerButton;
    let tokenList = [];
    let tokens = [];

    let trayImage;


    const factionMap = new Map();

    factionMap.set("PC",         "#FFD800");
    factionMap.set("AZ",         "#636363");
    factionMap.set("VT",         "#05D7AE");
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

    const factionFrames = new Map();


    //progression flags:
    let hideWVP = true;
    let hideMEWAO = true;
    let hideVeils = true;
    let hideWave = true;


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
            rawSectors.forEach((s, i) => {
                const x = Number.isFinite(s.x) ? s.x / 2.5 : 0;
                const y = Number.isFinite(s.y) ? s.y / 2.5 : 0;
                const src = (typeof s.src === "string" && s.src.trim()) ? s.src.trim() : null;
                const fedName = (s.name ?? `Sector ${i + 1}`).toString();

                //prioritize properName
                const name = (typeof s.properName === "string" && s.properName.trim()) ? s.properName.trim() : null;
                const faction = (typeof s.faction === "string" && s.faction.trim()) ? s.faction.trim() : null;

                if (!src) throw new Error(`Sector entry ${i} missing "src"`);

                sectors.set(getStarFedHash(fedName), { x, y, src, name, fedName, faction, img: null});
            });

            // Preload star images ONCE per unique src, then assign to every sector
            const uniqueStarSrcs = [...new Set([...sectors.values()].map((s, key) => s.src))];
            const starImgs = await Promise.all(uniqueStarSrcs.map(src => getImageCached(src)));
            const starImgBySrc = new Map(uniqueStarSrcs.map((src, idx) => [src, starImgs[idx]]));

            sectors.forEach((s, key) => {
                s.img = starImgBySrc.get(s.src);
            });
            diamondFrame = await getImageCached("assets/stars/star frame.bmp");



            // Load galactic sectors
            galacticSectors = rawGalacticSectors.map((s, i) => {
                const name = (s.name ?? `Sector ${i + 1}`).toString();
                let vertices = s.vertices;

                return {name, vertices};
            });


            // pre-render coloured diamonds for performance reasons
            for (const [faction, colour] of factionMap) {
                const off = document.createElement('canvas');
                off.width = diamondFrame.width;
                off.height = diamondFrame.height;
                const offCtx = off.getContext('2d');

                offCtx.drawImage(diamondFrame, 0, 0);
                offCtx.globalCompositeOperation = "source-atop";
                offCtx.fillStyle = colour;
                offCtx.fillRect(0, 0, off.width, off.height);
                offCtx.globalCompositeOperation = "source-over";

                factionFrames.set(faction, off);
            }



            lanes = await loadLanesJson("data/lanes.json");


            hamburgerButton = await getImageCached("assets/icons/hamburger.png");
            trayImage = await getImageCached("assets/icons/tray.png");
            await loadFonts();

            //await getNewsFeed();
            newsCtx.font = `${NEWS_FEED_SIZE}px C6-font`;
            newsCtx.textBaseline = "top";


            // THE FINAL STEP: throw everything away
            await loadPlayerOverrides("Kaelin");


            // little intro animation
            before = {x: cam.x, y: cam.y};
            const rect = mapCanvas.getBoundingClientRect();
            mouseRaw = {x: rect.width / 3, y: rect.height / 3};

            azapallAnomaly = sectors.get(2466);
            draw();

            requestAnimationFrame(animationLoop);

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

    async function loadLanesJson(src) {
        // cache-bust so updates show up quickly on GitHub Pages
        //const res = await fetch(`data/sectors.json?cb=${Date.now()}`);
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Failed to fetch ${src}: HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("data/lanes.json must be a JSON array");
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


    // TODO: rewrite this function to do the same thing but fetch from sheet
    async function loadPlayerOverrides(player){
        //for now, player is source file. This function doesn't return, though
        const res = await fetch("data/playerData.json");
        if (!res.ok) throw new Error(`Failed to fetch data/playerData.json: HTTP ${res.status}`);
        const temp = await res.json();
        const data = temp[player];

        newsContainer = data["newsFeed"];

        for(const s of data["sectorOverrides"]){
            var sector = sectors.get(getStarFedHash(s.name));

            sector.name = s.properName ? (s.properName === "" ? null : s.properName) : sector.name;
            sector.src = s.src ? (s.src === "" ? null : s.src) : sector.src;
            sector.faction = s.faction ? (s.faction === "" ? null : s.faction) : sector.faction;

            if(s.notes){
                sector.notes = s.notes;
                for(const note of sector.notes){
                    if(note.src){
                        note.img = await getImageCached(note.src);
                    }
                }
            }
            sectors.set(getStarFedHash(s.name), sector);
        }

        // TODO: add an info panel for tokens that shows name, desc and sprite
        // can be formatted like a note from the main panel
        tokenList = data.icons.map((t, i) => {
            return{name: t["name"], desc: t["desc"], x: 10 + (500 * i), y: 0, src: t["src"], color: t["color"], img: null, id:null};
        });
        for(const t of tokenList){
            t.img = await getImageCached(t.src);
        }

        hideMEWAO   = data["flags"].hideMEWAO ?? hideMEWAO;
        hideVeils   = data["flags"].hideVeils ?? hideVeils;
        hideWVP     = data["flags"].hideWVP ?? hideWVP;
        hideWave    = data["flags"].hideWave ?? hideWave;
    }

    let diamondFrame = null;



    const NEWS_FEED_SIZE = 20;

    let newsContainer = null;
    let newsFeedIndex = 0;
    let newsText = "";
    let newsOffset = 0;

    function handleNewsFeed(dt){
        if(newsContainer){
            newsCtx.textAlign = "left";
            newsCtx.font = `${NEWS_FEED_SIZE}px C6-font`;
            const width = mapCanvas.getBoundingClientRect().width;
            while(newsCtx.measureText(newsText).width < width + 20){
                if(newsFeedIndex == newsContainer.length) newsFeedIndex = 0;
                newsText += ' '.repeat(40);
                newsText += newsContainer[newsFeedIndex].text;
                newsFeedIndex++;
            }

            
            const firstCharWidth = newsCtx.measureText(newsText[0]).width;
            if(newsOffset > firstCharWidth){
                newsText = newsText.slice(1);
                newsOffset -= firstCharWidth;
            }

            newsOffset += (dt / 1000.0) > 10 ? 0 : 50 * (dt / 1000.0);

            const newsRect = newsCanvas.getBoundingClientRect();
            newsCtx.fillStyle = "#000000";
            newsCtx.fillRect(0, newsRect.height - NEWS_FEED_SIZE - (2 * 5), newsRect.width, NEWS_FEED_SIZE + (2 * 5));
            newsCtx.fillStyle = "#CFE7FF";
            newsCtx.fillText(newsText, 5 - newsOffset, newsRect.height - NEWS_FEED_SIZE - 5)
        }
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


    const ANOMALY_RADIUS = 4000;
    let azapallAnomaly = null;

    function draw() {
        const rect = mapCanvas.getBoundingClientRect();
        const vw = rect.width;
        const vh = rect.height;

        mapCtx.clearRect(0, 0, vw, vh);
        overlayCtx.clearRect(0, 0, vw, vh);
        newsCtx.clearRect(0, 0, newsCanvas.getBoundingClientRect().width, newsCanvas.getBoundingClientRect().height);

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
            if (g.name === "Veils" && hideVeils) continue;
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
            mapCtx.lineWidth = 2;
            mapCtx.globalAlpha = 0.5;
            mapCtx.strokeStyle = "#FFFFFF";
            for(const l of lanes){
                var star1 = getStarFedHash(l.star1);
                var coords1 = {x:sectors.get(star1).x, y:sectors.get(star1).y};
                var star2 = getStarFedHash(l.star2);
                var coords2 = {x:sectors.get(star2).x, y:sectors.get(star2).y};
                mapCtx.beginPath();
                mapCtx.moveTo(coords1.x, coords1.y);
                mapCtx.lineTo(coords2.x, coords2.y);
                mapCtx.stroke();
            }

            mapCtx.globalAlpha = 1.0;


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

            sectors.forEach( (s, key) => {
                if (!s.img) return;

                // Cull first (cheap)
                if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) return;

                overlayCtx.globalAlpha = starFadeAmt <= 1 ? starFadeAmt : 1;
                overlayCtx.drawImage(
                    s.img,
                    s.x - (starScale / 2), // Center on x
                    s.y - (starScale / 2), // Center on y
                    starScale,
                    starScale
                    );

                if(s.faction && factionFrames.has(s.faction))
                {
                    if(s.faction === "WVP" && hideWVP);
                    else if(s.faction === "M.E.W.A.O." && hideMEWAO);
                    else overlayCtx.drawImage(factionFrames.get(s.faction), s.x - (starScale / 2), s.y - (starScale / 2), starScale, starScale);
                }


                overlayCtx.globalAlpha = textFadeAmt <= 1 ? textFadeAmt : 1;
                overlayCtx.fillText(
                    s.name ?? s.fedName,
                    s.x,
                    s.y - (starScale / 2) + (starScale / 5 + starScale)
                );
            });

            overlayCtx.globalAlpha = 1.0; // reset it after, important

            // only draw info panel when the stars are also visible
        }
        drawInfoPanel();

        
        for(const t of tokens){
            overlayCtx.drawImage(
                t.img,
                t.x - ((40 / cam.scale) / 2), // Center on x
                t.y - ((40 / cam.scale) / 2), // Center on y
                (40 / cam.scale),
                (40 / cam.scale)
                );
        }

        if(trinket){
            overlayCtx.drawImage(
                trinket.img,
                trinket.x - ((40 / cam.scale) / 2), // Center on x
                trinket.y - ((40 / cam.scale) / 2), // Center on y
                (40 / cam.scale),
                (40 / cam.scale)
            );
        }


        if(!hideWave){
        //else if (cam.scale <= ANOMALY_SHOW_BEFORE) {
            //if(azapallAnomaly){
                //overlayCtx.fillStyle = "#ff000055";
                overlayCtx.strokeStyle = "#ff0000";
                overlayCtx.lineWidth = 5 / cam.scale;
                overlayCtx.globalAlpha = 1;
                //overlayCtx.globalAlpha = clamp((ANOMALY_SHOW_BEFORE - cam.scale) / (ANOMALY_SHOW_BEFORE - ANOMALY_MAX_AT), 0, 0.5);
                //overlayCtx.beginPath();
                //overlayCtx.arc(azapallAnomaly.x, azapallAnomaly.y, ANOMALY_RADIUS, 0, 2 * Math.PI);
                //overlayCtx.fill();
                overlayCtx.beginPath();
                overlayCtx.arc(azapallAnomaly.x, azapallAnomaly.y, ANOMALY_RADIUS, 0, 2 * Math.PI);
                overlayCtx.stroke();

                overlayCtx.globalAlpha = 1.0;
            //}
        //}
        }

        mapCtx.restore();
        overlayCtx.restore();

        newsCtx.fillStyle = "#00FFFF";
        newsCtx.font = `10px C6-font`;
        if(showTokenTray){
            newsCtx.textAlign = "center";

            newsCtx.drawImage(
                trayImage,
                0,
                0,
                100,
                2000
            );

            var i = 0;
            for(const t of tokenList){
                newsCtx.drawImage(
                    t.img,
                    30,
                    70 * i + 60,
                    40,
                    40
                );
                newsCtx.fillText(t.name, 50, 70 * i + 100);
                i++;
            }
        }

        newsCtx.drawImage(
            hamburgerButton,
            newsCanvas.getBoundingClientRect().width - 80,
            30,
            50,
            50
        );
        

        updateActiveGalaxyLabel();
    }


    let activeObject= null;
    let isActiveObjectStar = true;
    function drawInfoPanel() {
        if (activeObject) {
            if (isActiveObjectStar) {
                var faction = "";
                if (activeObject.faction === "WVP" && hideWVP);
                else if (activeObject.faction === "M.E.W.A.O." && hideMEWAO);
                else faction = activeObject.faction;
                var colour = factionMap.get(faction) ?? "#FFFFFF";
                overlayCtx.fillStyle = "#000000";
                overlayCtx.strokeStyle = colour;
                overlayCtx.lineWidth = 5 / cam.scale;

                const textHeight = starScale / 3;
                overlayCtx.textAlign = "start";
                overlayCtx.textBaseline = "top";

                const bottomLeftX = activeObject.x - (250 / cam.scale) + (overlayCtx.lineWidth * 1.8) + (20 / cam.scale);
                var bottomLeftY = activeObject.y - starScale;


                var rectHeight = 2 * overlayCtx.lineWidth; // baseline
                var topOffset = overlayCtx.lineWidth * 1.8;

                rectHeight += 2 * textHeight + (40 / cam.scale) + overlayCtx.lineWidth; // fed name and faction

                if (activeObject.name) {
                    rectHeight += (starScale / 2);
                    topOffset += (starScale / 2);
                }


                if (activeObject.notes) {
                    if (activeObject.name)rectHeight += 1.5 * textHeight
                    for (const note of activeObject.notes) {
                        rectHeight += (20 / cam.scale);
                        rectHeight += 2 * textHeight; //title section
                        rectHeight += textHeight * (note.charNL.length + 1); // description
                    }
                }


                const topLeft = bottomLeftY - rectHeight;

                // draw title
                if (activeObject.name) {
                    if(!activeObject.notes) rectHeight += 1.5 * textHeight;
                    overlayCtx.fillRect(bottomLeftX - (overlayCtx.lineWidth * 1.8) - (20 / cam.scale), topLeft - (20 / cam.scale), 500 / cam.scale, rectHeight);
                    overlayCtx.strokeRect(bottomLeftX - (overlayCtx.lineWidth * 1.8) - (20 / cam.scale), topLeft - (20 / cam.scale), 500 / cam.scale, rectHeight);

                    overlayCtx.fillStyle = colour;
                    overlayCtx.font = `${starScale / 2}px C6-font`;
                    overlayCtx.fillText(activeObject.name, bottomLeftX, topLeft, 500 / cam.scale);
                }
                else{
                    overlayCtx.fillRect(bottomLeftX - (overlayCtx.lineWidth * 1.8) - (20 / cam.scale), topLeft, 500 / cam.scale, rectHeight);
                    overlayCtx.strokeRect(bottomLeftX - (overlayCtx.lineWidth * 1.8) - (20 / cam.scale), topLeft, 500 / cam.scale, rectHeight);
                }

                overlayCtx.font = `${textHeight}px C6-font`;

                overlayCtx.fillStyle = "#666666";
                overlayCtx.fillText(activeObject.fedName, bottomLeftX, topLeft + topOffset + (7 / cam.scale), 500 / cam.scale);
                topOffset += textHeight + (20 / cam.scale);

                overlayCtx.beginPath();
                overlayCtx.moveTo(bottomLeftX - (20 / cam.scale) + (50 / cam.scale), topLeft + topOffset);
                overlayCtx.lineTo(bottomLeftX - (20 / cam.scale) + (430 / cam.scale), topLeft + topOffset);
                overlayCtx.stroke();
                topOffset += (20 / cam.scale) + overlayCtx.lineWidth;

                overlayCtx.fillStyle = colour;
                overlayCtx.textAlign = "center";
                overlayCtx.textBaseline = "middle";
                var factionText = factionMap.get(faction) ? faction + "-Controlled Territory" : "Uncontrolled Territory"
                overlayCtx.fillText(factionText, activeObject.x, topLeft + topOffset, 500 / cam.scale);
                topOffset += 1 * textHeight;


                if (activeObject.notes) {
                    topOffset += 0.5 * textHeight;

                    overlayCtx.beginPath();
                    overlayCtx.moveTo(bottomLeftX - (20 / cam.scale) + (50 / cam.scale), topLeft + topOffset);
                    overlayCtx.lineTo(bottomLeftX - (20 / cam.scale) + (430 / cam.scale), topLeft + topOffset);
                    overlayCtx.stroke();


                    overlayCtx.strokeStyle = "#666666";
                    var firstNote = true;
                    overlayCtx.textAlign = "left";
                    overlayCtx.textBaseline = "alphabetic";
                    overlayCtx.fillStyle = "#666666";
                    overlayCtx.lineWidth = overlayCtx.lineWidth / 3;
                    for (const note of activeObject.notes) {
                        if (!firstNote) {
                            overlayCtx.beginPath();
                            overlayCtx.moveTo(bottomLeftX - (20 / cam.scale) + (10 / cam.scale), topLeft + topOffset);
                            overlayCtx.lineTo(bottomLeftX - (20 / cam.scale) + (470 / cam.scale), topLeft + topOffset);
                            overlayCtx.stroke();
                        } else firstNote = false;


                        overlayCtx.fillStyle = colour;
                        if (note.src) {
                            //console.log(note.src);
                            overlayCtx.drawImage(note.img, bottomLeftX, topLeft + topOffset + (5 /cam.scale), textHeight * 2, textHeight * 2);
                            overlayCtx.fillText(note.title, bottomLeftX + (textHeight * 2) + (5 / cam.scale), topLeft + topOffset + (textHeight * 1.5), 500 / cam.scale);
                        }
                        else overlayCtx.fillText(note.title, bottomLeftX, topLeft + topOffset + (textHeight * 1.5), 500 / cam.scale);

                        topOffset += textHeight * 2;

                        overlayCtx.fillStyle = "#666666";
                        let prev = 0;
                        for (const breakPoint of note.charNL) {
                            var temp = note.desc.slice(prev, breakPoint);
                            prev = breakPoint;
                            overlayCtx.fillText(temp, bottomLeftX, topLeft + topOffset + textHeight, 500 / cam.scale);
                            topOffset += textHeight;
                        }
                        overlayCtx.fillText(note.desc.slice(prev), bottomLeftX, topLeft + topOffset + textHeight, 500 / cam.scale);
                        topOffset += textHeight + (20 / cam.scale);
                    }
                }
            }



            else {
                var colour = activeObject.color ?? "#FFFFFF";
                overlayCtx.fillStyle = "#000000";
                overlayCtx.strokeStyle = colour;
                overlayCtx.lineWidth = 5 / cam.scale;

                const textHeight = starScale / 3;
                overlayCtx.textAlign = "start";
                overlayCtx.textBaseline = "top";

                var rectHeight = 2 * overlayCtx.lineWidth;
                rectHeight += 4 * textHeight;

                const bottomLeftX = activeObject.x - (250 / cam.scale) + (overlayCtx.lineWidth * 1.8);
                var bottomLeftY = activeObject.y - starScale;

                overlayCtx.strokeStyle = colour;

                overlayCtx.fillRect(bottomLeftX - (overlayCtx.lineWidth * 1.8), bottomLeftY - rectHeight, 500 / cam.scale, rectHeight);
                overlayCtx.strokeRect(bottomLeftX - (overlayCtx.lineWidth * 1.8), bottomLeftY - rectHeight, 500 / cam.scale, rectHeight);

                overlayCtx.fillStyle = colour;

                overlayCtx.drawImage(activeObject.img, bottomLeftX, bottomLeftY - rectHeight + (10 / cam.scale), textHeight * 2, textHeight * 2);

                overlayCtx.font = `${starScale / 2}px C6-font`;
                overlayCtx.fillText(activeObject.name, bottomLeftX + (textHeight * 2) + (5 / cam.scale), bottomLeftY - rectHeight + (textHeight * 0.5) + (10 / cam.scale), 500 / cam.scale);

                overlayCtx.font = `${textHeight}px C6-font`;
                overlayCtx.fillStyle = "#666666";
                overlayCtx.fillText(activeObject.desc, bottomLeftX, bottomLeftY - rectHeight + (2*textHeight) + (20 / cam.scale), 500 / cam.scale);
            }
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

        if(best.name === "Veils" && hideVeils) return;

        activeGalaxyId = best.id;

        const nm = (best.name ?? best.id ?? "").toString();
        const ds = (best.desc ?? "").toString();

        galaxyNameEl.textContent = nm;
        galaxyDescEl.textContent = ds;
    }



    const MAX_RADIUS = 200;
    function checkClickedStar(a, radius, isForInfoPanel = false){
        var stored = {dist:MAX_RADIUS * MAX_RADIUS + 1, s:null};
        for(const [key, s] of sectors){
            var starX = s.x ;
            var starY = s.y ;
            var dist = ((starX - a.x) * (starX - a.x)) + ((starY - a.y) * (starY - a.y))
            
            if(dist <= radius * radius){
                if(dist < stored.dist)
                    stored = {dist, s};
            }
        }

        if(isForInfoPanel)
            isActiveObjectStar = true;

        return stored.s;
    }

    function checkClickedToken(a){
        var stored = {dist:MAX_RADIUS * MAX_RADIUS + 1, s:null};
        //console.warn(a);
        for(const t of tokens){
            var dist = ((t.x - a.x) * (t.x - a.x)) + ((t.y - a.y) * (t.y - a.y))

            if(dist <= (40/cam.scale) * (40/cam.scale))
                if(dist < stored.dist)
                    stored = {dist, s: t};
        }

        isActiveObjectStar = false;
        console.log(stored.s);
        return stored.s;
    }


    // extracts the ID of a star from its fedName
    function getStarFedHash(name){
        var id = parseInt(name.slice(-4));
        return id;
    }
    function getStarENIHash(name){

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

        const newsRect = newsCanvas.getBoundingClientRect();
        newsCanvas.width = Math.floor(newsRect.width * dpr);
        newsCanvas.height = Math.floor(newsRect.height * dpr);

        newsCtx.font = `${NEWS_FEED_SIZE}px C6-font`;

        // draw in CSS pixels
        mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        newsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }


    // Pan: pointer drag
    let LClickTime = null;
    let trinket = null;
    let newToken = false;
    mapCanvas.addEventListener("pointerdown", (e) => {
        LClickTime = Date.now();
        
        cam.startMouseX = e.clientX;
        cam.startMouseY = e.clientY;
        cam.startCamX = cam.x;
        cam.startCamY = cam.y;
        mapCanvas.setPointerCapture(e.pointerId);

        for(const t of tokens){
            var a = screenToWorld(e.clientX, e.clientY);
            var dist = ((t.x - a.x) * (t.x - a.x)) + ((t.y - a.y) * (t.y - a.y))
            
            if(dist <= starScale * starScale)
                trinket = t;
        }
        
        if(!trinket){
            var leftX = newsCanvas.getBoundingClientRect().width - 80;
            if(e.clientX >= leftX && e.clientY >= 30 && e.clientX <= leftX + 50 && e.clientY <= 80)
                showTokenTray = !showTokenTray;
            //console.log(showTokenTray);
        }
        if(showTokenTray){
            var i = 0;
            for(const t of tokenList)
            {
                if(e.clientX >= 25 && e.clientY >= 70 * i + 50 && e.clientX <= 25 + 50 && e.clientY <= 70 * i + 100){
                    newToken = true;
                    trinket = t;
                    break;
                }
                i++;
            }
        }
    });

    mapCanvas.addEventListener("pointermove", (e) => {
        if(LClickTime && !cam.dragging && !trinket) cam.dragging = true;
        if (cam.dragging){
            const dx = (e.clientX - cam.startMouseX) / cam.scale;
            const dy = (e.clientY - cam.startMouseY) / cam.scale;
            cam.x = cam.startCamX - dx;
            cam.y = cam.startCamY - dy;
            draw();
        }
        else if(trinket){
            var a = screenToWorld(e.clientX, e.clientY);
            trinket.x = a.x;
            trinket.y = a.y;
            draw();
        }
    });


    let freeList = [];
    mapCanvas.addEventListener("pointerup", (e) => {
        if(Date.now() - LClickTime < 200 && cam.dragging === false){ //200ms threshold for click
            //console.log("click at:", e.clientX, " ", e.clientY);
            activeObject = checkClickedStar(screenToWorld(e.clientX, e.clientY), starScale, true) ?? checkClickedToken(screenToWorld(e.clientX, e.clientY));
            draw();
        }
        if(newToken && e.clientX > 100)
        {
            //try{
            trinket.id = freeList.length > 0 ? freeList.pop() : tokens.length;
            console.log(trinket.id);
            tokens.push({...trinket});
            //} catch(e){}
            trinket = null;
            draw();
        }

        if(trinket && showTokenTray)
        {
            if(e.clientX < 100)
            {
                freeList.push(trinket.id);
                console.log("deletion", trinket.id, tokens.length);
                tokens = tokens.filter(obj => obj.id !== trinket.id);
                trinket = null;
                draw();
            }
        }
        newToken = false;
        // TODO:
        // add to a sector every token that's within range
        // thats what the modded checkClickedStar function is for
        cam.dragging = false;
        LClickTime = null;
        //console.log(trinket);
        trinket = null;
    });


    let tempSector = [];
    function checkSectorVertex(mousePos){
        var coords = {x: Math.trunc(mousePos.x * 2.5), y: Math.trunc(mousePos.y * 2.5)};

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


    // Zoom: mouse wheel anchored at mouse position
    let targetZoom = 0.15;
    let before = null;
    let mouseRaw = null;
    let lastTime = 0;
    let dt = 0;
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


        if(LClickTime && cam.dragging === false)
        {
            if(Date.now() - LClickTime > 1000) //1s threshold for hold
            {
                //console.log("Holding!");
            }
        }


        // news feed ticker
        handleNewsFeed(dt);

        dt = Date.now() - lastTime;
        lastTime = Date.now();
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



    //window.addEventListener("keydown", (e) => {
    //    console.log(e.code);
    //});





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

