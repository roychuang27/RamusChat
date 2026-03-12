import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../api";

export function useSessionManager(addToast) {
    const [sessions, setSessions] = useState([]);
    const navigate = useNavigate();

    const fetchSessions = useCallback(async () => {
        try {
            const data = await api.fetchSessions();
            setSessions(data);
        } catch (err) {
            console.error("Failed to fetch sessions:", err);
            addToast("Failed to load sessions");
        }
    }, [addToast]);

    const handleCreateSession = async (parentId = null) => {
        try {
            const session = await api.createSession(parentId);
            setSessions(prev => [...prev, session]);
            navigate(`/chat/${session.id}`);
        } catch (err) {
            console.error("Failed to create session:", err);
            addToast("Failed to create session");
        }
    };

    const handleDeleteSession = async (e, id, currentSessionId, thinkingSessions) => {
        e.stopPropagation();
        if (thinkingSessions.has(id)) return;
        try {
            await api.deleteSession(id);
            const remaining = sessions.filter(s => s.id !== id);
            setSessions(remaining);
            if (currentSessionId === id) {
                navigate(remaining.length > 0 ? `/chat/${remaining[0].id}` : "/");
            }
        } catch (err) {
            console.error("Failed to delete session:", err);
            addToast("Failed to delete session");
        }
    };

    const handleMoveSession = async (sessionId, newParentId) => {
        try {
            await api.moveSession(sessionId, newParentId);
            await fetchSessions();
        } catch (err) {
            console.error("Failed to move session:", err);
            addToast(`Failed to move session: ${err.message}`);
        }
    };

    const setSessionTitle = useCallback((sessionId, title) => {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title } : s));
    }, []);

    return {
        sessions,
        setSessions,
        fetchSessions,
        handleCreateSession,
        handleDeleteSession,
        handleMoveSession,
        setSessionTitle
    };
}
