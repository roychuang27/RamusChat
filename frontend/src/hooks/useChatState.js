import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import * as api from "../api";

export function useChatState(sessionId, addToast, fetchSessions, refreshMemories) {
    const [messages, setMessages] = useState([]);
    const [thinkingSessions, setThinkingSessions] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const sessionIdRef = useRef(sessionId);

    useEffect(() => {
        sessionIdRef.current = sessionId;
    }, [sessionId]);

    const loadSessionData = useCallback(async (id) => {
        if (!id) return;
        setLoading(true);
        try {
            const [history, mems] = await Promise.all([
                api.fetchHistory(id),
                api.fetchMemories(id),
            ]);
            if (sessionIdRef.current === id) {
                setMessages(history);
                refreshMemories(mems);
            }
        } catch (err) {
            console.error("Failed to load session data:", err);
            addToast("Failed to load chat history");
        } finally {
            setLoading(false);
        }
    }, [addToast, refreshMemories]);

    const triggerAI = useCallback(async (id) => {
        setThinkingSessions(prev => new Set(prev).add(id));
        try {
            await api.sendChat(id);
        } catch (err) {
            console.error("Failed to generate AI reply:", err);
            addToast("Failed to generate AI reply");
            setThinkingSessions(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [addToast]);

    const handleSend = async (input, setInput, setSessionTitle) => {
        if (!input.trim() || !sessionId || thinkingSessions.has(sessionId)) return;

        const userText = input;
        const currentId = sessionId;
        const optimisticId = Date.now();

        setMessages(prev => [...prev, { id: optimisticId, text: userText, sender: "me" }]);
        setInput("");

        try {
            const msgData = await api.sendMessage(currentId, userText);
            if (sessionIdRef.current === currentId) {
                setMessages(prev => prev.map(m => m.id === optimisticId ? msgData.message : m));
            }
            if (msgData.title) setSessionTitle(currentId, msgData.title);
            await triggerAI(currentId);
        } catch (err) {
            console.error("Failed to send message:", err);
            addToast("Failed to send message");
            if (sessionIdRef.current === currentId) {
                setMessages(prev => prev.filter(m => m.id !== optimisticId));
            }
        }
    };

    const sseHandlers = useMemo(() => ({
        connected: () => {
            fetchSessions();
            if (sessionIdRef.current) loadSessionData(sessionIdRef.current);
            api.fetchStatus().then(status => {
                setThinkingSessions(new Set(status.thinking_sessions || []));
            }).catch(err => console.error("Failed to sync status:", err));
        },
        tree_update: () => fetchSessions(),
        new_message: (data) => {
            if (data.session_id === sessionIdRef.current) {
                setMessages(prev => [...prev, data.message]);
                api.fetchMemories(data.session_id).then(refreshMemories);
            }
        },
        thinking_start: (data) => setThinkingSessions(prev => new Set(prev).add(data.session_id)),
        thinking_end: (data) => setThinkingSessions(prev => {
            const next = new Set(prev);
            next.delete(data.session_id);
            return next;
        }),
    }), [fetchSessions, loadSessionData, refreshMemories]);

    return {
        messages,
        setMessages,
        thinkingSessions,
        setThinkingSessions,
        loading,
        loadSessionData,
        handleSend,
        sseHandlers
    };
}
