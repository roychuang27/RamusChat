import { useState, useCallback } from "react";
import * as api from "../api";

export function useMemoryManager(addToast) {
    const [memories, setMemories] = useState([]);
    const [showMemories, setShowMemories] = useState(false);

    const refreshMemories = useCallback(async (sessionId) => {
        try {
            const mems = await api.fetchMemories(sessionId);
            setMemories(mems);
        } catch (err) {
            console.error("Failed to fetch memories:", err);
            addToast("Failed to refresh memories");
        }
    }, [addToast]);

    const handleDeleteMemory = async (memoryId, sessionId, setMessages) => {
        try {
            await api.deleteMemory(sessionId, memoryId);
            setMessages(prev => prev.filter(m => m.id !== memoryId));
            await refreshMemories(sessionId);
        } catch (err) {
            console.error("Failed to delete memory:", err);
            addToast("Failed to delete memory");
        }
    };

    const handleToggleMemory = async (memoryId, sessionId, setMessages) => {
        try {
            const result = await api.toggleMemory(sessionId, memoryId);
            setMessages(prev => prev.map(m =>
                m.id === memoryId ? { ...m, enabled: result.enabled } : m
            ));
            await refreshMemories(sessionId);
        } catch (err) {
            console.error("Failed to toggle memory:", err);
            addToast("Failed to toggle memory");
        }
    };

    return {
        memories,
        setMemories,
        showMemories,
        setShowMemories,
        refreshMemories,
        handleDeleteMemory,
        handleToggleMemory
    };
}
