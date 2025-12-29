class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRecording = false;
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;

    this.port.onmessage = (event) => {
      if (event.data.message === "setRecording") {
        this.isRecording = event.data.isRecording;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isRecording) return true;

    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      
      // Buffer the data
      for (let i = 0; i < channelData.length; i++) {
        this.buffer[this.bufferIndex++] = channelData[i];

        // When buffer is full, send it to the main thread
        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage(this.buffer);
          this.bufferIndex = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
