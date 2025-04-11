navigator.mediaDevices.getUserMedia({ audio: true })
  .then((stream) => {
    console.log("Microphone access granted", stream);
  })
  .catch((error) => {
    console.error("Microphone access denied", error);
  });
