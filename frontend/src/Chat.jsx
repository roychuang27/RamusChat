import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import * as api from "./api";
import SessionSidebar from "./components/SessionSidebar";
import MemoryPanel from "./components/MemoryPanel";
import TitleEditModal from "./components/TitleEditModal";
import VersionControlPanel from "./components/VersionControlPanel";
import ClusteringLockOverlay from "./components/ClusteringLockOverlay";
import ClusteringResultModal from "./components/ClusteringResultModal";
import DisconnectedOverlay from "./components/DisconnectedOverlay";
import ToastContainer from "./components/ToastContainer";
import { useSSE } from "./hooks/useSSE";
import { useElapsedTimer } from "./hooks/useElapsedTimer";
import { useToast } from "./hooks/useToast";
import { useSessionManager } from "./hooks/useSessionManager";
import { useChatState } from "./hooks/useChatState";
import { useMemoryManager } from "./hooks/useMemoryManager";
import { useSnapshotManager } from "./hooks/useSnapshotManager";

import ChatHeader from "./components/chat/ChatHeader";
import MessageList from "./components/chat/MessageList";
import ChatInputSection from "./components/chat/ChatInputSection";

import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PsychologyIcon from '@mui/icons-material/Psychology';
import RestoreIcon from '@mui/icons-material/Restore';
import "./styles.css";

export default function Chat() {
    const { sessionId: urlSessionId } = useParams();
    const [toasts, addToast, dismissToast] = useToast();

    // Hooks
    const {
        sessions, setSessions, fetchSessions,
        handleCreateSession, handleDeleteSession, handleMoveSession, setSessionTitle
    } = useSessionManager(addToast);

    const {
        memories, setMemories, showMemories, setShowMemories,
        refreshMemories, handleDeleteMemory, handleToggleMemory
    } = useMemoryManager(addToast);

    const {
        messages, setMessages, thinkingSessions,
        loading, loadSessionData, handleSend, sseHandlers
    } = useChatState(urlSessionId ? parseInt(urlSessionId, 10) : null, addToast, fetchSessions, setMemories);

    const {
        snapshots, showVersionControl, setShowVersionControl,
        refreshSnapshots, handleRollback, handleDeleteSnapshot
    } = useSnapshotManager(addToast, fetchSessions, loadSessionData);

    // UI State
    const [input, setInput] = useState("");
    const [clustering, setClustering] = useState(false);
    const [showSessions, setShowSessions] = useState(true);
    const [isSidebarFullscreen, setIsSidebarFullscreen] = useState(false);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleInput, setTitleInput] = useState("");
    const [clusteringInitialElapsed, setClusteringInitialElapsed] = useState(0);
    const [clusteringResult, setClusteringResult] = useState(null);

    const chatMessagesRef = useRef(null);

    const currentSession = useMemo(() => {
        if (!urlSessionId) return null;
        const id = parseInt(urlSessionId, 10);
        return sessions.find(s => s.id === id) || null;
    }, [urlSessionId, sessions]);

    const isCurrentSessionThinking = currentSession ? thinkingSessions.has(currentSession.id) : false;
    const canSend = currentSession && !isCurrentSessionThinking;

    const thinkingElapsed = useElapsedTimer(isCurrentSessionThinking);
    const clusteringElapsed = useElapsedTimer(!!clustering, clusteringInitialElapsed);

    const extendedSSEHandlers = useMemo(() => ({
        ...sseHandlers,
        connected: () => {
            sseHandlers.connected();
            api.fetchStatus().then(status => {
                if (status.clustering) {
                    setClustering(status.clustering);
                    if (status.clustering_started_at) {
                        const elapsed = Math.floor(Date.now() / 1000 - status.clustering_started_at);
                        setClusteringInitialElapsed(Math.max(0, elapsed));
                    }
                } else {
                    setClustering(false);
                }
            }).catch(err => console.error("Failed to sync status:", err));
        },
        clustering_start: (data) => setClustering(data.operation),
        clustering_end: (data) => {
            setClustering(false);
            setClusteringResult(data.error ? { operation: data.operation, error: data.error } : { operation: data.operation, ...data.result });
            fetchSessions();
            if (urlSessionId) loadSessionData(parseInt(urlSessionId, 10));
        },
    }), [sseHandlers, fetchSessions, loadSessionData, urlSessionId]);

    const { connected, retryCount, nextRetryAt, firstDisconnectAt, retryNow } = useSSE(extendedSSEHandlers);

    // Initialization
    useEffect(() => {
        fetchSessions();
        api.fetchStatus().then(status => {
            if (status.clustering) {
                setClustering(status.clustering);
                if (status.clustering_started_at) {
                    const elapsed = Math.floor(Date.now() / 1000 - status.clustering_started_at);
                    setClusteringInitialElapsed(Math.max(0, elapsed));
                }
            }
        });
    }, [fetchSessions]);

    useEffect(() => {
        if (currentSession?.id) loadSessionData(currentSession.id);
    }, [currentSession?.id, loadSessionData]);

    useEffect(() => {
        chatMessagesRef.current?.scrollTo(0, chatMessagesRef.current.scrollHeight);
    }, [messages, isCurrentSessionThinking]);

    useEffect(() => {
        if (!clustering) return;
        const handler = (e) => {
            e.preventDefault();
            e.returnValue = "Clustering is in progress. Are you sure you want to leave?";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [clustering]);

    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === "Escape" && !editingTitle && currentSession) {
                setShowSessions(prev => !prev);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [editingTitle, currentSession]);

    useEffect(() => {
        if (showVersionControl) refreshSnapshots();
    }, [showVersionControl, refreshSnapshots]);

    // Handlers
    const handleReparent = async () => {
        if (clustering) return;
        if (!confirm("Tidy up sessions? This will reorganize the session tree by semantic similarity.")) return;
        try {
            await api.clusterReparent();
            setClusteringInitialElapsed(0);
            setClustering("reparent");
        } catch (err) {
            console.error("Failed to start reparent:", err);
            addToast("Failed to start clustering: " + err.message);
        }
    };

    const handleTitleEdit = () => {
        if (!currentSession) return;
        setTitleInput(currentSession.title || "");
        setEditingTitle(true);
    };

    const handleTitleSave = async () => {
        const trimmed = titleInput.trim();
        if (trimmed && trimmed !== currentSession?.title) {
            try {
                await api.patchSessionTitle(currentSession.id, trimmed);
                setSessionTitle(currentSession.id, trimmed);
            } catch (err) {
                console.error("Failed to update title:", err);
                addToast("Failed to update title");
            }
        }
        setEditingTitle(false);
    };

    const handleScroll = () => {
        if (chatMessagesRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = chatMessagesRef.current;
            setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 300);
        }
    };

    const scrollToBottom = () => {
        chatMessagesRef.current?.scrollTo({
            top: chatMessagesRef.current.scrollHeight,
            behavior: 'smooth',
        });
    };

    return (
        <div className="chat-app">
            {!connected && <DisconnectedOverlay retryCount={retryCount} nextRetryAt={nextRetryAt} firstDisconnectAt={firstDisconnectAt} onRetryNow={retryNow} />}
            {clustering && <ClusteringLockOverlay clustering={clustering} elapsed={clusteringElapsed} />}

            <SessionSidebar
                open={showSessions}
                fullscreen={isSidebarFullscreen}
                sessions={sessions}
                currentSession={currentSession}
                thinkingSessions={thinkingSessions}
                clustering={clustering}
                clusteringElapsed={clusteringElapsed}
                onToggleFullscreen={() => setIsSidebarFullscreen(v => !v)}
                onCreateSession={handleCreateSession}
                onSelectSession={(s) => window.location.hash = `/chat/${s.id}`} /* Assuming HashRouter or similar navigation if navigate is tricky */
                onDeleteSession={(e, id) => handleDeleteSession(e, id, currentSession?.id, thinkingSessions)}
                onMoveSession={handleMoveSession}
                onReparent={handleReparent}
            />

            <div className="main-area">
                <div className="top-bar">
                    <button className={`toggle-btn ${showSessions ? 'active' : ''}`} onClick={() => setShowSessions(v => !v)}>
                        <AccountTreeIcon sx={{ fontSize: 18, mr: 1, verticalAlign: 'middle' }} /> Tree
                    </button>
                    <button className={`toggle-btn ${showMemories ? 'active' : ''}`} onClick={() => {
                        setShowMemories(v => {
                            if (!v && currentSession) refreshMemories(currentSession.id);
                            return !v;
                        });
                    }}>
                        <PsychologyIcon sx={{ fontSize: 18, mr: 1, verticalAlign: 'middle' }} /> {memories.length}
                    </button>
                    <button className={`toggle-btn ${showVersionControl ? 'active' : ''}`} onClick={() => setShowVersionControl(v => !v)}>
                        <RestoreIcon sx={{ fontSize: 18, mr: 1, verticalAlign: 'middle' }} /> History
                    </button>
                </div>

                {showMemories && (
                    <MemoryPanel
                        memories={memories}
                        hasParent={!!currentSession?.parent_id}
                        onToggle={(id, sid) => handleToggleMemory(id, sid, setMessages)}
                        onDelete={(id, sid) => handleDeleteMemory(id, sid, setMessages)}
                        onClose={() => setShowMemories(false)}
                    />
                )}

                {showVersionControl && (
                    <VersionControlPanel
                        snapshots={snapshots}
                        onRollback={(id) => handleRollback(id, currentSession?.id)}
                        onDelete={handleDeleteSnapshot}
                        onClose={() => setShowVersionControl(false)}
                        disabled={!!clustering || thinkingSessions.size > 0}
                    />
                )}

                <div className="chat-container">
                    <ChatHeader
                        title={currentSession?.title || "Select a session from tree"}
                        onEdit={handleTitleEdit}
                        disabled={!currentSession}
                    />

                    {editingTitle && (
                        <TitleEditModal
                            value={titleInput}
                            onChange={setTitleInput}
                            onSave={handleTitleSave}
                            onCancel={() => setEditingTitle(false)}
                        />
                    )}

                    <MessageList
                        messages={messages}
                        loading={loading}
                        currentSession={currentSession}
                        isThinking={isCurrentSessionThinking}
                        chatMessagesRef={chatMessagesRef}
                        onScroll={handleScroll}
                        showScrollBtn={showScrollBtn}
                        scrollToBottom={scrollToBottom}
                    />

                    <ChatInputSection
                        input={input}
                        setInput={setInput}
                        handleSend={() => handleSend(input, setInput, setSessionTitle)}
                        canSend={canSend}
                        isThinking={isCurrentSessionThinking}
                        thinkingElapsed={thinkingElapsed}
                    />
                </div>
            </div>

            {clusteringResult && <ClusteringResultModal result={clusteringResult} onClose={() => setClusteringResult(null)} />}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
    );
}
