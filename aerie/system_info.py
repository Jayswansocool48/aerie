"""Reads CPU, memory, disk, battery and uptime from /proc and /sys. Nothing leaves the computer."""

import os
import shutil
import socket
import time
from pathlib import Path


class SystemInfo:
    def __init__(self):
        self._last_cpu = _read_cpu_times()
        self._last_net = (_read_net_bytes(), time.monotonic())

    def snapshot(self):
        now = _read_cpu_times()
        cpu = 0.0
        if now and self._last_cpu:
            idle = now[0] - self._last_cpu[0]
            total = now[1] - self._last_cpu[1]
            cpu = round(100.0 * (1 - idle / total), 1) if total > 0 else 0.0
        self._last_cpu = now
        net_now, t_now = _read_net_bytes(), time.monotonic()
        (net_before, t_before) = self._last_net
        elapsed = max(t_now - t_before, 0.001)
        net = None
        if net_now and net_before:
            net = {"down": max(0, int((net_now[0] - net_before[0]) / elapsed)),
                   "up": max(0, int((net_now[1] - net_before[1]) / elapsed))}
        self._last_net = (net_now, t_now)
        return {
            "network": net,
            "cpu": cpu,
            "memory": _memory(),
            "disk": _disk(),
            "battery": _battery(),
            "uptime": _uptime(),
            "gpu": _gpu(),
            "temperature": _cpu_temp(),
            "cpuName": _cpu_name(),
            "hostname": socket.gethostname(),
            "user": os.environ.get("USER", ""),
            "time": time.time(),
        }


def _read_cpu_times():
    try:
        with open("/proc/stat") as f:
            parts = [int(x) for x in f.readline().split()[1:]]
        idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
        return idle, sum(parts)
    except (OSError, ValueError, IndexError):
        return None


def _read_net_bytes():
    """Total bytes received and sent on all network interfaces except loopback."""
    try:
        rx = tx = 0
        with open("/proc/net/dev") as f:
            for line in f.readlines()[2:]:
                name, data = line.split(":", 1)
                if name.strip() == "lo":
                    continue
                fields = data.split()
                rx += int(fields[0])
                tx += int(fields[8])
        return rx, tx
    except (OSError, ValueError, IndexError):
        return None


def _memory():
    info = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                key, value = line.split(":", 1)
                info[key] = int(value.split()[0]) * 1024
    except (OSError, ValueError):
        return None
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", 0)
    used = total - available
    return {"total": total, "used": used, "percent": round(100 * used / total, 1) if total else 0}


def _disk():
    try:
        usage = shutil.disk_usage(str(Path.home()))
    except OSError:
        return None
    return {"total": usage.total, "used": usage.used, "percent": round(100 * usage.used / usage.total, 1)}


def _battery():
    for supply in sorted(Path("/sys/class/power_supply").glob("BAT*")):
        try:
            capacity = int((supply / "capacity").read_text().strip())
            status = (supply / "status").read_text().strip()
            return {"percent": capacity, "status": status}
        except (OSError, ValueError):
            continue
    return None


def _uptime():
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except (OSError, ValueError):
        return 0


def _cpu_name():
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                return " ".join(line.split(":", 1)[1].replace("(R)", "").replace("(TM)", "").split())[:60]
    except OSError:
        pass
    return ""


def _gpu():
    """How busy the graphics card is (AMD and Intel Arc report it; NVIDIA through nvidia-smi)."""
    for card in sorted(Path("/sys/class/drm").glob("card[0-9]")):
        busy = card / "device" / "gpu_busy_percent"
        try:
            percent = int(busy.read_text().strip())
        except (OSError, ValueError):
            continue
        used = total = None
        try:
            used = int((card / "device" / "mem_info_vram_used").read_text())
            total = int((card / "device" / "mem_info_vram_total").read_text())
        except (OSError, ValueError):
            pass
        return {"percent": percent, "memUsed": used, "memTotal": total}
    if shutil.which("nvidia-smi"):
        import subprocess
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total",
                                  "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=2).stdout
            p, used, total = (int(x) for x in out.splitlines()[0].split(","))
            return {"percent": p, "memUsed": used * 1048576, "memTotal": total * 1048576}
        except (OSError, ValueError, IndexError, subprocess.SubprocessError):
            pass
    return None


def _cpu_temp():
    """The processor temperature in °C, if the computer reports it."""
    best = None
    for hw in Path("/sys/class/hwmon").glob("hwmon*"):
        try:
            name = (hw / "name").read_text().strip()
        except OSError:
            continue
        if name not in ("k10temp", "coretemp", "zenpower", "cpu_thermal", "acpitz"):
            continue
        for t in sorted(hw.glob("temp*_input")):
            try:
                value = int(t.read_text()) / 1000
            except (OSError, ValueError):
                continue
            if 0 < value < 130:
                best = round(value)
                break
        if best is not None and name != "acpitz":
            break
    return best
