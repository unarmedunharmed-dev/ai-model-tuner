# AI Model Tuner

**Free desktop tool that automatically finds the optimal AI inference settings for your Windows machine.**

Stop crashing your computer and guessing at settings. AI Model Tuner benchmarks your hardware and gives you the perfect configuration in minutes.

![AI Model Tuner](docs/logo.png)

## Why?

I couldn't afford cloud AI subscriptions, so I started running models locally on Windows. But getting the settings right — batch size, precision, thread count — was a nightmare. I lost count of how many times I crashed my PC with the wrong settings.

So I built this tool. It does the hard work for you.

## Features

- **Hardware-Aware Benchmarking** — Detects your exact CPU, GPU, and memory. Tests hundreds of parameter combos tailored to your machine.
- **One-Click Optimization** — Run a single benchmark, get ready-to-use optimal settings.
- **Performance Reports** — See latency, throughput, and memory for every configuration.
- **Export & Integrate** — Export configs for ONNX, TensorRT, DirectML. (Pro)
- **Batch Processing** — Optimize multiple models at once. (Pro)
- **Precision Tuning** — Fine-tune FP16, INT8, and mixed precision. (Pro)

## Download

- **Free version** — [Download portable EXE](https://github.com/unarmedunharmed-dev/ai-model-tuner/releases/download/v1.0.0/AI.Model.Tuner.1.0.0.exe)
- **Pro version ($20)** — [Buy via PayPal](https://paypal.me/Unarmed/pro)

## Requirements

- Windows 10 or 11 (64-bit)
- Intel/AMD CPU or NVIDIA/AMD GPU
- 8GB RAM recommended

## Built With

- [Electron](https://www.electronjs.org/)
- [systeminformation](https://systeminformation.io/)

## License

MIT
