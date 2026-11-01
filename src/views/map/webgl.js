// Can this computer draw the 3D knowledge map? (Kept apart from ui/sky3d.js so
// asking doesn't load three.js.)

let known = null;

export function webglAvailable() {
  if (known != null) return known;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    known = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    known = false;
  }
  return known;
}
