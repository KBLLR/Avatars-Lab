/// <reference types="vite/client" />

declare module '@met4citizen/talkinghead' {
  export class TalkingHead {
    constructor(element: HTMLElement, options?: any);
    [key: string]: any;
  }
}
declare module '@met4citizen/headaudio';
declare module '@met4citizen/headtts';
declare module '@met4citizen/headaudio/dist/headaudio.min.mjs' {
  export class HeadAudio extends AudioWorkletNode {
    constructor(context: AudioContext, options?: any);
    loadModel(url: string): Promise<void>;
    update(dt: number): void;
    onvalue: (key: string, value: number) => void;
  }
}

declare module '@met4citizen/headaudio/dist/*.bin?url' {
  const content: string;
  export default content;
}

declare module '*?url' {
  const content: string;
  export default content;
}

interface Window {
  __headaudioResult: {
    ready: boolean;
    eventCount: number;
    keys: Set<any>;
    errors: string[];
  };
}
