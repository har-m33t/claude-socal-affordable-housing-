/**
 * Lane 3: the run recorder.
 *
 * Buffers every StreamFrame of a live run in memory and, on save(), writes
 * them as one JSON array for replay mode. Writing goes to a temp file in the
 * same directory followed by a rename, so a crash mid-write can never leave a
 * half-written replay file that the loader would then reject.
 */
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { RecorderHandle, StreamFrame } from "./types";
import { DEFAULT_REPLAY_PATH } from "./replay";

export { DEFAULT_REPLAY_PATH };

export interface Recorder extends RecorderHandle {
  /** Frames buffered so far. */
  size(): number;
  /**
   * Whether the most recent save() actually put a file on disk. False before
   * the first save, and false after a save with zero frames recorded.
   */
  wroteFile(): boolean;
}

/**
 * Create a recorder. `targetPath` defaults to fixtures/replay.json, resolved
 * against the process working directory (the `pointer/` app root).
 *
 * A run that recorded nothing writes nothing: save() resolves with the path it
 * would have written and leaves the filesystem untouched, so a failed run can
 * never clobber a good replay file with an empty one. wroteFile() reports
 * which of the two happened.
 */
export function createRecorder(targetPath: string = DEFAULT_REPLAY_PATH): Recorder {
  const frames: StreamFrame[] = [];
  let wrote = false;

  return {
    record(frame: StreamFrame): void {
      frames.push(frame);
    },

    size(): number {
      return frames.length;
    },

    wroteFile(): boolean {
      return wrote;
    },

    async save(): Promise<string> {
      const destination = path.resolve(targetPath);

      if (frames.length === 0) {
        wrote = false;
        return destination;
      }

      const directory = path.dirname(destination);
      await fs.mkdir(directory, { recursive: true });

      const temp = path.join(directory, `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
      const body = `${JSON.stringify(frames, null, 2)}\n`;

      try {
        await fs.writeFile(temp, body, "utf8");
        await fs.rename(temp, destination);
      } catch (err) {
        await fs.rm(temp, { force: true }).catch(() => undefined);
        throw err;
      }

      wrote = true;
      return destination;
    },
  };
}

export default createRecorder;
