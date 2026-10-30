"""Lets wallpapers react to the sound your computer plays (music, videos, games).

Aerie listens to the "monitor" of your speakers or headphones, the copy of what they play. It
never opens a microphone, never records to a file and never sends sound anywhere: each frame
of sound is turned into 64 volume bars per ear and dropped right away. It only runs while a
wallpaper that reacts to sound is on screen and not paused, and you can turn it off in Studio.

Wallpapers get the bars the way Wallpaper Engine gives them (128 numbers: left 0-63, right 64-127),
and shaders get Shadertoy's audio texture (512 frequency values and 512 wave samples).
"""

import base64
import shutil
import subprocess
import threading
import time

try:
    import numpy as np
except ImportError:  # python3-numpy is a dependency of the package, but keep running without it
    np = None

RATE = 44100
CHANNELS = 2
FPS = 30
WINDOW = 2048
BANDS = 64


def capture_command():
    """A command that writes what the speakers play as raw 16-bit stereo, or None."""
    if shutil.which("parec"):
        return ["parec", "--device=@DEFAULT_MONITOR@", "--format=s16le", f"--rate={RATE}",
                f"--channels={CHANNELS}", "--latency-msec=30", "--raw"]
    if shutil.which("pw-record"):
        return ["pw-record", "-P", "stream.capture.sink=true", "--format=s16", f"--rate={RATE}",
                f"--channels={CHANNELS}", "-"]
    return None


def available():
    if np is None:
        return False, "Install python3-numpy for sound-reactive wallpapers."
    if not capture_command():
        return False, "Install pulseaudio-utils (parec) or pipewire-bin (pw-record) for sound-reactive wallpapers."
    return True, ""


class Analyzer:
    """Turns stereo samples into Wallpaper Engine bars and Shadertoy's audio texture."""

    def __init__(self):
        self.window = np.hanning(WINDOW).astype(np.float32)
        freqs = np.fft.rfftfreq(WINDOW, 1 / RATE)
        edges = np.geomspace(30, 16000, BANDS + 1)
        self.band_bins = [np.where((freqs >= lo) & (freqs < hi))[0] for lo, hi in zip(edges[:-1], edges[1:])]
        # bands narrower than one bin borrow the nearest bin
        self.band_bins = [b if len(b) else np.array([int(np.argmin(np.abs(freqs - (lo + hi) / 2)))])
                          for b, lo, hi in zip(self.band_bins, edges[:-1], edges[1:])]
        self.bars = np.zeros(BANDS * 2, dtype=np.float32)
        self.fft = np.zeros(512, dtype=np.float32)

    def frame(self, samples):
        """samples: float32 array (WINDOW, 2) in -1..1. Returns (bars: list of 128 floats, texture: base64)."""
        out = []
        for ch in range(2):
            spec = np.abs(np.fft.rfft(samples[:, ch] * self.window)) / (WINDOW / 4)
            levels = np.array([spec[b].max() for b in self.band_bins], dtype=np.float32)
            levels = np.clip((20 * np.log10(levels + 1e-9) + 60) / 60, 0, 1.2)  # -60 dB .. 0 dB -> 0 .. 1
            out.append(levels)
        target = np.concatenate(out)
        # fast attack, slower fall, like Wallpaper Engine
        rise = target > self.bars
        self.bars = np.where(rise, target, self.bars * 0.8 + target * 0.2)
        mono = samples.mean(axis=1)
        spec = np.abs(np.fft.rfft(mono[-1024:] * np.hanning(1024))) / 256
        db = np.clip((20 * np.log10(spec[:512] + 1e-9) + 100) / 70, 0, 1)  # Shadertoy maps -100..-30 dB
        self.fft = self.fft * 0.8 + db * 0.2
        wave = np.clip(mono[-512:] * 0.5 + 0.5, 0, 1)
        tex = np.concatenate([self.fft, wave]) * 255
        return [round(float(v), 3) for v in self.bars], base64.b64encode(tex.astype(np.uint8).tobytes()).decode()


class AudioMonitor:
    """Runs the capture while someone wants sound; calls on_frame(bars, texture) about 30 times a second."""

    def __init__(self, on_frame, log=print):
        self.on_frame = on_frame
        self.log = log
        self.proc = None
        self.thread = None
        self.wanted = False
        self.problem = ""

    @property
    def running(self):
        return bool(self.proc and self.proc.poll() is None)

    def set_wanted(self, on):
        on = bool(on)
        if on == self.wanted:
            return
        self.wanted = on
        if on:
            self._start()
        else:
            self._stop()

    def _start(self):
        ok, why = available()
        if not ok:
            if why != self.problem:
                self.log("sound reactions off: " + why)
            self.problem = why
            return
        cmd = capture_command()
        try:
            self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
        except OSError as exc:
            self.problem = f"Couldn't listen to the speakers: {exc}"
            self.log(self.problem)
            return
        self.problem = ""
        self.log("listening to the speakers for sound-reactive wallpapers (" + cmd[0] + ")")
        self.thread = threading.Thread(target=self._read, args=(self.proc,), daemon=True)
        self.thread.start()

    def _stop(self):
        proc, self.proc = self.proc, None
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(2)
            except subprocess.TimeoutExpired:
                proc.kill()

    def _read(self, proc):
        analyzer = Analyzer()
        buf = np.zeros((WINDOW, 2), dtype=np.float32)
        chunk = RATE // FPS
        need = chunk * CHANNELS * 2
        silent_frames = 0
        while proc is self.proc and proc.poll() is None:
            data = proc.stdout.read(need)
            if not data or len(data) < 4:
                break
            n = len(data) // 4
            samples = np.frombuffer(data[:n * 4], dtype="<i2").astype(np.float32).reshape(-1, 2) / 32768
            buf = np.concatenate([buf[n:], samples]) if n < WINDOW else samples[-WINDOW:]
            bars, tex = analyzer.frame(buf)
            # after a few silent seconds, send one quiet frame and then nothing until sound comes back
            if max(bars) < 0.01:
                silent_frames += 1
                if silent_frames > FPS * 3:
                    continue
            else:
                silent_frames = 0
            try:
                self.on_frame(bars, tex)
            except Exception as exc:  # a closed window; keep listening for the others
                self.log(f"sound frame not delivered: {exc}")
        if proc is self.proc and self.wanted:
            # the capture stopped on its own (sound server restarted): try again shortly
            time.sleep(2)
            if proc is self.proc and self.wanted:
                self.proc = None
                self._start()
