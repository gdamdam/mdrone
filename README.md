<h1 align="center">mdrone</h1>
<p align="center">
  A browser drone instrument — one held harmonic bed with atmosphere.<br>
  Tune the room. Let it breathe.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.0.1-orange" alt="Version">
  <img src="https://img.shields.io/badge/status-prototype-red" alt="Prototype">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-green" alt="License">
</p>

---

## What it is

mdrone is the third app in the mpump / mloop family. It owns **sustain** — pitch, mode, held harmonic bed, atmosphere. The instrument you reach for when you don't want rhythm or captured sounds; you want air, pitch, room, and time.

- **mpump** owns groove
- **mloop** owns capture
- **mdrone** owns sustain

## Current state

Working prototype of the **layout only**. Two views (DRONE + MIXER), warm ember palette, a minimal two-oscillator drone voice, and the full Option B master chain (same as mloop) wired up through the mixer view. No partial bank, no scene morph, no weather macros yet.

## Two views

| View | What it does |
|---|---|
| **DRONE** | Tonic wheel + mode picker + 3 macro sliders (DRIFT · AIR · TIME) + a large XY climate surface |
| **MIXER** | Master bus — HPF · 3-band EQ · glue comp · drive · limiter + ceiling · output trim (identical to mloop's mixer) |

## Dev

```bash
npm install
npm run dev
```

## License

[AGPL-3.0-or-later](LICENSE).

---

Built with Claude Code. Design, architecture, UX, and creative direction by [gdamdam](https://github.com/gdamdam).
