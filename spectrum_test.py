import time, numpy as np, sounddevice as sd

CHARS = " ▁▂▃▄▅▆▇█"

def callback(indata, frames, t, status):
    mono = indata.mean(axis=1)
    mag = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    bands = [b.mean() for b in np.array_split(mag, 32)]
    peak = max(bands) or 1e-9
    bar = "".join(CHARS[min(8, int(b / peak * 8))] for b in bands)
    print(bar + "  ", end="\r", flush=True)

with sd.InputStream(device=3, channels=2, samplerate=48000, blocksize=1024, callback=callback):
    time.sleep(10)
print()
