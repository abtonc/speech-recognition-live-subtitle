function main(
  encoding = "LINEAR16",
  sampleRateHertz = 16000,
  languageCode = "en-US",
  streamingLimit = 290000,
  subtitleMovePercent = 25
) {
  const express = require("express");
  const app = express();
  const http = require("http").createServer(app);
  const io = require("socket.io")(http);
  const chalk = require("chalk");
  const { Writable } = require("stream");
  const recorder = require("node-record-lpcm16");
  const robot = require("robotjs");

  // Serve files.
  app.use(express.static("public"));

  app.get("/", (req, res) => {
    res.sendFile(__dirname + "/views/index.html");
  });

  http.listen(3000, () => {
    console.log("listening on *:3000");
    setInterval(() => {
      // Checks if is mouse below subtitleMovePercent and sends that data to all sockets.
      io.emit(
        "moveSubtitle",
        robot.getMousePos().y <
          (robot.getScreenSize().height / 100) * subtitleMovePercent
          ? 0
          : 1
      );
    }, 150);
  });

  // Imports the Google Cloud client library.
  const speech = require("@google-cloud/speech").v1p1beta1;

  // Creates new SpeechClient instance.
  const client = new speech.SpeechClient();

  const config = {
    encoding: encoding,
    sampleRateHertz: sampleRateHertz,
    languageCode: languageCode,
  };

  const request = {
    config,
    interimResults: true,
  };

  let recognizeStream = null;
  let restartCounter = 0;
  let audioInput = [];
  let lastAudioInput = [];
  let resultEndTime = 0;
  let isFinalEndTime = 0;
  let finalRequestEndTime = 0;
  let newStream = true;
  let bridgingOffset = 0;

  function startStream() {
    // Clear current audioInput.
    audioInput = [];
    // Initiate (Reinitiate) a recognize stream.
    recognizeStream = client
      .streamingRecognize(request)
      .on("error", (err) => {
        if (err.code === 11) {
          // restartStream();
        } else {
          console.error("API request error " + err);
        }
      })
      .on("data", speechCallback);

    // Restart stream when streamingLimit expires.
    setTimeout(restartStream, streamingLimit);
  }

  const speechCallback = (stream) => {
    // Convert API result end time from seconds + nanoseconds to milliseconds.
    resultEndTime =
      stream.results[0].resultEndTime.seconds * 1000 +
      Math.round(stream.results[0].resultEndTime.nanos / 1000000);

    // Calculate correct time based on offset from audio sent twice.
    const correctedTime =
      resultEndTime - bridgingOffset + streamingLimit * restartCounter;

    // Check if results avalible.
    if (stream.results[0] && stream.results[0].alternatives[0]) {
      io.emit("subtitleUpdate", stream.results[0].alternatives[0].transcript);
    }
  };

  const audioInputStreamTransform = new Writable({
    write(chunk, encoding, next) {
      if (newStream && lastAudioInput.length !== 0) {
        // Approximate math to calculate time of chunks.
        const chunkTime = streamingLimit / lastAudioInput.length;
        if (chunkTime !== 0) {
          if (bridgingOffset < 0) {
            bridgingOffset = 0;
          }
          if (bridgingOffset > finalRequestEndTime) {
            bridgingOffset = finalRequestEndTime;
          }
          const chunksFromMS = Math.floor(
            (finalRequestEndTime - bridgingOffset) / chunkTime
          );
          bridgingOffset = Math.floor(
            (lastAudioInput.length - chunksFromMS) * chunkTime
          );

          for (let i = chunksFromMS; i < lastAudioInput.length; i++) {
            recognizeStream.write(lastAudioInput[i]);
          }
        }
        newStream = false;
      }

      audioInput.push(chunk);

      if (recognizeStream) {
        recognizeStream.write(chunk);
      }

      next();
    },

    final() {
      if (recognizeStream) {
        recognizeStream.end();
      }
    },
  });

  function restartStream() {
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream.removeListener("data", speechCallback);
      recognizeStream = null;
    }
    if (resultEndTime > 0) {
      finalRequestEndTime = isFinalEndTime;
    }
    resultEndTime = 0;

    lastAudioInput = [];
    lastAudioInput = audioInput;

    restartCounter++;

    if (!lastTranscriptWasFinal) {
      process.stdout.write("\n");
    }
    process.stdout.write(
      chalk.yellow(`${streamingLimit * restartCounter}: RESTARTING REQUEST\n`)
    );

    newStream = true;

    startStream();
  }
  // Start recording and send the microphone input to the Speech API.
  recorder
    .record({
      sampleRateHertz: sampleRateHertz,
      threshold: 0, // Silence threshold.
      silence: 1000,
      keepSilence: true,
      recordProgram: "rec", // Try also "arecord" or "sox".
    })
    .stream()
    .on("error", (err) => {
      console.error("Audio recording error " + err);
    })
    .pipe(audioInputStreamTransform);

  startStream();
  // [END speech_transcribe_infinite_streaming]
}

process.on("unhandledRejection", (err) => {
  console.error(err.message);
  process.exitCode = 1;
});

main(...process.argv.slice(2));
