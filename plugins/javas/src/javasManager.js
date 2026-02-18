const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const os = require("os");
const log = require("./javasLogger");

// States: idle -> listening -> capturing -> processing -> idle
const STATES = {
  IDLE: "idle",
  LISTENING: "listening",
  CAPTURING: "capturing",
  PROCESSING: "processing",
};

class JavasManager extends EventEmitter {
  constructor() {
    super();
    this.state = STATES.IDLE;
    this.porcupine = null;
    this.recorder = null;
    this.listenLoop = null;
    this.captureBuffer = [];
    this.silenceFrames = 0;
    this.settings = {};
  }

  async start(settings) {
    if (this.state !== STATES.IDLE) {
      await this.stop();
    }

    this.settings = settings;

    const accessKey = settings.picovoiceAccessKey;
    if (!accessKey) {
      log.error("No Picovoice Access Key provided");
      throw new Error("Picovoice Access Key is required. Get one free at picovoice.ai/console");
    }

    try {
      log.info("Loading Porcupine and PvRecorder native modules...");
      // Dynamic imports to avoid crashes if deps aren't installed
      const { Porcupine, BuiltinKeyword } = require("@picovoice/porcupine-node");
      const { PvRecorder } = require("@picovoice/pvrecorder-node");
      log.info("Native modules loaded successfully");

      const sensitivity = settings.wakeSensitivity ?? 0.5;
      log.info("Creating Porcupine instance (keyword: JARVIS, sensitivity:", sensitivity, ")");

      // Use built-in "jarvis" keyword (phonetically close to "Javas")
      this.porcupine = new Porcupine(
        accessKey,
        [BuiltinKeyword.JARVIS],
        [sensitivity]
      );
      log.info("Porcupine initialized (frameLength:", this.porcupine.frameLength, "sampleRate:", this.porcupine.sampleRate, ")");

      // List available audio devices
      const devices = PvRecorder.getAvailableDevices();
      log.info("Available audio devices:", JSON.stringify(devices));

      // Get default audio device (-1 = system default)
      this.recorder = new PvRecorder(this.porcupine.frameLength, -1);
      this.recorder.start();
      log.info("PvRecorder started on default device");

      this._setState(STATES.LISTENING);
      this._startListenLoop();

      log.info("Wake word detection started (keyword: jarvis)");
    } catch (err) {
      log.error("Failed to initialize wake word detection:", err.message);
      this._setState(STATES.IDLE);
      throw new Error(`Failed to initialize wake word detection: ${err.message}`);
    }
  }

  async stop() {
    this._stopListenLoop();

    if (this.recorder) {
      try {
        this.recorder.stop();
        this.recorder.release();
      } catch {
        // Already released
      }
      this.recorder = null;
    }

    if (this.porcupine) {
      try {
        this.porcupine.release();
      } catch {
        // Already released
      }
      this.porcupine = null;
    }

    this.captureBuffer = [];
    this.silenceFrames = 0;
    this._setState(STATES.IDLE);
    log.info("Wake word detection stopped");
  }

  isRunning() {
    return this.state !== STATES.IDLE;
  }

  getState() {
    return this.state;
  }

  setSensitivity(value) {
    this.settings.wakeSensitivity = value;
    // Sensitivity change requires restart
    if (this.isRunning()) {
      const settings = { ...this.settings };
      this.stop().then(() => this.start(settings));
    }
  }

  _setState(state) {
    if (this.state !== state) {
      this.state = state;
      this.emit("state-changed", state);
    }
  }

  _startListenLoop() {
    this._stopListenLoop();

    const processFrame = async () => {
      if (!this.recorder || !this.porcupine) return;

      try {
        const frame = await this.recorder.read();

        if (this.state === STATES.LISTENING) {
          // Check for wake word
          const keywordIndex = this.porcupine.process(frame);
          if (keywordIndex >= 0) {
            log.info("Wake word detected! (keywordIndex:", keywordIndex, ")");
            this.emit("wake-word-detected");
            this._startCapturing();
          }
        } else if (this.state === STATES.CAPTURING) {
          // Accumulate audio and check for silence
          this.captureBuffer.push(Buffer.from(frame.buffer));

          // Simple energy-based silence detection
          const energy = this._calculateEnergy(frame);
          const silenceThreshold = 100; // Adjust based on testing

          if (energy < silenceThreshold) {
            this.silenceFrames++;
          } else {
            this.silenceFrames = 0;
          }

          // Calculate silence duration
          const frameDuration = this.porcupine.frameLength / this.porcupine.sampleRate;
          const silenceDuration = this.silenceFrames * frameDuration;
          const silenceTimeout = this.settings.silenceTimeout || 1.5;

          if (silenceDuration >= silenceTimeout && this.captureBuffer.length > 5) {
            log.info("Silence detected after", silenceDuration.toFixed(1), "s - stopping capture (" + this.captureBuffer.length + " frames)");
            this._stopCapturing();
            return;
          }

          // Hard limit: 30 seconds max capture
          const totalDuration = this.captureBuffer.length * frameDuration;
          if (totalDuration >= 30) {
            log.warn("Max capture duration (30s) reached - stopping capture");
            this._stopCapturing();
            return;
          }
        }
      } catch (err) {
        if (err.message && !err.message.includes("released")) {
          log.error("Audio frame error:", err.message);
          this.emit("error", err);
        }
        return; // Don't schedule next frame on error
      }

      // Schedule next frame
      if (this.state !== STATES.IDLE && this.state !== STATES.PROCESSING) {
        this.listenLoop = setImmediate(processFrame);
      }
    };

    this.listenLoop = setImmediate(processFrame);
  }

  _stopListenLoop() {
    if (this.listenLoop) {
      clearImmediate(this.listenLoop);
      this.listenLoop = null;
    }
  }

  _startCapturing() {
    log.info("Capturing command audio...");
    this.captureBuffer = [];
    this.silenceFrames = 0;
    this._setState(STATES.CAPTURING);
  }

  _stopCapturing() {
    this._setState(STATES.PROCESSING);

    // Convert captured PCM frames to a WAV buffer for transcription
    const audioData = this._buildWavBuffer();
    log.info("Audio captured:", (audioData.length / 1024).toFixed(1), "KB WAV");
    this.captureBuffer = [];
    this.silenceFrames = 0;

    // Emit the captured audio for transcription
    this.emit("command-audio-captured", audioData);

    // Resume listening after a short delay (processing happens externally)
    // The plugin index.js will call resumeListening() when processing is done
  }

  resumeListening() {
    if (this.state === STATES.PROCESSING && this.recorder && this.porcupine) {
      log.info("Resuming wake word listening...");
      this._setState(STATES.LISTENING);
      this._startListenLoop();
    }
  }

  _calculateEnergy(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += Math.abs(frame[i]);
    }
    return sum / frame.length;
  }

  _buildWavBuffer() {
    // Combine all captured PCM frames into a single WAV file
    const sampleRate = this.porcupine ? this.porcupine.sampleRate : 16000;
    const numChannels = 1;
    const bitsPerSample = 16;

    // Each frame buffer contains Int16 samples
    const totalSamples = this.captureBuffer.reduce((acc, buf) => acc + buf.length / 2, 0);
    const dataSize = totalSamples * numChannels * (bitsPerSample / 8);

    const wavBuffer = Buffer.alloc(44 + dataSize);

    // WAV header
    wavBuffer.write("RIFF", 0);
    wavBuffer.writeUInt32LE(36 + dataSize, 4);
    wavBuffer.write("WAVE", 8);
    wavBuffer.write("fmt ", 12);
    wavBuffer.writeUInt32LE(16, 16); // fmt chunk size
    wavBuffer.writeUInt16LE(1, 20); // PCM format
    wavBuffer.writeUInt16LE(numChannels, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    wavBuffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    wavBuffer.writeUInt16LE(bitsPerSample, 34);
    wavBuffer.write("data", 36);
    wavBuffer.writeUInt32LE(dataSize, 40);

    // Copy PCM data
    let offset = 44;
    for (const buf of this.captureBuffer) {
      buf.copy(wavBuffer, offset);
      offset += buf.length;
    }

    return wavBuffer;
  }
}

module.exports = JavasManager;
