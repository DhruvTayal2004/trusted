/**
 * TrustedAEO ambient background loop.
 *
 * A "trust network" visualization for Answer Engine Optimization:
 *   - one bright central node (the answer / the brand)
 *   - 6 platform anchor nodes at fixed angles around it (Reddit, YouTube,
 *     X, Instagram, AI search, Search) — slightly larger, slightly brighter
 *   - smaller ambient mention nodes scattered around each platform
 *   - hairline mesh between nearby nodes (the trust web)
 *   - citation pulses traveling INWARD from outer nodes toward the center
 *     (trust accumulating)
 *   - occasional "verified" rings expanding from platform nodes
 *   - a slowly drifting underlay grid (the infrastructure foundation)
 *
 * Pure canvas. No external deps. Call initTrustNetwork(canvas).
 */
(function () {
  function initTrustNetwork(canvas) {
    const ctx = canvas.getContext("2d");

    let DPR = 1;
    let cssW = 0, cssH = 0;

    // Seeded RNG for deterministic ambient positions
    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // ---- Node model ----
    // Three kinds:
    //   "center"   — the answer / brand (1)
    //   "platform" — fixed angular anchors (6)
    //   "mention"  — ambient satellites (many)
    let nodes = [];
    let centerIndex = 0;
    const platformCount = 6;
    const mentionsPerPlatform = 7;
    const ambientCount = 30;

    function buildNodes() {
      nodes = [];
      const rnd = mulberry32(20260516);

      const cx = cssW * 0.5;
      const cy = cssH * 0.5;
      const baseR = Math.min(cssW, cssH);

      // center
      nodes.push({
        kind: "center",
        bx: cx, by: cy,
        ax: 2, ay: 2,
        wx: 0.18, wy: 0.21,
        px: 0, py: Math.PI * 0.5,
        z: 1, r: 3.2,
        tw: 0.6, twp: 0,
      });
      centerIndex = 0;

      // platform anchors at fixed angles
      const r1 = baseR * 0.30;
      for (let i = 0; i < platformCount; i++) {
        const ang = (i / platformCount) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(ang) * r1;
        const y = cy + Math.sin(ang) * r1;
        nodes.push({
          kind: "platform",
          bx: x, by: y,
          ax: 6 + rnd() * 6,
          ay: 6 + rnd() * 6,
          wx: 0.08 + rnd() * 0.06,
          wy: 0.08 + rnd() * 0.06,
          px: rnd() * Math.PI * 2,
          py: rnd() * Math.PI * 2,
          z: 0.85,
          r: 2.0,
          tw: 0.6 + rnd() * 0.6,
          twp: rnd() * Math.PI * 2,
          angle: ang,
        });
      }

      // mentions clustered loosely around each platform
      const r2 = baseR * 0.13;
      for (let i = 0; i < platformCount; i++) {
        const ang = (i / platformCount) * Math.PI * 2 - Math.PI / 2;
        for (let j = 0; j < mentionsPerPlatform; j++) {
          // sample around the platform position with some spread
          const spread = r2 * (0.6 + rnd() * 1.2);
          const a2 = ang + (rnd() - 0.5) * 0.9;
          const dist = baseR * (0.22 + rnd() * 0.22);
          const x = cx + Math.cos(a2) * dist + (rnd() - 0.5) * spread;
          const y = cy + Math.sin(a2) * dist + (rnd() - 0.5) * spread;
          nodes.push({
            kind: "mention",
            bx: x, by: y,
            ax: 8 + rnd() * 20,
            ay: 8 + rnd() * 20,
            wx: 0.05 + rnd() * 0.10,
            wy: 0.05 + rnd() * 0.10,
            px: rnd() * Math.PI * 2,
            py: rnd() * Math.PI * 2,
            z: 0.35 + rnd() * 0.5,
            r: 0.6 + rnd() * 1.2,
            tw: 0.5 + rnd() * 1.5,
            twp: rnd() * Math.PI * 2,
          });
        }
      }

      // far-field ambient nodes (atmospheric depth)
      for (let i = 0; i < ambientCount; i++) {
        nodes.push({
          kind: "mention",
          bx: rnd() * cssW,
          by: rnd() * cssH,
          ax: 8 + rnd() * 25,
          ay: 8 + rnd() * 25,
          wx: 0.04 + rnd() * 0.08,
          wy: 0.04 + rnd() * 0.08,
          px: rnd() * Math.PI * 2,
          py: rnd() * Math.PI * 2,
          z: 0.15 + rnd() * 0.35,
          r: 0.5 + rnd() * 0.9,
          tw: 0.4 + rnd() * 1.2,
          twp: rnd() * Math.PI * 2,
        });
      }
    }

    // cached current positions
    let curX = new Float32Array(0);
    let curY = new Float32Array(0);

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      cssW = r.width;
      cssH = r.height;
      canvas.width = Math.round(cssW * DPR);
      canvas.height = Math.round(cssH * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      buildNodes();
      curX = new Float32Array(nodes.length);
      curY = new Float32Array(nodes.length);
    }

    window.addEventListener("resize", resize);

    // ---- Drawing ----

    function drawGrid(t) {
      const spacing = 64;
      const ox = (t * 6) % spacing;
      const oy = (t * 4) % spacing;
      ctx.save();
      ctx.lineWidth = 1;
      for (let x = -spacing + ox; x < cssW + spacing; x += spacing) {
        const dx = (x - cssW / 2) / (cssW / 2);
        const alpha = 0.04 * (1 - Math.min(1, Math.abs(dx)));
        ctx.strokeStyle = `rgba(170, 190, 220, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssH);
        ctx.stroke();
      }
      for (let y = -spacing + oy; y < cssH + spacing; y += spacing) {
        const dy = (y - cssH / 2) / (cssH / 2);
        const alpha = 0.04 * (1 - Math.min(1, Math.abs(dy)));
        ctx.strokeStyle = `rgba(170, 190, 220, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cssW, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    function updateNodes(t) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        curX[i] = n.bx + Math.cos(t * n.wx + n.px) * n.ax;
        curY[i] = n.by + Math.sin(t * n.wy + n.py) * n.ay;
      }
    }

    function drawSpokes() {
      // Faint radial lines from center to each platform — the "answer
      // graph" — always visible but very subtle.
      const cx = curX[centerIndex];
      const cy = curY[centerIndex];
      ctx.lineWidth = 1;
      for (let i = 1; i <= platformCount; i++) {
        const x = curX[i], y = curY[i];
        // gradient along the line so it fades from center outward
        const grad = ctx.createLinearGradient(cx, cy, x, y);
        grad.addColorStop(0, "rgba(200, 220, 255, 0.15)");
        grad.addColorStop(1, "rgba(200, 220, 255, 0.04)");
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }

    function drawConnections() {
      // mesh between nodes within range
      const maxDist = 130;
      const maxDist2 = maxDist * maxDist;
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          // skip center-to-platform (already drawn brighter as spokes)
          if (i === centerIndex && j <= platformCount) continue;
          if (j === centerIndex && i <= platformCount) continue;
          const dx = curX[i] - curX[j];
          const dy = curY[i] - curY[j];
          const d2 = dx * dx + dy * dy;
          if (d2 > maxDist2) continue;
          const k = 1 - Math.sqrt(d2) / maxDist;
          const zk = (nodes[i].z + nodes[j].z) * 0.5;
          const a = 0.16 * k * (0.35 + zk * 0.65);
          ctx.strokeStyle = `rgba(180, 200, 230, ${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(curX[i], curY[i]);
          ctx.lineTo(curX[j], curY[j]);
          ctx.stroke();
        }
      }
    }

    function drawNodes(t) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const x = curX[i], y = curY[i];
        const twinkle = 0.65 + 0.35 * Math.sin(t * n.tw + n.twp);

        if (n.kind === "center") {
          // breathing halo — the answer / brand
          const breath = 0.85 + 0.15 * Math.sin(t * 0.9);
          const haloR = 90 * breath;
          const halo = ctx.createRadialGradient(x, y, 0, x, y, haloR);
          halo.addColorStop(0, "rgba(220, 235, 255, 0.30)");
          halo.addColorStop(0.35, "rgba(180, 205, 240, 0.08)");
          halo.addColorStop(1, "rgba(180, 205, 240, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, haloR, 0, Math.PI * 2);
          ctx.fill();

          // ring
          ctx.strokeStyle = "rgba(220, 235, 255, 0.55)";
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(x, y, 16 * breath, 0, Math.PI * 2);
          ctx.stroke();

          // core
          ctx.fillStyle = "rgba(245, 250, 255, 0.95)";
          ctx.beginPath();
          ctx.arc(x, y, n.r, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }

        if (n.kind === "platform") {
          // softer glow
          const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
          g.addColorStop(0, `rgba(210, 225, 250, ${(0.30 * twinkle).toFixed(3)})`);
          g.addColorStop(0.5, `rgba(180, 200, 230, ${(0.08 * twinkle).toFixed(3)})`);
          g.addColorStop(1, "rgba(180, 200, 230, 0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, 26, 0, Math.PI * 2);
          ctx.fill();

          // outer ring (subtle)
          ctx.strokeStyle = `rgba(220, 235, 255, ${(0.30 * twinkle).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.stroke();

          // core
          ctx.fillStyle = `rgba(235, 245, 255, ${(0.95 * twinkle).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, n.r, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }

        // mention
        const r = n.r * (0.7 + n.z * 1.6);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 8);
        g.addColorStop(0, `rgba(200, 215, 240, ${(0.30 * twinkle).toFixed(3)})`);
        g.addColorStop(0.4, `rgba(180, 200, 230, ${(0.08 * twinkle).toFixed(3)})`);
        g.addColorStop(1, "rgba(180, 200, 230, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(225, 235, 250, ${(0.80 * twinkle).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- Citations: pulses traveling INWARD ----
    const citations = [];
    function spawnCitation(t) {
      if (citations.length > 14) return;
      // source: any non-center node; favor outer mentions
      let source;
      let tries = 0;
      do {
        source = 1 + Math.floor(Math.random() * (nodes.length - 1));
        tries++;
      } while (tries < 4 && nodes[source].kind !== "mention" && Math.random() < 0.4);

      // target: center (most of the time), or a platform (sometimes)
      const toCenter = Math.random() < 0.78;
      const target = toCenter ? centerIndex : (1 + Math.floor(Math.random() * platformCount));
      if (source === target) return;

      citations.push({
        i: source,
        j: target,
        start: t,
        dur: 1.8 + Math.random() * 1.8,
      });
    }
    function drawCitations(t) {
      for (let p = citations.length - 1; p >= 0; p--) {
        const c = citations[p];
        const k = (t - c.start) / c.dur;
        if (k >= 1) { citations.splice(p, 1); continue; }
        const sx = curX[c.i], sy = curY[c.i];
        const tx = curX[c.j], ty = curY[c.j];
        // ease the travel
        const ek = 1 - Math.pow(1 - k, 2.2);
        const x = sx + (tx - sx) * ek;
        const y = sy + (ty - sy) * ek;
        const fade = Math.sin(k * Math.PI);

        // faint trailing line
        const grad = ctx.createLinearGradient(sx, sy, x, y);
        grad.addColorStop(0, "rgba(220, 235, 255, 0)");
        grad.addColorStop(1, `rgba(220, 235, 255, ${(0.35 * fade).toFixed(3)})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(x, y);
        ctx.stroke();

        // pulse head glow
        const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
        g.addColorStop(0, `rgba(230, 240, 255, ${(0.55 * fade).toFixed(3)})`);
        g.addColorStop(1, "rgba(230, 240, 255, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();

        // pulse head core
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.9 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- Verified rings: expanding ring pulses from platforms ----
    const verifies = [];
    function spawnVerify(t) {
      const i = 1 + Math.floor(Math.random() * platformCount);
      verifies.push({ i, start: t, dur: 2.4 + Math.random() * 0.8 });
    }
    function drawVerifies(t) {
      for (let p = verifies.length - 1; p >= 0; p--) {
        const v = verifies[p];
        const k = (t - v.start) / v.dur;
        if (k >= 1) { verifies.splice(p, 1); continue; }
        const x = curX[v.i], y = curY[v.i];
        const r = 6 + k * 60;
        const alpha = (1 - k) * 0.45;
        ctx.strokeStyle = `rgba(220, 235, 255, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ---- Main loop ----
    let last = performance.now();
    let citeTimer = 0;
    let verifyTimer = 0;

    function frame(now) {
      const t = now / 1000;
      const dt = (now - last) / 1000;
      last = now;

      // trail wash
      ctx.fillStyle = "rgba(7, 8, 11, 0.55)";
      ctx.fillRect(0, 0, cssW, cssH);

      drawGrid(t);
      updateNodes(t);
      drawSpokes();
      drawConnections();
      drawCitations(t);
      drawNodes(t);
      drawVerifies(t);

      citeTimer += dt;
      if (citeTimer > 0.32) {
        citeTimer = 0;
        // multiple citations per beat for a sense of inbound flow
        spawnCitation(t);
        if (Math.random() < 0.6) spawnCitation(t);
      }
      verifyTimer += dt;
      if (verifyTimer > 1.6) {
        verifyTimer = 0;
        if (Math.random() < 0.7) spawnVerify(t);
      }

      requestAnimationFrame(frame);
    }

    resize();
    requestAnimationFrame(frame);
  }

  window.initTrustNetwork = initTrustNetwork;
})();
