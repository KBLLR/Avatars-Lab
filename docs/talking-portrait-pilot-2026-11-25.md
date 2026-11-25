# Offline B3 talking-portrait pilot

The experimental Talking Portrait case plays the saved kbllr driving clip and
its reviewed MuseTalk MLX FP16 output. It uses the existing case catalog and
workbench shell. The operator accepted the port's declared MIT license for this
private pilot. Live chat remains on hold.

Enable the two-clip preview in a local dev or production-preview process by
setting `AVATAR_LABS_B3_RESEARCH_ROOT` to the existing MuseTalk research directory.
Open `/talking-portrait.html` using the server's `127.0.0.1` URL. Without that
setting, the case reports unavailable clips. The media bridge exposes the driving
MP4 and reviewed talking MP4 to loopback requests only. Keep the research files
and weights outside Git.

## Verification

TypeScript, the 14-route modernization contract, and the Vite production build
passed. Chrome decoded and played both clips through local dev and built preview.
The driving clip was 5.60 s and the talking render was 5.36 s. The browser checks
also covered byte ranges, unavailable media, and rejection of unlisted paths,
cross-site requests, and POST.

## FP16 SSD test

Use the verified internal `MuseTalk-1.5-fp16` directory as the explicit runner
`--weights` path. Record the runner's synchronized `timings_s.model_init` for
a verified uncached first load and independent immediately repeated warm loads.
Mark the cold result unverified if cache residency cannot be established. Avoid
a machine-wide cache purge. Compare against the previously measured 38–50 s
uncached USB load and record peak memory and cache conditions.

No SSD load was measured on November 25. Free plus purgeable memory was 1.21 GiB
after browser checks while GPT-OSS remained resident, below the previous run's
approximately 5.26 GB MLX peak. Recheck headroom before loading FP16.
