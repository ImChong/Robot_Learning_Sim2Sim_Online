/**
 * Vite plugin (build only): write a gzip copy (`<file>.gz`) next to every STL mesh listed in
 * `examples/scenes/files.json` in the build output.
 *
 * GitHub Pages serves `.STL` as `application/vnd.ms-pki.stl` without Content-Encoding, so the
 * ~20 MB of meshes per robot go over the wire uncompressed. The loader in
 * src/simulation/mujocoUtils.js fetches the `.gz` copy and inflates it with
 * DecompressionStream, falling back to the original file. The originals stay in place.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { constants, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const SCENES_DIR = 'examples/scenes';
const COMPRESSED_SCENE_ASSET_RE = /\.stl$/i;

export default function sceneMeshGzipPlugin() {
  return {
    name: 'scene-mesh-gzip',
    apply: 'build',
    async writeBundle(outputOptions) {
      const scenesDir = join(outputOptions.dir, SCENES_DIR);
      let files;
      try {
        files = JSON.parse(await readFile(join(scenesDir, 'files.json'), 'utf8'));
      } catch (error) {
        this.warn(`skipped: cannot read ${SCENES_DIR}/files.json (${error.message})`);
        return;
      }
      const meshes = files.filter((rel) => COMPRESSED_SCENE_ASSET_RE.test(rel));
      let rawBytes = 0;
      let gzBytes = 0;
      await Promise.all(meshes.map(async (rel) => {
        const source = join(scenesDir, rel);
        const raw = await readFile(source);
        const compressed = await gzipAsync(raw, { level: constants.Z_BEST_COMPRESSION });
        await writeFile(`${source}.gz`, compressed);
        rawBytes += raw.length;
        gzBytes += compressed.length;
      }));
      const mb = (n) => (n / 1048576).toFixed(1);
      this.info?.(`${meshes.length} meshes: ${mb(rawBytes)} MB -> ${mb(gzBytes)} MB`);
    }
  };
}
