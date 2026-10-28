"""Muse Glimmer 30B (Meta open weights, Apache 2.0) behind vLLM's OpenAI-compatible server, on Modal.

Why: Fireworks removed Glimmer from serverless on 2026-09-25 (on-demand deployments only), so this is the
pay-per-second fallback for FixCam's watcher. Scales to zero when idle.

DEPLOY (not done yet):
  1. pip install modal && modal setup
  2. modal secret create fixcam-glimmer VLLM_API_KEY=<make up a long random string>
  3. modal deploy modal/glimmer.py
     -> prints https://<workspace>--fixcam-glimmer-serve.modal.run
  4. In fixcam/.env.local:
       WATCHER_BASE_URL=https://<workspace>--fixcam-glimmer-serve.modal.run/v1
       WATCHER_API_KEY=<same string as step 2>
       WATCHER_MODEL=muse-glimmer
  5. Warm it before the demo (first start downloads ~60 GB of weights into a Volume, later cold starts
     take a few minutes):  curl -H "Authorization: Bearer $KEY" https://...modal.run/v1/models
  Then: npx tsx --env-file=.env.local scripts/watch-smoke.mts

Cost: one H100 at Modal's per-second rate (~$4/h) only while a container is up; scaledown after 10 idle min.
If the vllm/vllm-openai:muse-glimmer image fails on Modal's GPU driver (it is built for CUDA 13), switch to
  modal.Image.from_registry("nvidia/cuda:13.0.0-devel-ubuntu24.04", add_python="3.12").pip_install("vllm")
using the vLLM version named in Meta's official Glimmer recipe.
"""

import os
import subprocess

import modal

MODEL = "meta-models/Muse-Glimmer-30B"  # bf16, ~60 GB; Meta recommends ~72 GB VRAM
SERVED_NAME = "muse-glimmer"
PORT = 8000
GPU = os.environ.get("GLIMMER_GPU", "H100")  # H100 80 GB is enough with the short context below; "H200" for headroom

image = (
    modal.Image.from_registry("vllm/vllm-openai:muse-glimmer")
    .entrypoint([])
)
hf_cache = modal.Volume.from_name("fixcam-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("fixcam-vllm-cache", create_if_missing=True)

app = modal.App("fixcam-glimmer")


@app.function(
    image=image,
    gpu=GPU,
    scaledown_window=10 * 60,
    timeout=24 * 60 * 60,
    volumes={"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache},
    secrets=[modal.Secret.from_name("fixcam-glimmer")],  # VLLM_API_KEY (add HF_TOKEN here if the repo is gated)
)
@modal.concurrent(max_inputs=16)
@modal.web_server(port=PORT, startup_timeout=30 * 60)
def serve():
    cmd = [
        "vllm", "serve", MODEL,
        "--served-model-name", SERVED_NAME,
        "--host", "0.0.0.0", "--port", str(PORT),
        "--api-key", os.environ["VLLM_API_KEY"],
        "--tensor-parallel-size", "1",
        "--reasoning-parser", "muse_glimmer",  # thinking goes to message.reasoning, content stays clean
        "--generation-config", "auto",  # checkpoint's sampling + stop tokens
        "--max-model-len", "8300",  # watcher prompts are tiny; keeps KV cache inside 80 GB
        "--gpu-memory-utilization", "0.9",
        "--limit-mm-per-prompt", '{"image": 1}',
    ]
    subprocess.Popen(cmd)
