// Camera, microphone and the speech recorder.
//
// One getUserMedia call asks for both, so the patient sees one permission prompt instead of
// two. The video track feeds the landmarker and the small self view and is never recorded.
// The audio track is recorded only during the speaking tasks, in whichever container the
// browser actually supports: Safari gives mp4 or aac, everything else webm or ogg with opus.

const WANT: Array<[string, string]> = [
  ["audio/webm;codecs=opus", "webm"],
  ["audio/webm", "webm"],
  ["audio/ogg;codecs=opus", "ogg"],
  ["audio/mp4;codecs=mp4a.40.2", "mp4"],
  ["audio/mp4", "mp4"],
  ["audio/aac", "aac"],
];

export interface Picked {
  mime: string;
  ext: string;
}

export interface Clip {
  blob: Blob;
  ext: string;
}

/** Plain language reason a permission request failed. */
export function why(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The camera and microphone were blocked. Open your browser settings for this page and allow them, then reload.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "This phone did not offer a front camera or a microphone we could use.";
  }
  if (name === "NotReadableError") {
    return "Another app is using the camera. Close it and try again.";
  }
  return "The camera and microphone could not start on this phone.";
}

/** The front camera plus the microphone, in one prompt. */
export function open(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new DOMException("no media devices", "NotFoundError"));
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
  });
}

/** Stops every track so the camera light goes out when the call ends. */
export function close(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** The first container this browser will actually record, or null when none will. */
export function pick(): Picked | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of WANT) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
    } catch {
      // Older Safari throws instead of answering. Keep trying the rest.
    }
  }
  return null;
}

/** Records the microphone for one task and hands back a single blob. */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private parts: Blob[] = [];
  private picked: Picked | null = null;

  constructor(private stream: MediaStream) {}

  start(): boolean {
    const picked = pick();
    if (!picked || !this.stream.getAudioTracks().length) return false;
    this.picked = picked;
    this.parts = [];
    const audio = new MediaStream(this.stream.getAudioTracks());
    try {
      this.rec = new MediaRecorder(audio, { mimeType: picked.mime });
    } catch {
      return false;
    }
    this.rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) this.parts.push(ev.data);
    };
    this.rec.start(1000);
    return true;
  }

  /** Stops and resolves with the clip, or null when nothing was captured. */
  stop(): Promise<Clip | null> {
    const rec = this.rec;
    const picked = this.picked;
    this.rec = null;
    if (!rec || !picked) return Promise.resolve(null);
    return new Promise((done) => {
      const finish = () => {
        const blob = new Blob(this.parts, { type: picked.mime });
        this.parts = [];
        done(blob.size ? { blob, ext: picked.ext } : null);
      };
      rec.onstop = finish;
      try {
        rec.stop();
      } catch {
        finish();
      }
    });
  }
}
