(() => {
    const canvas = document.getElementById("mapCanvas");
    const mount = canvas; // use the canvas itself for sizing
    const ctx = canvas.getContext("2d", { alpha: true });

    // Camera in "world pixels" (same coordinate space as the image)
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

    // Resize canvas to match its CSS size (important for crisp rendering)
    function resizeCanvas() {
        const rect = mount.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);

        // Use CSS pixels for drawing coordinates
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        draw();
    }

    window.addEventListener("resize", resizeCanvas);

    // Load galaxy image
    const img = new Image();
    img.src = "assets/galaxy1.png";
    img.onload = () => {
        // Start centered on the image
        cam.x = img.width * 0.5;
        cam.y = img.height * 0.5;
        draw();
    };
    img.onerror = () => {
        console.error("Failed to load assets/galaxy1.png (check path + case)");
    };

    function screenToWorld(sx, sy) {
        // sx/sy are in CSS pixels relative to canvas
        const rect = canvas.getBoundingClientRect();
        const x = sx - rect.left;
        const y = sy - rect.top;

        const vw = rect.width;
        const vh = rect.height;

        // Inverse of: screen = (world - cam) * scale + center
        const wx = (x - vw * 0.5) / cam.scale + cam.x;
        const wy = (y - vh * 0.5) / cam.scale + cam.y;
        return { x: wx, y: wy };
    }

    function draw() {
        const rect = canvas.getBoundingClientRect();
        const vw = rect.width;
        const vh = rect.height;

        // Clear
        ctx.clearRect(0, 0, vw, vh);

        // If image not loaded yet, draw a placeholder
        if (!img.complete || !img.naturalWidth) {
            ctx.fillStyle = "rgba(207,231,255,0.35)";
            ctx.fillText("Loading assets/galaxy1.png ...", 20, 30);
            return;
        }

        // Set transform for camera:
        // Move origin to viewport center, apply zoom, then translate world so cam is centered.
        ctx.save();
        ctx.translate(vw * 0.5, vh * 0.5);
        ctx.scale(cam.scale, cam.scale);
        ctx.translate(-cam.x, -cam.y);

        // Draw galaxy image in world space at (0,0)
        ctx.drawImage(img, 0, 0);

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

    // Zoom: mouse wheel, anchor at mouse position
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();

        const before = screenToWorld(e.clientX, e.clientY);

        const zoomFactor = Math.pow(1.0017, -e.deltaY);
        cam.scale = clamp(cam.scale * zoomFactor, ZOOM_MIN, ZOOM_MAX);

        const after = screenToWorld(e.clientX, e.clientY);

        // Adjust camera so the world point under the mouse stays fixed
        cam.x += (before.x - after.x);
        cam.y += (before.y - after.y);

        draw();
    }, { passive: false });

    // Kick off
    resizeCanvas();
})();
