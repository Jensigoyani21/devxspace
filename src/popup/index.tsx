import { useEffect, useState } from "react";
import { getRoomParticipants, joinRoomForUrl, leaveRoom, updateMuteStatus, updateSpeakingStatus, userId } from "../services/roomService";
import { createRoot } from "react-dom/client";
import { webRTCService } from "../services/webrtc";

// Define types for participant data
interface Participant {
    userName: string;
    joinedAt: Date;
    userId: string;
    isMuted?: boolean;
    isSpeaking?: boolean;
}

interface ParticipantListItemProps {
    participant: Participant;
    isCurrentUser: any;
}

interface StoredState {
    isConnected: boolean;
    userName: string;
    joined: boolean;
}

const Popup = () => {
    // URL and user states
    const [url, setUrl] = useState('');
    const [userName, setUserName] = useState('');
    const [isMuted, setIsMuted] = useState(false);

    // Room participant states
    const [participantCount, setParticipantCount] = useState<number | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);

    // Connection states
    const [joined, setJoined] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [unsubscribe, setUnsubscribe] = useState<(() => void) | null>(null);

    // UI states
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

    const handleToggleMute = async () => {
        if (stream) {
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                const newMuteState = !isMuted;
                audioTrack.enabled = !newMuteState;
                setIsMuted(newMuteState);

                // Update mute status in Firebase
                try {
                    await updateMuteStatus(url, newMuteState);
                } catch (err) {
                    console.error("Failed to update mute status:", err);
                }
            }
        }
    };

    const RoomStats = ({ participants }: { participants: Participant[] }) => {
        const stats = {
            total: participants.length,
            speakers: participants.filter(p => !p.isMuted).length,
            muted: participants.filter(p => p.isMuted).length,
            active: participants.filter(p => p.isSpeaking).length
        };

        return (
            <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="p-2 bg-gray-50 rounded">
                    <div className="text-xs text-gray-500">Total</div>
                    <div className="font-semibold">{stats.total}</div>
                </div>
                <div className="p-2 bg-green-50 rounded">
                    <div className="text-xs text-green-600">Speaking</div>
                    <div className="font-semibold text-green-700">{stats.active}</div>
                </div>
                <div className="p-2 bg-blue-50 rounded">
                    <div className="text-xs text-blue-600">Unmuted</div>
                    <div className="font-semibold text-blue-700">{stats.speakers}</div>
                </div>
                <div className="p-2 bg-red-50 rounded">
                    <div className="text-xs text-red-600">Muted</div>
                    <div className="font-semibold text-red-700">{stats.muted}</div>
                </div>
            </div>
        );
    };

    const MuteButton = ({ isMuted, onClick }: any) => (
        <button
            onClick={onClick}
            className={`mt-3 px-2 py-2 rounded-full w-8 h-8 flex items-center justify-center ${isMuted
                ? "bg-red-600 hover:bg-red-700"
                : "bg-green-600 hover:bg-green-700"
                }`}
            title={isMuted ? "Unmute" : "Mute"}
        >
            {isMuted ? (
                // Muted icon - smaller size
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11h2m0 0h2m-2 0V9m0 2v2M5 8v8a4 4 0 004 4h6a4 4 0 004-4V8a4 4 0 00-4-4h-6a4 4 0 00-4 4z" />
                </svg>
            ) : (
                // Unmuted icon - smaller size
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
            )}
        </button>
    );

    const detectAudioActivity = (stream: MediaStream) => {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        const scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);

        analyser.smoothingTimeConstant = 0.8;
        analyser.fftSize = 1024;

        microphone.connect(analyser);
        analyser.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);

        const soundAllowed = (stream: any) => {
            console.log('stream :', stream);
            const array = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(array);
            let values = 0;

            const length = array.length;
            for (let i = 0; i < length; i++) {
                values += array[i];
            }

            const average = values / length;
            const isSpeaking = average > 20; // Adjust threshold as needed

            if (isSpeaking !== participants.find(p => p.userId === userId)?.isSpeaking) {
                updateSpeakingStatus(url, isSpeaking);
            }
        };

        scriptProcessor.addEventListener('audioprocess', () => soundAllowed(stream));

        return () => {
            microphone.disconnect();
            analyser.disconnect();
            scriptProcessor.disconnect();
        };
    };

    // Add to the useEffect where you handle stream setup
    useEffect(() => {
        if (stream && isConnected) {
            const cleanup = detectAudioActivity(stream);
            return () => {
                cleanup();
            };
        }
    }, [stream, isConnected]);

    useEffect(() => {
        const handleUrlChange = async () => {
            try {
                console.log("chrome.storage.local", chrome.storage.local)
                const stored = await chrome.storage.local.get(['currentUrl', 'urlChanged']);
                const urlChange = stored.urlChanged;

                // If URL changed while connected
                if (urlChange && isConnected) {
                    // Show notification in the popup
                    setError(`Switching to room: ${stored.currentUrl}`);
                    setTimeout(() => setError(null), 3000); // Clear after 3 seconds

                    // Keep the existing stream
                    const existingStream: any = stream;

                    // Leave old room but keep audio stream
                    if (unsubscribe) {
                        unsubscribe();
                    }
                    await leaveRoom(urlChange.from);

                    // Join new room with existing stream
                    const { unsubscribe: unsub } = await joinRoomForUrl(
                        stored.currentUrl,
                        userName,
                        (count) => setParticipantCount(count),
                        existingStream
                    );

                    // Update states
                    setUrl(stored.currentUrl);
                    setUnsubscribe(() => unsub);

                    // Clear the change flag
                    chrome.storage.local.set({ urlChanged: null });

                    // Get participants for new room
                    const { count, participants } = await getRoomParticipants(stored.currentUrl);
                    setParticipantCount(count);
                    setParticipants(participants);

                    console.log("here................")

                    console.log("chrome.notifications", chrome)

                    // Show success notification
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icon.png',
                        title: 'Room Changed',
                        message: `Successfully joined new room: ${stored.currentUrl}`,
                        priority: 2
                    });
                }
            } catch (err) {
                console.error("Failed to handle URL change:", err);
                setError("Failed to switch rooms. Please reconnect.");

                // Show error notification
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon.png',
                    title: 'Room Change Failed',
                    message: 'Failed to switch rooms. Please reconnect.',
                    priority: 2
                });
            }
        };

        // Set up storage change listener
        const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            console.log("changes", changes);
            console.log("changes.urlChanged?.newValue", changes.connectionState?.newValue)
            if (changes.connectionState?.newValue) {
                handleUrlChange();
            }
        };

        chrome.storage.onChanged.addListener(storageListener);
        console.log('chrome.storage :', chrome.storage);

        // Cleanup
        return () => {
            chrome.storage.onChanged.removeListener(storageListener);
        };
    }, [url, isConnected, userName, stream, unsubscribe]);

    // Initialize room data when popup opens
    useEffect(() => {
        const initializeRoom = async () => {
            try {
                // Get current tab URL
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const currentUrl = tabs[0]?.url || '';

                chrome.storage.local.set({
                    currentUrl,
                    urlChanged: false
                });

                setUrl(currentUrl);

                // Get stored connection state
                const stored = await chrome.storage.local.get(['connectionState']);
                console.log('stored :', stored);
                const state: StoredState = stored.connectionState;
                console.log("state.isConnected", state.isConnected);
                if (state) {
                    setIsConnected(state.isConnected);
                    setUserName(state.userName);
                    setJoined(state.joined);

                    // If we were connected, reconnect
                    if (state.isConnected) {
                        // Rejoin the room without requesting microphone again
                        const { stream: audioStream, unsubscribe: unsub } = await joinRoomForUrl(
                            currentUrl,
                            state.userName,
                            (count) => setParticipantCount(count)
                        );
                        setStream(audioStream);
                        setUnsubscribe(() => unsub);
                    }
                }

                // Fetch current participants
                const { count, participants } = await getRoomParticipants(currentUrl);
                setParticipantCount(count);
                setParticipants(participants);
            } catch (err) {
                console.error("Failed to load room:", err);
                setError("Failed to load room information");
            } finally {
                setLoading(false);
            }
        };

        initializeRoom();
    }, []);

    useEffect(() => {
        console.log("isConnected", isConnected);
        if (isConnected) {
            // Listen for remote streams
            webRTCService.on('remoteStream', ({ participantId, stream }: any) => {
                setRemoteStreams(prev => {
                    const newStreams = new Map(prev);
                    console.log('newStreams :', newStreams);
                    newStreams.set(participantId, stream);
                    return newStreams;
                });
            });
        }

        // Cleanup remote streams when disconnecting
        return () => {
            remoteStreams.forEach(stream => {
                stream.getTracks().forEach(track => track.stop());
            });
            setRemoteStreams(new Map());
        };
    }, [isConnected]);

    useEffect(() => {
        const state: StoredState = {
            isConnected,
            userName,
            joined
        };
        chrome.storage.local.set({ connectionState: state });
    }, [isConnected, userName, joined]);

    // Handle joining the room
    const handleJoinRoom = async () => {
        if (!userName.trim()) {
            setError("Please enter your name before joining");
            return;
        }

        try {
            setError(null);
            setJoined(true);

            const { stream: audioStream, unsubscribe: unsub } = await joinRoomForUrl(
                url,
                userName,
                (count) => setParticipantCount(count)
            );

            setStream(audioStream);
            setUnsubscribe(() => unsub);
            setIsConnected(true);
        } catch (err: any) {
            setJoined(false);
            setIsConnected(false);
            setError(err.message);
            console.error("Failed to join room:", err);
        }
    };

    // Handle leaving the room
    const handleLeaveRoom = async () => {
        try {
            setError(null);

            // Get current tab URL to ensure we leave the correct room
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const currentUrl = tabs[0]?.url || '';

            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                setStream(null);
            }

            if (unsubscribe) {
                unsubscribe();
                setUnsubscribe(null);
            }

            // Leave room using current URL instead of stored URL
            await leaveRoom(currentUrl);

            // Reset states and clear storage
            setJoined(false);
            setIsConnected(false);
            setParticipantCount(prev => prev ? prev - 1 : 0);
            chrome.storage.local.remove(['connectionState', 'urlChanged']);
            setUrl(currentUrl); // Update stored URL to current
        } catch (err: any) {
            setError(err.message);
            console.error("Failed to leave room:", err);
        }
    };

    const ParticipantListItem: React.FC<ParticipantListItemProps> = ({ participant, isCurrentUser }) => (
        <li className={`flex items-center justify-between p-2 rounded ${isCurrentUser ? "bg-green-50 text-green-600 font-medium" : "text-gray-600"
            }`}>
            <div className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${remoteStreams.has(participant.userId)
                    ? "bg-blue-500 animate-pulse"
                    : isCurrentUser
                        ? "bg-green-500 animate-pulse"
                        : "bg-gray-300"
                    }`}></span>
                <span>{participant.userName}</span>
                {participant.isMuted && (
                    <span className="text-xs text-gray-500">(Muted)</span>
                )}
            </div>
            {isCurrentUser && (
                <span className="text-xs bg-green-100 px-2 py-1 rounded">You</span>
            )}
        </li>
    );

    // Render UI components
    return (
        <div className="p-4 text-sm">
            {/* URL Display */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold">Current URL:</h2>
                {isConnected && (
                    <div className="flex items-center justify-between mt-3">
                        <ConnectionStatus userName={userName} isMuted={isMuted} />
                        <MuteButton isMuted={isMuted} onClick={handleToggleMute} />
                    </div>
                )}
            </div>
            <p className="break-words">{url}</p>

            {loading ? (
                <div className="mt-3">Loading room information...</div>
            ) : (
                <>

                    <RoomStats participants={participants} />

                    {/* Participants List */}
                    <div className="mt-3">
                        <h3 className="font-semibold">
                            Current Participants ({participantCount || 0}):
                        </h3>
                        <ul className="mt-1 space-y-1">
                            {participants.map((p) => (
                                <ParticipantListItem
                                    key={p.userId}
                                    participant={p}
                                    isCurrentUser={stream && p.userId === userId}
                                />
                            ))}
                        </ul>
                    </div>

                    {/* Connection Status */}
                    {isConnected && (
                        <ConnectionStatus userName={userName} />
                    )}

                    {/* User Input */}
                    <div className="mt-3">
                        <input
                            type="text"
                            placeholder="Enter your name"
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-purple-600"
                            disabled={joined && !error}
                        />
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div className="mt-3 p-2 bg-red-100 border border-red-400 text-red-700 rounded">
                            {error}
                        </div>
                    )}

                    {/* Join/Leave Button */}
                    {!joined ? (
                        <JoinButton
                            onClick={handleJoinRoom}
                            disabled={!userName.trim()}
                        />
                    ) : (
                        <LeaveButton onClick={handleLeaveRoom} />
                    )}
                </>
            )}
        </div>
    );
};

// Component for displaying individual participants



// Component for connection status
const ConnectionStatus = ({ userName }: any) => (
    <div className="mt-3 p-2 bg-green-100 border border-green-400 text-green-700 rounded flex items-center gap-2">
        <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
        Connected as {userName}
    </div>
);

// Join button component
const JoinButton = ({ onClick, disabled }: any) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`mt-3 px-4 py-2 rounded w-full ${!disabled
            ? "bg-purple-600 text-white hover:bg-purple-700"
            : "bg-gray-300 cursor-not-allowed"
            }`}
    >
        Join Audio Room
    </button>
);

// Leave button component
const LeaveButton = ({ onClick }: any) => (
    <button
        onClick={onClick}
        className="mt-3 px-4 py-2 rounded w-full bg-red-600 text-white hover:bg-red-700"
    >
        Leave Room
    </button>
);

export default Popup;

// Initialize React
const root = createRoot(document.getElementById("root")!);
root.render(<Popup />);