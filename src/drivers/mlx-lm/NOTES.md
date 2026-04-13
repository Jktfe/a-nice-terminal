# MlxLmDriver — RETIRED

**Agent:** mlx_lm (Apple MLX LM)  
**Status:** RETIRED (per CLAUDE.md project instructions)  
**Probe date:** 2026-04-14

---

## Status

mlx_lm is marked as **RETIRED** in project instructions. The Python module is not installed:

```
ModuleNotFoundError: No module named 'mlx_lm'
```

Wrapper scripts exist at `~/.local/bin/mlx_lm` and `~/.local/bin/mlx_lm.generate` but are non-functional without the Python package.

## Historical Notes

mlx_lm was a Python package for running quantised LLMs on Apple Silicon using the MLX framework. Usage was:

```bash
mlx_lm.generate --model <huggingface-model-id> --prompt "..." --max-tokens 100
```

It was a pure completion tool with no interactive TUI events. detect() would always return null.

This driver is a stub and will not be maintained.
