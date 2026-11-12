import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";

const MAX_BYTES = 500_000;

/**
 * OFF-008: receipt photos are compressed on the phone to at most 500 KB before they are stored, so a weak
 * connection only has to carry what is needed to read the receipt. Tries smaller sizes until it fits.
 */
export async function shrinkPhoto(uri: string): Promise<string> {
  for (const [width, compress] of [[1600, 0.7], [1280, 0.6], [1024, 0.5], [800, 0.45]] as const) {
    const r = await manipulateAsync(uri, [{ resize: { width } }], { compress, format: SaveFormat.JPEG });
    if ((new File(r.uri).size ?? Infinity) <= MAX_BYTES) return r.uri;
  }
  throw new Error("photo_too_large");
}
