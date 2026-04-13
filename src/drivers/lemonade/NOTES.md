# LemonadeDriver — Observations

**Agent:** AMD Lemonade  
**Installed at:** `/usr/local/bin/lemonade`  
**Probe date:** 2026-04-14

---

## NOT A CLI AGENT

Lemonade is an **Electron-based desktop GUI application**. The `/usr/local/bin/lemonade` binary launches a system tray + Electron process, not a CLI completion tool.

Invoking `lemonade --help` caused:
```
--- STARTING TRAY MANUALLY ---
Spawning tray process...
[FATAL] Unable to find helper app
Tray launched! (PID: 76949)
Beacon listener started on 0.0.0.0:8000
GPU process exited unexpectedly: exit_code=5
Network service crashed, restarting service.
```

The process repeatedly crashes (GPU + network service crashes in a loop).

## Potential Future Integration

Lemonade exposes a **Beacon API on `0.0.0.0:8000`** when running. A future `lemonade-http` driver should:
- Use `HttpDriverConfig` instead of `TmuxDriverConfig`
- Target the Beacon API endpoint
- Not use tmux capture at all

This driver stub is a placeholder only.
