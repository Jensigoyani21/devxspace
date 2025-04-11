import { collection, doc, setDoc, deleteDoc, onSnapshot, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import { v4 as uuidv4 } from 'uuid';
import { webRTCService } from "./webrtc";

export const userId = uuidv4();

interface Participant {
  userName: string;
  joinedAt: Date;
  userId: string;
  isMuted?: boolean;
  isSpeaking?: boolean;
}

export const updateMuteStatus = async (url: string, isMuted: boolean) => {
  const roomId = encodeURIComponent(url);
  try {
    await setDoc(doc(db, "rooms", roomId, "participants", userId), {
      isMuted
    }, { merge: true });
    return true;
  } catch (err) {
    console.error("Failed to update mute status:", err);
    throw new Error("Failed to update mute status");
  }
};

export const leaveRoom = async (url: string) => {
    const roomId = encodeURIComponent(url);
    try {
        // Cleanup WebRTC connections
        webRTCService.cleanup();
        
        // Try to remove participant from both current and previous rooms
        const removePromises = [
            deleteDoc(doc(db, "rooms", roomId, "participants", userId)),
            // Also try to clean up any lingering participant records
            getDocs(collection(db, "rooms")).then(snapshot => {
                snapshot.docs.forEach((doc: any) => {
                    if (doc.id !== roomId) {
                        deleteDoc(doc.ref.collection("participants").doc(userId));
                    }
                });
            })
        ];

        await Promise.all(removePromises);
        return true;
    } catch (err) {
        console.error("Failed to leave room:", err);
        throw new Error("Failed to leave the room");
    }
};

export const getRoomParticipants = async (url: string) => {
  const roomId = encodeURIComponent(url);
  const roomRef = collection(db, "rooms", roomId, "participants");
  const snapshot = await getDocs(roomRef);

  const participants: Participant[] = [];
  snapshot.forEach(doc => {
    const data = doc.data() as Participant;
    participants.push(data);
  });

  return {
    count: snapshot.size,
    participants
  };
};

export const updateSpeakingStatus = async (url: string, isSpeaking: boolean) => {
  const roomId = encodeURIComponent(url);
  try {
      await setDoc(doc(db, "rooms", roomId, "participants", userId), {
          isSpeaking
      }, { merge: true });
      return true;
  } catch (err) {
      console.error("Failed to update speaking status:", err);
      throw new Error("Failed to update speaking status");
  }
};

export const joinRoomForUrl = async (url: string, userName: string, onUpdateParticipants: (count: number) => void, existingStream?: MediaStream) => {
  const roomId = encodeURIComponent(url);
  const roomRef = collection(db, "rooms", roomId, "participants");

  const unsubscribe = onSnapshot(roomRef, (snapshot) => {
    const count = snapshot.size;
    onUpdateParticipants(count);
  });

  try {
    const stream = existingStream || await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Initialize WebRTC connection
    await webRTCService.initializeConnection(roomId, userId, stream);

    await setDoc(doc(db, "rooms", roomId, "participants", userId), {
      joinedAt: new Date(),
      userName: userName || "Anonymous",
      userId: userId,
    });

    return { stream, unsubscribe };
  } catch (err: any) {
    console.error("❌ Microphone error:", err.name, err.message);

    console.log("err", err)

    // Handle specific error cases
    switch (err.name) {
      case "NotAllowedError":
        if (err.message.includes("dismissed")) {
          throw new Error("Microphone permission was dismissed. Please click the microphone icon in your browser's address bar to enable access.");
        } else {
          throw new Error("Microphone access was blocked. To enable it, click the camera icon in your browser's address bar and allow access.");
        }
      case "NotFoundError":
        throw new Error("No microphone found on your device. Please connect a microphone and try again.");
      case "NotReadableError":
        throw new Error("Could not access your microphone. It may be in use by another application.");
      default:
        throw new Error(`Could not access microphone: ${err.message}`);
    }
  }
};

export const ConnectionStatus = ({ userName, isMuted }: { userName: string; isMuted: boolean }) => (
  <div className="flex-1 p-2 bg-green-100 border border-green-400 text-green-700 rounded flex items-center gap-2">
    <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
    <div className="flex flex-col">
      <span className="font-medium">Connected</span>
      <span className="text-sm">
        {userName} {isMuted && "(Muted)"}
      </span>
    </div>
  </div>
);

