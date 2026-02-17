(() => {
    const canvas = document.getElementById("mapCanvas");
    const mount = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });

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

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = src;
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load ${src} (check path + case)`));
        });
    }

    // --- Galaxies in world space ---
    // Galaxy 1 is at origin. Galaxy 2 is left (-x) and down (+y).
    const galaxies = [
        { id: "g1", src: "assets/galaxy1.png", x: 0, y: 0, scale: 1.0, img: null },
        { id: "g2", src: "assets/galaxy2.png", x: -4200, y: 1800, scale: 2.0, img: null }
    ];

    Promise.all(galaxies.map(g => loadImage(g.src)))
        .then(images => {
            for (let i = 0; i < galaxies.length; i++) galaxies[i].img = images[i];

            // Start camera centered on galaxy1
            const g1 = galaxies[0];
            cam.x = g1.img.width * 0.5 + g1.x;
            cam.y = g1.img.height * 0.5 + g1.y;

            draw();
        })
        .catch(err => console.error(err));

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

    function draw() {
        const rect = canvas.getBoundingClientRect();
        const vw = rect.width;
        const vh = rect.height;

        ctx.clearRect(0, 0, vw, vh);

        // If images not ready yet
        if (!galaxies[0].img) {
            ctx.fillStyle = "rgba(207,231,255,0.5)";
            ctx.fillText("Loading galaxy images...", 20, 30);
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

        ctx.restore();
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
})();
