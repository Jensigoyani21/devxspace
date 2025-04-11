import { db } from './firebase';
import { collection, doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';

const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

class WebRTCService extends EventTarget {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private roomId: string = '';
  private userId: string = '';

  async initializeConnection(roomId: string, userId: string, stream: MediaStream) {
    this.roomId = roomId;
    this.userId = userId;
    this.localStream = stream;

    // Listen for new participants
    this.listenForParticipants();

    // Listen for signaling messages
    this.listenForSignalingMessages();
  }

  private async listenForParticipants() {
    const roomRef = collection(db, 'rooms', this.roomId, 'participants');

    onSnapshot(roomRef, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const participantId = change.doc.id;

        if (participantId !== this.userId) {
          if (change.type === 'added') {
            this.createPeerConnection(participantId);
          } else if (change.type === 'removed') {
            this.removePeerConnection(participantId);
          }
        }
      });
    });
  }

  private logSignaling(type: string, data: any) {
    console.log("working webrtc signaling log");
    console.log(`[WebRTC Signaling] ${type}:`, data);
  }

  private async createPeerConnection(participantId: string) {
    try {
      const peerConnection = new RTCPeerConnection(configuration);
      this.peerConnections.set(participantId, peerConnection);

      peerConnection.onconnectionstatechange = () => {
        this.logSignaling('Connection State Change', {
          participantId,
          state: peerConnection.connectionState
        });
      };

      peerConnection.oniceconnectionstatechange = () => {
        this.logSignaling('ICE Connection State', {
          participantId,
          state: peerConnection.iceConnectionState
        });
      };

      // Log signaling state
      peerConnection.onsignalingstatechange = () => {
        this.logSignaling('Signaling State', {
          participantId,
          state: peerConnection.signalingState
        });
      };

      // Add local tracks to the connection
      this.localStream?.getTracks().forEach(track => {
        this.localStream && peerConnection.addTrack(track, this.localStream);
      });

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignalingMessage(participantId, {
            type: 'ice-candidate',
            candidate: event.candidate,
          });
        }
      };

      // Handle incoming tracks
      peerConnection.ontrack = (event) => {
        const remoteStream = new MediaStream();
        event.streams[0].getTracks().forEach(track => {
          remoteStream.addTrack(track);
        });
        this.handleRemoteStream(participantId, remoteStream);
      };

      // Create and send offer if we're the initiator
      if (this.userId < participantId) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        this.sendSignalingMessage(participantId, {
          type: 'offer',
          sdp: offer,
        });
      }

    } catch (err) {
      console.error('Error creating peer connection:', err);
    }
  }

  private async handleSignalingMessage(senderId: string, message: any) {

    this.logSignaling('Received Message', { senderId, type: message.type });

    const peerConnection = this.peerConnections.get(senderId);

    if (!peerConnection) {
      return;
    }

    try {
      switch (message.type) {
        case 'offer':
          await peerConnection.setRemoteDescription(message.sdp);
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          this.sendSignalingMessage(senderId, {
            type: 'answer',
            sdp: answer,
          });
          break;

        case 'answer':
          await peerConnection.setRemoteDescription(message.sdp);
          break;

        case 'ice-candidate':
          await peerConnection.addIceCandidate(message.candidate);
          break;
      }
    } catch (err) {
      console.error('Error handling signaling message:', err);
    }
  }

  private async sendSignalingMessage(recipientId: string, message: any) {

    this.logSignaling('Sending Message', { recipientId, type: message.type });

    try {
      const signalingRef = doc(db, 'rooms', this.roomId, 'signaling', `${this.userId}_${recipientId}`);
      await setDoc(signalingRef, {
        sender: this.userId,
        recipient: recipientId,
        message,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('Error sending signaling message:', err);
    }
  }

  private listenForSignalingMessages() {
    const signalingRef = collection(db, 'rooms', this.roomId, 'signaling');

    onSnapshot(signalingRef, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.recipient === this.userId) {
            await this.handleSignalingMessage(data.sender, data.message);
            // Clean up signaling message
            await deleteDoc(change.doc.ref);
          }
        }
      });
    });
  }

  private removePeerConnection(participantId: string) {
    const peerConnection = this.peerConnections.get(participantId);
    if (peerConnection) {
      peerConnection.close();
      this.peerConnections.delete(participantId);
    }
  }

  private handleRemoteStream(participantId: string, stream: MediaStream) {
    // Dispatch event for new remote stream
    this.dispatchEvent(new CustomEvent('remoteStream', { detail: { participantId, stream } }));
  }

  private listeners: Map<string, Function[]> = new Map();

  public on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
  }

  public emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(callback => callback(data));
  }

  cleanup() {
    // Close all peer connections
    this.peerConnections.forEach(connection => {
      connection.close();
    });
    this.peerConnections.clear();

    // Stop local stream
    this.localStream?.getTracks().forEach(track => track.stop());
    this.localStream = null;
  }
}

export const webRTCService = new WebRTCService();