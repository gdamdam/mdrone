/**
 * MediaSession wiring for background-audio behaviour.
 *
 * When mdrone is playing in a backgrounded tab, on an iOS home-screen
 * PWA, or on Android with the screen locked, the OS uses these hints
 * to render a lock-screen / notification-shade control with play/pause
 * that maps back to HOLD. Without MediaSession, the OS pause control
 * either doesn't appear or pauses the whole audio focus abruptly.
 *
 * Web Audio does not automatically mark an app as "media playing",
 * so on some platforms (notably iOS Safari) the lockscreen controls
 * only appear once we populate metadata AND the audio is audibly
 * active. That's why we only call `setPlaying` from a code path that
 * already has a user gesture (the HOLD toggle) and audible output.
 */

export type MediaSessionInfo = {
  title?: string; // preset / scene name
  artist?: string; // tonic + octave, e.g. "C · 2"
};

type ActionHandler = () => void;

let installed = false;

export function installMediaSession(handlers: {
  onPlay: ActionHandler;
  onPause: ActionHandler;
}): void {
  if (installed) return;
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

  try {
    navigator.mediaSession.setActionHandler("play", () => handlers.onPlay());
    navigator.mediaSession.setActionHandler("pause", () => handlers.onPause());
    // Tempting to wire prev/next to preset cycling, but lock-screen
    // "previous track" mid-drone is semantically wrong — drones don't
    // advance by tracks. Leave them null.
    navigator.mediaSession.setActionHandler("previoustrack", null);
    navigator.mediaSession.setActionHandler("nexttrack", null);
    navigator.mediaSession.setActionHandler("seekbackward", null);
    navigator.mediaSession.setActionHandler("seekforward", null);
  } catch { /* older Safari throws on unsupported actions — ignore */ }

  installed = true;
}

export function setMediaSessionMetadata(info: MediaSessionInfo): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.title || "mdrone",
      artist: info.artist || "drone",
      album: "mdrone",
      artwork: [
        { src: "./icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "./icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
  } catch { /* ignore — MediaMetadata missing on old browsers */ }
}

export function setMediaSessionPlaying(playing: boolean): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  } catch { /* ignore */ }
}
