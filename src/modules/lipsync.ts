
// @ts-ignore
import { HeadTTS } from "@met4citizen/headtts";
// @ts-ignore
import { TalkingHead } from "@met4citizen/talkinghead";
import workerUrl from "@met4citizen/headtts/modules/worker-tts.mjs?url";

let headTTS: any = null;
let headRef: any = null;

export const initLipsync = async (head: any) => {
  headRef = head;
};

const ensureHeadTTS = async () => {
  if (headTTS) return headTTS;
  const absoluteWorkerUrl = new URL(workerUrl, window.location.href).href;
  headTTS = new HeadTTS({
    defaultVoice: "af_bella",
    defaultLanguage: "en-us",
    dictionaryURL: null,
    workerModule: absoluteWorkerUrl
  });
  await headTTS.connect();
  return headTTS;
};

export const speakWithLipsync = async (text: string) => {
  if (!headRef) {
      console.warn("Head reference missing");
      return;
  }

  try {
      const tts = await ensureHeadTTS();
      console.log("Generating lipsync audio for:", text);
      const audio = await tts.speak(text);
      // audio returned is likely an AudioBuffer or similar, or it handles playing internally? 
      // Wait, standard TalkingHead integration usually requires passing audio + subtitles/visemes to TalkingHead.speakAudio?
      // Or HeadTTS might have a way to output audio.
      
      // Based on docs "fully compatible with TalkingHead".
      // Usually means: head.speakAudio(audio, { audioBuffer: ... })
      
      // Let's assume HeadTTS.speak returns an object compatible with Reference or just plays it?
      // Actually, if it returns audio buffer and lipsync data, we pass it to head.
      
      // Let's look at the source again if needed, but for now let's try to pass the result to head.speakAudio
      // head.speakAudio(audio);
      
      // If we don't know the return type, let's log it first in usage or assume:
      // head.speakAudio(audio);
      
      await headRef.speakAudio(audio);

  } catch (e) {
      console.error("Lipsync speak failed:", e);
  }
};
