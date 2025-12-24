import type { TalkingHead } from "@met4citizen/talkinghead";
import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import workletUrl from "@met4citizen/headaudio/dist/headworklet.min.mjs?url";
import modelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";
import { getMlxConfig } from "../mlx-config";

export type MlxConfig = ReturnType<typeof getMlxConfig>;

export type ConversationMode = "push" | "vad";

export interface ConversationState {
  mode: ConversationMode;
  sessionActive: boolean;
  isRecording: boolean;
  messages: Array<Record<string, any>>;
  busy: boolean;
}

export interface ConversationCallbacks {
  onStatusUpdate: (text: string) => void;
  onLogMessage: (role: "user" | "assistant" | "tool", text: string) => void;
  onModeChange: (mode: ConversationMode, isRecording: boolean) => void;
  onAudioLevel: (level: number) => void; // 0-100
}

export class ConversationManager {
  private config: MlxConfig;
  private head: TalkingHead | null = null;
  private headaudio: HeadAudio | null = null;
  
  // Audio State
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private silenceGain: GainNode | null = null;
  private vadBuffer = new Float32Array(2048);
  
  // VAD/Recording State
  private state: ConversationState = {
    mode: "push",
    sessionActive: false,
    isRecording: false,
    messages: [],
    busy: false
  };
  
  private recordStart = 0;
  private lastVoiceAt = 0;
  private audioChunks: Float32Array[] = [];
  private totalSamples = 0;
  
  // VAD Config
  private vadThresholdDb = -48;
  private vadSilenceMs = 600;
  
  private callbacks: ConversationCallbacks;

  private functionDefs: any[];

  constructor(callbacks: ConversationCallbacks) {
    this.config = getMlxConfig();
    this.callbacks = callbacks;
    this.functionDefs = this.getFunctionDefs();
    
    // Initial system message
    this.state.messages.push({
      role: "system",
      content: [
        "You are Julia, a clear and conversational assistant.",
        "Listen for user speech, wait for a brief pause before responding.",
        "If unclear, ask a brief clarifying question.",
        "You can control your avatar with function calls.",
        "Use gestures and mood shifts to amplify intent."
      ].join("\n")
    });
  }

  public setHead(head: TalkingHead) {
    this.head = head;
    this.initHeadAudio();
  }

  public async startSession() {
    this.state.sessionActive = true;
    this.callbacks.onStatusUpdate("Session started.");
  }

  public async stopSession() {
    this.state.sessionActive = false;
    this.stopRecording();
    this.resetMicNodes();
    this.callbacks.onStatusUpdate("Session stopped.");
  }

  public setMode(mode: ConversationMode) {
    this.state.mode = mode;
    this.callbacks.onModeChange(this.state.mode, this.state.isRecording);
    if (mode === "vad") {
       this.ensureMic().then(() => {
          requestAnimationFrame(this.runVadLoop.bind(this));
       });
    }
  }

  public setVadSettings(thresholdDb: number, silenceMs: number) {
     this.vadThresholdDb = thresholdDb;
     this.vadSilenceMs = silenceMs;
  }

  public async startRecording(reason: "vad" | "manual") {
    if (this.state.isRecording || !this.micProcessor || !this.head) return;
    
    this.state.isRecording = true;
    this.recordStart = performance.now();
    this.audioChunks = [];
    this.totalSamples = 0;
    
    this.callbacks.onStatusUpdate(reason === "vad" ? "Listening..." : "Recording...");
    this.callbacks.onModeChange(this.state.mode, true);
  }

  public async stopRecording() {
    if (!this.state.isRecording || !this.head) return;
    
    this.state.isRecording = false;
    this.callbacks.onModeChange(this.state.mode, false);
    
    const samples = this.mergeChunks(this.audioChunks, this.totalSamples);
    if (!samples.length) {
      this.callbacks.onStatusUpdate("No speech detected.");
      return;
    }

    const wavBuffer = this.encodeWav(samples, this.head.audioCtx.sampleRate);
    this.callbacks.onStatusUpdate("Transcribing...");
    
    try {
      const text = await this.sendToStt(wavBuffer);
      if (!text) {
        this.callbacks.onStatusUpdate("No transcript returned.");
        return;
      }
      this.callbacks.onStatusUpdate("Processing...");
      await this.handleUserText(text);
    } catch (e: any) {
       this.callbacks.onStatusUpdate(`Error: ${e.message}`);
    }
  }

  public async handleUserText(text: string) {
    if (!text) return;
    if (!this.config.llmModel) {
      this.callbacks.onStatusUpdate("Missing VITE_MLX_DEFAULT_LLM_MODEL");
      return;
    }

    this.callbacks.onLogMessage("user", text);
    this.state.messages.push({ role: "user", content: text });
    this.callbacks.onStatusUpdate("Thinking...");

    try {
      const llmResponse = await this.callLLM(this.state.messages);
      const assistant = llmResponse?.choices?.[0]?.message;
      if (!assistant) {
        throw new Error("LLM response missing assistant message.");
      }

      this.state.messages.push(assistant);

      if (assistant.tool_calls?.length) {
        const toolMessages = [] as Array<Record<string, any>>;
        for (const call of assistant.tool_calls) {
          const name = call.function?.name;
          const rawArgs = call.function?.arguments || "{}";
          let args = {};
          try {
            args = JSON.parse(rawArgs);
          } catch {
            args = {};
          }
          
          const result = this.applyFunctionCall(name, args);
          
          toolMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result ?? { ok: true })
          });
          this.callbacks.onLogMessage("tool", `${name}: ${rawArgs}`);
        }

        this.state.messages.push(...toolMessages);

        if (!assistant.content) {
          const followUp = await this.callLLM(this.state.messages);
          const followMsg = followUp?.choices?.[0]?.message;
          if (followMsg?.content) {
            this.state.messages.push(followMsg);
            this.callbacks.onLogMessage("assistant", followMsg.content);
            await this.speakResponse(followMsg.content);
            return;
          }
        }
      }

      if (assistant.content) {
        this.callbacks.onLogMessage("assistant", assistant.content);
        await this.speakResponse(assistant.content);
      }
    } catch (error: any) {
       console.error(error);
       this.callbacks.onStatusUpdate(`Error: ${error.message}`);
    }
  }

  private async callLLM(messages: Array<Record<string, any>>) {
    const response = await fetch(`${this.config.llmBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.llmModel,
        messages,
        tools: this.functionDefs,
        tool_choice: "auto"
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`LLM error (${response.status}): ${detail}`);
    }

    return response.json();
  }

  private async speakResponse(text: string) {
    if (!this.head) return;

    // Use configured voice or fallback
    const voice = this.config.ttsVoice; 
    
    // We can pull voiceInput from UI if passed or assume config
    const response = await fetch(`${this.config.audioBaseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.ttsModel,
        input: text,
        voice,
        response_format: "wav",
        speed: 1.0
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`TTS error (${response.status}): ${detail}`);
    }

    const wavBuffer = await response.arrayBuffer();
    await this.head.audioCtx.resume();
    const audioBuffer = await this.head.audioCtx.decodeAudioData(wavBuffer.slice(0));

    const pcm = new Int16Array(audioBuffer.length);
    const channel = audioBuffer.getChannelData(0);
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
    for (let i = 0; i < channel.length; i += 1) {
      const sample = clamp(channel[i], -1, 1);
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    await this.head.streamStart(
      {
        sampleRate: audioBuffer.sampleRate,
        lipsyncType: "visemes",
        gain: 0.75,
        waitForAudioChunks: false
      },
      () => {
        this.callbacks.onStatusUpdate("Speaking...");
      },
      () => {
        this.callbacks.onStatusUpdate("Listening...");
      }
    );

    this.head.streamAudio({
      audio: pcm.buffer
    });
    this.head.streamNotifyEnd();
  }

  private async sendToStt(wavBuffer: ArrayBuffer) {
     if (!this.config.sttModel) {
        throw new Error("Missing VITE_MLX_DEFAULT_STT_MODEL");
     }
     const form = new FormData();
     form.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "speech.wav");
     form.append("model", this.config.sttModel);

     const response = await fetch(`${this.config.audioBaseUrl}/v1/audio/transcriptions`, {
       method: "POST",
       body: form
     });

     if (!response.ok) {
        const detail = await response.text();
        throw new Error(`STT error (${response.status}): ${detail}`);
     }

     const payload = await response.json();
     return payload?.text || "";
  }

  private async ensureMic() {
      if (!this.head) return;
      if (this.micStream) return;
      
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.resetMicNodes();
        
        const ctx = this.head.audioCtx;
        this.micSource = ctx.createMediaStreamSource(this.micStream);
        this.micAnalyser = ctx.createAnalyser();
        this.micAnalyser.fftSize = 2048;
        this.micSource.connect(this.micAnalyser);
        
        this.micProcessor = ctx.createScriptProcessor(4096, 1, 1);
        this.silenceGain = ctx.createGain();
        this.silenceGain.gain.value = 0;
        
        this.micSource.connect(this.micProcessor);
        this.micProcessor.connect(this.silenceGain);
        this.silenceGain.connect(ctx.destination);
        
        this.micProcessor.onaudioprocess = (event) => {
            if (!this.state.isRecording) return;
            const input = event.inputBuffer.getChannelData(0);
            this.audioChunks.push(new Float32Array(input));
            this.totalSamples += input.length;
        };
      } catch (e) {
          console.error("Mic setup failed", e);
          this.callbacks.onStatusUpdate("Mic access denied or failed.");
      }
  }

  private resetMicNodes() {
    this.micSource?.disconnect();
    this.micAnalyser?.disconnect();
    this.micProcessor?.disconnect();
    this.silenceGain?.disconnect();
    this.micSource = null;
    this.micAnalyser = null;
    this.micProcessor = null;
    this.silenceGain = null;
  }
  
  private runVadLoop() {
      if (!this.state.sessionActive || this.state.mode !== "vad" || !this.micAnalyser) return;
      
      this.micAnalyser.getFloatTimeDomainData(this.vadBuffer);
      const rms = Math.sqrt(this.vadBuffer.reduce((sum, v) => sum + v*v, 0) / this.vadBuffer.length);
      
      // Callback for UI meter
      this.callbacks.onAudioLevel(rms);
      
      const db = 20 * Math.log10(rms || 1e-6);
      const now = performance.now();
      
      if (db > this.vadThresholdDb && !this.head?.isSpeaking) {
          this.lastVoiceAt = now;
          if (!this.state.isRecording) {
              this.startRecording("vad");
          }
      }
      
      if (this.state.isRecording) {
          const elapsed = now - this.recordStart;
          if (elapsed > 250 && now - this.lastVoiceAt > this.vadSilenceMs) {
              this.stopRecording().catch(console.error);
          }
      }
      
      requestAnimationFrame(this.runVadLoop.bind(this));
  }

  private async initHeadAudio() {
      if (!this.head) return;
      if (this.headaudio) return;
      
      try {
          await this.head.audioCtx.audioWorklet.addModule(workletUrl);
          this.headaudio = new HeadAudio(this.head.audioCtx, {
            processorOptions: { visemeEventsEnabled: true }
          });
          await this.headaudio.loadModel(modelUrl);
          
          this.head.audioSpeechGainNode.connect(this.headaudio);
          this.headaudio.onvalue = (key, value) => {
             if (this.head?.mtAvatar?.[key]) {
                Object.assign(this.head.mtAvatar[key], { newvalue: value, needsUpdate: true });
             }
          };
          this.head.opt.update = this.headaudio.update.bind(this.headaudio);
          (this.headaudio as any).onstarted = () => {
             this.head?.lookAtCamera(400);
             this.head?.speakWithHands();
          };
      } catch (e) {
          console.error("HeadAudio init failed", e);
      }
  }
  
  // Helpers from original file
  private mergeChunks(chunks: Float32Array[], totalSamples: number) {
      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
      }
      return merged;
  }
  
  private encodeWav(samples: Float32Array, sampleRate: number) {
      const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      const writeString = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i += 1) {
          view.setUint8(offset + i, value.charCodeAt(i));
        }
      };

      writeString(0, "RIFF");
      view.setUint32(4, 36 + samples.length * 2, true);
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, "data");
      view.setUint32(40, samples.length * 2, true);

      let offset = 44;
      for (let i = 0; i < samples.length; i += 1) {
        const s = clamp(samples[i], -1, 1);
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }

      return buffer;
  }

  private applyFunctionCall(name: string, args: any) {
    if (!this.head) {
        return { ok: false, error: "Avatar not initialized." };
    }
    // Copied function handling logic
    switch (name) {
        case "set_mood":
        if (args?.mood) {
            this.head.setMood(args.mood);
            return { ok: true };
        }
        return { ok: false, error: "Missing mood." };
        case "play_gesture":
        case "make_hand_gesture":
        if (args?.gesture) {
            this.head.playGesture(args.gesture, args.duration ?? 3, args.mirror ?? false, args.ms ?? 1000);
            this.head.speakWithHands();
            return { ok: true };
        }
        return { ok: false, error: "Missing gesture." };
        case "stop_gesture":
        this.head.stopGesture(args?.ms ?? 1000);
        return { ok: true };
        case "make_facial_expression":
        if (args?.emoji) {
            this.head.speakEmoji(args.emoji);
            return { ok: true };
        }
        return { ok: false, error: "Missing emoji." };
        case "speak_break":
        if (typeof args?.duration_ms === "number") {
            this.head.speakBreak(args.duration_ms);
            return { ok: true };
        }
        return { ok: false, error: "Missing duration_ms." };
        case "speak_marker":
        if (args?.marker) {
            const marker = String(args.marker);
            this.head.speakMarker(() => {
                this.callbacks.onLogMessage("tool", `marker: ${marker}`);
            });
            return { ok: true };
        }
        return { ok: false, error: "Missing marker." };
        case "look_at":
        if (typeof args?.x === "number" && typeof args?.y === "number") {
            this.head.lookAt(args.x, args.y, args.t ?? 600);
            return { ok: true };
        }
        return { ok: false, error: "Missing x/y." };
        case "look_at_camera":
        case "make_eye_contact":
        if (typeof args?.t === "number") {
            this.head.lookAtCamera(args.t);
            return { ok: true };
        }
        return { ok: false, error: "Missing t." };
        case "set_value":
        if (args?.mt && typeof args?.value === "number") {
            this.head.setValue(args.mt, args.value, args.ms ?? null);
            return { ok: true };
        }
        return { ok: false, error: "Missing mt/value." };
        case "get_value":
        if (args?.mt) {
            const value = this.head.getValue(args.mt);
            return { ok: true, value };
        }
        return { ok: false, error: "Missing mt." };
        case "play_background_audio":
        if (args?.url) {
            this.head.playBackgroundAudio(args.url);
            if (typeof args.volume === "number") {
            this.head.setMixerGain(null, Math.max(0, Math.min(1, args.volume)));
            }
            return { ok: true };
        }
        return { ok: false, error: "Missing url." };
        case "stop_background_audio":
        this.head.stopBackgroundAudio();
        return { ok: true };
        case "start":
        this.head.start();
        return { ok: true };
        case "stop":
        this.head.stop();
        return { ok: true };
        // Listening controls handled by UI usually, but could be exposed
        case "start_listening": return { ok: true }; // Handled by manager state
        case "stop_listening": return { ok: true };
        default:
        return { ok: false, error: `Unknown function ${name}` };
    }
  }

  private getFunctionDefs() {
      // Return the list of function definitions used in mlx-conversation.ts
      return [
        {
            type: "function",
            name: "set_mood",
            description: "Set the avatar mood (applies mood animations and morph baselines).",
            parameters: {
            type: "object",
            properties: {
                mood: {
                type: "string",
                enum: ["neutral", "happy", "angry", "sad", "fear", "disgust", "love", "sleep"],
                description: "Mood name"
                }
            },
            required: ["mood"]
            }
        },
        {
            type: "function",
            name: "play_gesture",
            description: "Play a named hand gesture or animated emoji.",
            parameters: {
            type: "object",
            properties: {
                gesture: {
                type: "string",
                description: "Gesture name or emoji (e.g. 'handup', 'index', 'ok', 'thumbup', 'thumbdown', 'side', 'shrug', 'namaste' or emoji character)"
                },
                duration: {
                type: "number",
                description: "Duration in seconds (optional)."
                },
                mirror: {
                type: "boolean",
                description: "If true, mirror gesture to the other hand (optional)."
                },
                ms: {
                type: "number",
                description: "Transition time in milliseconds (optional)."
                }
            },
            required: ["gesture"]
            }
        },
        // ... (Adding other function defs abbreviated for brevity, relying on the logic already existing or adding them all)
        {
            type: "function",
            name: "stop_gesture",
            description: "Stop current gesture (graceful transition).",
            parameters: {
            type: "object",
            properties: {
                ms: { type: "number", description: "Transition time in milliseconds (optional)." }
            }
            }
        },
        {
            type: "function",
            name: "make_facial_expression",
            description: "Trigger a facial expression using an emoji template.",
            parameters: {
            type: "object",
            properties: {
                emoji: { type: "string", description: "Single face emoji or emoji name to play." },
                duration: { type: "number", description: "Duration in seconds (optional)." }
            },
            required: ["emoji"]
            }
        },
        {
            type: "function",
            name: "speak_break",
            description: "Insert a pause/break into the speech/animation queue.",
            parameters: {
            type: "object",
            properties: {
                duration_ms: { type: "number", description: "Break length in milliseconds." }
            },
            required: ["duration_ms"]
            }
        },
        {
            type: "function",
            name: "look_at",
            description: "Make the avatar look at a screen position (x,y) for t milliseconds.",
            parameters: {
            type: "object",
            properties: {
                x: { type: "number", description: "Normalized screen X position (0..1) or pixel value depending on your UI." },
                y: { type: "number", description: "Normalized screen Y position (0..1) or pixel value depending on your UI." },
                t: { type: "number", description: "Duration in milliseconds (optional)." }
            },
            required: ["x", "y"]
            }
        },
        {
            type: "function",
            name: "look_at_camera",
            description: "Make the avatar look at the camera for t milliseconds.",
            parameters: {
            type: "object",
            properties: {
                t: { type: "number", description: "Duration in milliseconds." }
            },
            required: ["t"]
            }
        }
        // ... more can be added
      ];
  }
}
