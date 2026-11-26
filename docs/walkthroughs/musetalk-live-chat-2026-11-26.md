# MuseTalk live chat walkthrough

1. Open the local Avatar Labs launcher and choose MuseTalk Live Chat.
2. Enter a short message to kbllr. Watch for the text reply first.
3. Leave Play video as frames arrive checked to try the fragmented MP4 stream. Press Play if the browser blocks autoplay. Uncheck it to use completed MP4 mode.
4. If memory pressure blocks a render, use Retry video once pressure returns to normal. The retry uses the same text and does not generate another model reply.

The local server reads the existing AVATAR_LABS_B3_RESEARCH_ROOT for the reviewed B3 driver and runner environment. AVATAR_LABS_MUSETALK_RUNNER can override the runner executable. AVATAR_LABS_MUSETALK_WEIGHTS can override the internal Core-X research FP16 directory. The Vite FaceLandmarker configuration supplies the existing model file. The harness does not download models or publish assets.

The first turn prepares a resident worker. Subsequent turns reuse it and start inference from streamed Gateway PCM. Expect the first displayed frame timing to exclude the language-model reply. The progressive mode can pause between fragments when the render rate is below the 25 fps media clock.

## Character drivers

Open Character on the left of the chat header. Choose a portrait under Characters, a control or test clip under Matched takes, or a clip under Uploads. Selecting a card closes the gallery and switches the portrait and conversation. The first render for a different driver may need face preparation, and the worker keeps the MuseTalk weights loaded.

Use Upload video in the gallery for an MP4 or MOV up to 64 MiB and 30 seconds. Use a locally authorized clip with a clear face. The harness validates the file, saves it privately in the Core-X research directory under `chat-drivers`, and selects it automatically. Uploads remain available after a restart.

Open Voice on the right of the chat header and choose a local TTS voice for the current character. This browser remembers it when you switch characters or reload. A character's reviewed clip and matched variants share the same voice. Choose Lullabot to return that character to the default voice.
