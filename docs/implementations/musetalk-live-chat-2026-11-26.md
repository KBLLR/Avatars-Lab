# MuseTalk live chat harness

The harness is a local turn-based chat. Avatar Labs sends the current prompt and recent turns to the local Gateway Responses API, shows the text, and gives the same reply to the resident MuseTalk worker. The reviewed B3 driver represents kbllr. MuseTalk 1.5 FP16 renders against Gateway PCM. The optional fragmented MP4 path sends media while the runner writes frames. It uses the browser's Media Source Extensions and the same rendered frame and audio timestamps. Completed MP4 mode is also available.

Render requests are loopback-only. The middleware bounds the payload, runs one job at a time, checks macOS memory pressure, and stops its worker on disconnect or timeout. Drafts live under the operating system's temporary directory. The face cache and weights live under Core-X's existing internal research directory unless the weights are explicitly configured.

The harness can start playback of completed segments before the full reply finishes rendering. Real-time acceptance requires first playable media with conversational latency and sustained generation at the 25 fps playback clock. The resident trial demonstrates incremental input and output while leaving sustained throughput below the playback clock. Faster inference and shorter model reply latency remain open.

## Resident worker and streaming speech

The local server now owns one on-demand Python subprocess. It prepares the B3 face and loads MuseTalk once, then processes turns serially over standard input. The process releases on server shutdown or a failed or disconnected render. Its model and prepared face stay in memory across successful turns.

The worker consumes mono Gateway PCM, concurrently feeds the muxer, and builds Whisper prompts from overlapping short audio windows with four frames of lookahead. The short-window features differ from the offline runner's full-utterance Whisper encoding. The browser reports time to its first displayed frame from the render request. Measurements distinguish that latency, the full prompt-to-video turn, and sustained output FPS after the first rendered frame.


## Local verification

With GPT-OSS still loaded, worker turn 3 displayed its first browser frame 3.405 s after the text reply and 51.633 s after prompt submission. The worker generated 114 frames at 10.65 FPS sustained after the first written frame, versus the 25 FPS media clock. The first frame was written at 2.095 s and TTS reached EOF at 2.507 s, confirming overlap. The browser finished with a playable 800 × 450 clip and H.264/AAC track durations within 0.1 ms. The worker remained resident at roughly 2.1 GB process footprint. Swap fluctuated substantially during the trials despite normal pressure readings, so these are observations from the current desktop load.

## Compiled decoder and optional frame blending

The live worker compiles FP16 VAE decode with clamping and pixel packing on the GPU. The eight-frame decoder profile dropped from 349 ms to 319 ms. Against the eager pixel output, the compiled decoder's 99th-percentile difference was one 8-bit level and the maximum was two. The default still infers every frame.

The experimental blending toggle infers alternate mouth crops and blends between adjacent crops before pasting onto each source frame. One direct warm test produced 22.11 rendered output FPS (71 inferred and 71 blended frames). Two warm browser tests measured 9.91 and 6.56 sustained output FPS, so blending remains opt-in. These runs did not control GPU contention, system paging, or TTS duration.

The default warm browser rerun displayed its first frame 3.282 s after the text reply and 36.051 s after prompt submission. The worker sustained 13.19 FPS for 120 inferred frames. The earlier browser run measured 3.405 s and 10.65 FPS. GPT-OSS stayed loaded, and the optimized worker remained resident after the test. Output media remains encoded at 25 FPS.

## Driver selection

The centered chat window uses the Core-X MACOS regular-glass treatment with a square portrait stage, scrollable thread and bottom composer. The header opens separate character and voice galleries. The character gallery uses the existing portrait review catalog and B3 source. Its local thumbnail route extracts and caches a 256-pixel preview from each cataloged source clip. A turn can pass only a catalog ID. The server resolves the actual file. Uploads get generated IDs and live outside the checkout. The worker retains one prepared driver at a time and caches face data by source digest and decoded resolution. Its model stays loaded when the driver changes.

The voice gallery uses the Gateway's local voice catalog. The browser saves one preference per character. Matched drivers share their character's voice, and uploads use their generated IDs. The render middleware validates an explicit voice against the catalog and forwards it to the resident worker for each Qwen PCM request. The original Lullabot voice remains the default.
